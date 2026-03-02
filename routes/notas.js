// routes/notas.js

const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const db = require('../db');
const mapLinhaParaFocus = require('../utils/mapLinhaFocus');

/**
 * GET /api/notas
 * Lista últimas 100 notas
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
      LIMIT 100
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
