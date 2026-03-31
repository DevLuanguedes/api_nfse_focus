// routes/notas.js

const express = require('express');
const XLSX = require('xlsx');
const axios = require('axios');
const router = express.Router();
const db = require('../db');
const mapLinhaParaFocus = require('../utils/mapLinhaFocus');

const FOCUS_URL = 'https://api.focusnfe.com.br/v2/nfsen';
const FOCUS_TOKEN = process.env.FOCUS_TOKEN;

/**
 * GET /api/notas
 * Lista últimas 500 notas
 */
/** Extrai número da NF do payload_retorno (JSON da Focus) quando numero_nf está vazio */
function extrairNumeroDoPayload(payloadRetorno) {
  if (!payloadRetorno || typeof payloadRetorno !== 'string') return null;
  try {
    const p = JSON.parse(payloadRetorno);
    if (!p || typeof p !== 'object') return null;
    return (
      p.numero ??
      p.numero_nf ??
      p.numero_documento ??
      p.numero_nota ??
      (p.nfse && p.nfse.numero) ??
      (p.dados && p.dados.numero) ??
      null
    );
  } catch {
    return null;
  }
}

function sanitizeRef(ref) {
  return String(ref ?? '').trim().replace(/[^a-zA-Z0-9]/g, '');
}

function extrairNumeroFocus(data) {
  if (!data || typeof data !== 'object') return null;
  return (
    data.numero ??
    data.numero_nf ??
    data.numero_documento ??
    data.numero_nota ??
    (data.nfse && data.nfse.numero) ??
    (data.dados && data.dados.numero) ??
    null
  );
}

function extrairCodigoVerificacaoFocus(data) {
  if (!data || typeof data !== 'object') return null;
  return data.codigo_verificacao ?? (data.nfse && data.nfse.codigo_verificacao) ?? null;
}

router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id,
        ref_api,
        numero_nf,
        codigo_verificacao,
        status_nf,
        tipo_procedimento,
        cliente_nome,
        valor_servicos,
        data_emissao,
        criado_em,
        payload_retorno
      FROM notas_fiscais
      ORDER BY criado_em DESC
      LIMIT 500
    `);

    const rows = result.rows || [];
    const saida = rows.map((r) => {
      const { payload_retorno, ...rest } = r;
      let numero_nf = rest.numero_nf;
      if ((numero_nf == null || String(numero_nf).trim() === '') && payload_retorno) {
        const extraido = extrairNumeroDoPayload(payload_retorno);
        if (extraido != null) numero_nf = extraido;
      }
      return { ...rest, numero_nf };
    });

    // Se ainda houver notas sem número, tenta sincronizar essas refs específicas com a Focus
    if (FOCUS_TOKEN) {
      const refsPendentes = Array.from(
        new Set(
          saida
            .filter(
              (n) =>
                (n.numero_nf == null || String(n.numero_nf).trim() === '') &&
                n.ref_api &&
                String(n.ref_api).trim() !== ''
            )
            .map((n) => sanitizeRef(n.ref_api))
            .filter(Boolean)
        )
      );

      if (refsPendentes.length > 0) {
        console.log('[notas] Encontradas', refsPendentes.length, 'refs sem numero_nf; sincronizando com Focus...');

        for (const ref of refsPendentes) {
          const refSan = sanitizeRef(ref);
          if (!refSan) continue;
          try {
            const url = `${FOCUS_URL}/${encodeURIComponent(refSan)}`;
            const resp = await axios.get(url, {
              auth: { username: FOCUS_TOKEN, password: '' },
              headers: { 'Content-Type': 'application/json' },
              timeout: 15000,
              validateStatus: () => true,
            });

            const data = resp.data || {};
            if (resp.status !== 200) {
              continue;
            }

            const numeroNf = extrairNumeroFocus(data);
            const codigoVerif = extrairCodigoVerificacaoFocus(data);
            const status = data.status != null ? String(data.status) : null;

            if (!numeroNf && !status && !codigoVerif) {
              continue;
            }

            // Atualiza em memória para a resposta da API
            for (const n of saida) {
              if (sanitizeRef(n.ref_api) === refSan) {
                if (numeroNf != null && String(numeroNf).trim() !== '') {
                  n.numero_nf = numeroNf;
                }
                if (codigoVerif != null && String(codigoVerif).trim() !== '') {
                  n.codigo_verificacao = codigoVerif;
                }
                if (status) {
                  n.status_nf = status;
                }
              }
            }

            // Persiste no banco para próximos acessos
            await db.query(
              `
              UPDATE notas_fiscais
              SET numero_nf = COALESCE(NULLIF(TRIM($1::text), ''), numero_nf),
                  codigo_verificacao = COALESCE(NULLIF(TRIM($2::text), ''), codigo_verificacao),
                  status_nf = COALESCE($3, status_nf),
                  payload_retorno = $4,
                  atualizado_em = NOW()
              WHERE ref_api = $5
              `,
              [numeroNf ?? '', codigoVerif ?? '', status ?? '', JSON.stringify(data), refSan]
            );
          } catch (syncErr) {
            console.warn('[notas] Erro ao sincronizar ref com Focus:', ref, syncErr.message);
          }
        }
      }
    }

    res.json(saida);
  } catch (err) {
    console.error('Erro ao buscar notas:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/notas/exportar-excel
 * Exporta a lista de notas em Excel (.xlsx)
 */
router.get('/exportar-excel', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        ref_api AS "Ref",
        numero_nf AS "Nº NF",
        codigo_verificacao AS "Cód. Verificação",
        status_nf AS "Status",
        tipo_procedimento AS "Tipo",
        cliente_nome AS "Cliente",
        valor_servicos AS "Valor",
        data_emissao AS "Data Emissão",
        criado_em AS "Criado em"
      FROM notas_fiscais
      ORDER BY criado_em DESC
      LIMIT 500
    `);

    const rows = result.rows || [];
    const header = rows.length ? Object.keys(rows[0]) : ['Ref', 'Nº NF', 'Cód. Verificação', 'Status', 'Tipo', 'Cliente', 'Valor', 'Data Emissão', 'Criado em'];
    const data = [header, ...rows.map(r => header.map(h => (r[h] != null && r[h] !== undefined ? r[h] : '')))];

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Notas Fiscais');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const nome = 'Notas_Fiscais_' + new Date().toISOString().slice(0, 10) + '.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + nome + '"');
    res.send(buf);
  } catch (err) {
    console.error('Erro ao exportar Excel:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/notas/:id
 * Detalhe da nota + erro detalhado (payload_retorno)
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (isNaN(Number(id))) {
    return res.status(400).json({ erro: 'ID inválido' });
  }

  try {
    const result = await db.query(`
      SELECT 
        id,
        ref_api,
        numero_nf,
        serie_nf,
        codigo_verificacao,
        status_nf,
        tipo_procedimento,
        cliente_nome,
        cliente_documento,
        cliente_email,
        valor_servicos,
        aliquota,
        valor_iss,
        data_emissao,
        criado_em,
        atualizado_em,
        payload_envio,
        payload_retorno
      FROM notas_fiscais
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Nota não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar nota:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * POST /api/notas
 * Cria uma nota manual (pendente)
 */
router.post('/', async (req, res) => {
  try {
    const {
      ref_api,
      tipo_procedimento,
      cliente_nome,
      cliente_documento,
      cliente_email,
      valor_servicos
    } = req.body;

    if (!ref_api || !tipo_procedimento || !valor_servicos) {
      return res.status(400).json({
        erro: 'Campos obrigatórios: ref_api, tipo_procedimento, valor_servicos'
      });
    }

    const result = await db.query(`
      INSERT INTO notas_fiscais (
        ref_api,
        status_nf,
        tipo_procedimento,
        cliente_nome,
        cliente_documento,
        cliente_email,
        valor_servicos
      )
      VALUES ($1, 'pendente', $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      ref_api,
      tipo_procedimento,
      cliente_nome,
      cliente_documento,
      cliente_email,
      valor_servicos
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar nota:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * POST /api/notas/forcar-numero
 * Permite corrigir manualmente numero_nf / status_nf de uma ref específica
 * Ex.: quando a Focus já mostra a NF emitida, mas o webhook/sincronização não atualizou o banco.
 */
router.post('/forcar-numero', async (req, res) => {
  try {
    const { ref_api, numero_nf, codigo_verificacao, status_nf } = req.body || {};

    if (!ref_api || !numero_nf) {
      return res.status(400).json({
        erro: 'Campos obrigatórios: ref_api e numero_nf',
      });
    }

    const refSan = sanitizeRef(ref_api);
    if (!refSan) {
      return res.status(400).json({ erro: 'ref_api inválida' });
    }

    const numeroStr = String(numero_nf).trim();
    if (!numeroStr) {
      return res.status(400).json({ erro: 'numero_nf inválido' });
    }

    const statusStr =
      typeof status_nf === 'string' && status_nf.trim()
        ? status_nf.trim()
        : 'autorizada';

    const codVerifStr =
      codigo_verificacao != null && String(codigo_verificacao).trim() !== ''
        ? String(codigo_verificacao).trim()
        : null;

    const result = await db.query(
      `
      UPDATE notas_fiscais
      SET
        numero_nf = $1,
        codigo_verificacao = COALESCE($2, codigo_verificacao),
        status_nf = $3,
        atualizado_em = NOW()
      WHERE ref_api = $4 OR ref_api = $5
      RETURNING id, ref_api, numero_nf, status_nf, codigo_verificacao
      `,
      [numeroStr, codVerifStr, statusStr, refSan, ref_api]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        erro: 'Nenhuma nota encontrada para a ref_api informada',
      });
    }

    return res.json({
      sucesso: true,
      nota: result.rows[0],
    });
  } catch (err) {
    console.error('Erro ao forcar numero da nota:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * POST /api/notas/emitir-planilha
 * (mantido para compatibilidade / debug)
 */
router.post('/emitir-planilha', async (req, res) => {
  try {
    const { prestador, linhas } = req.body;

    if (!prestador || !Array.isArray(linhas)) {
      return res.status(400).json({
        erro: 'É necessário enviar prestador e linhas[]'
      });
    }

    const notasJson = [];

    for (const linha of linhas) {
      const jsonFocus = await mapLinhaParaFocus(linha, prestador);
      notasJson.push(jsonFocus);
    }

    res.json({
      sucesso: true,
      total_notas: notasJson.length,
      exemplo: notasJson[0]
    });

  } catch (err) {
    console.error('Erro ao processar planilha:', err);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
