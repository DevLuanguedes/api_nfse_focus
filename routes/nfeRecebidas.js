// routes/nfeRecebidas.js
// NF-e (modelo 55) emitidas por terceiros contra o CNPJ da empresa (evento nfe_recebida da Focus NFe)

const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../db');

const FOCUS_TOKEN = process.env.FOCUS_TOKEN;
const FOCUS_URL_RECEBIDAS = 'https://api.focusnfe.com.br/v2/nfes_recebidas';

const TIPOS_MANIFESTO_VALIDOS = ['ciencia', 'confirmacao', 'desconhecimento', 'nao_realizada'];

async function buscarChavePorId(id) {
  const r = await db.query('SELECT chave_nfe FROM nfe_recebidas WHERE id = $1', [id]);
  return r.rows.length ? r.rows[0].chave_nfe : null;
}

/**
 * GET /api/nfe-recebidas
 * Lista paginada de NF-e recebidas, com filtro opcional por período e busca textual.
 * Query params: pagina (default 1), por_pagina (default 50, máx 200),
 *               data_inicial, data_final (YYYY-MM-DD, filtram por data_emissao),
 *               busca (procura em emitente, documento e chave)
 */
router.get('/', async (req, res) => {
  try {
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const porPagina = Math.min(200, Math.max(1, parseInt(req.query.por_pagina, 10) || 50));
    const offset = (pagina - 1) * porPagina;

    const condicoes = [];
    const params = [];

    if (req.query.data_inicial) {
      params.push(req.query.data_inicial);
      condicoes.push(`data_emissao >= $${params.length}::date`);
    }
    if (req.query.data_final) {
      params.push(req.query.data_final);
      condicoes.push(`data_emissao < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (req.query.busca) {
      params.push(`%${req.query.busca}%`);
      const p = params.length;
      condicoes.push(`(nome_emitente ILIKE $${p} OR cnpj_emitente ILIKE $${p} OR chave_nfe ILIKE $${p})`);
    }

    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    params.push(porPagina);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await db.query(`
      SELECT
        id,
        chave_nfe,
        nome_emitente,
        cnpj_emitente,
        valor_total,
        data_emissao,
        situacao,
        manifestacao,
        manifestada_em,
        criado_em,
        COUNT(*) OVER() AS total_geral
      FROM nfe_recebidas
      ${where}
      ORDER BY COALESCE(data_emissao, criado_em) DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, params);

    const total = result.rows.length ? Number(result.rows[0].total_geral) : 0;
    const dados = result.rows.map(({ total_geral, ...resto }) => resto);

    res.json({
      dados,
      total,
      pagina,
      por_pagina: porPagina,
      total_paginas: Math.max(1, Math.ceil(total / porPagina)),
    });
  } catch (err) {
    console.error('Erro ao buscar NF-e recebidas:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/nfe-recebidas/:id
 * Detalhe da NF-e recebida
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (isNaN(Number(id))) {
    return res.status(400).json({ erro: 'ID inválido' });
  }

  try {
    const result = await db.query(`SELECT * FROM nfe_recebidas WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'NF-e recebida não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar NF-e recebida:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/nfe-recebidas/:id/xml
 * Baixa o XML da NF-e recebida (busca ao vivo na Focus NFe).
 */
router.get('/:id/xml', async (req, res) => {
  const { id } = req.params;
  if (isNaN(Number(id))) {
    return res.status(400).json({ erro: 'ID inválido' });
  }
  if (!FOCUS_TOKEN) {
    return res.status(500).json({ erro: 'FOCUS_TOKEN não configurado' });
  }

  try {
    const chave = await buscarChavePorId(id);
    if (!chave) {
      return res.status(404).json({ erro: 'NF-e recebida não encontrada' });
    }

    const resp = await axios.get(`${FOCUS_URL_RECEBIDAS}/${chave}.xml`, {
      auth: { username: FOCUS_TOKEN, password: '' },
      headers: { Accept: 'application/xml' },
      responseType: 'text',
      validateStatus: () => true,
    });

    if (resp.status !== 200) {
      return res.status(resp.status).json({ erro: 'Erro ao buscar XML na Focus NFe', detalhe: resp.data });
    }

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="nfe_${chave}.xml"`);
    res.send(resp.data);
  } catch (err) {
    console.error('Erro ao baixar XML da NF-e recebida:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/nfe-recebidas/:id/pdf
 * Exibe/baixa o DANFe (PDF) da NF-e recebida (busca ao vivo na Focus NFe).
 */
router.get('/:id/pdf', async (req, res) => {
  const { id } = req.params;
  if (isNaN(Number(id))) {
    return res.status(400).json({ erro: 'ID inválido' });
  }
  if (!FOCUS_TOKEN) {
    return res.status(500).json({ erro: 'FOCUS_TOKEN não configurado' });
  }

  try {
    const chave = await buscarChavePorId(id);
    if (!chave) {
      return res.status(404).json({ erro: 'NF-e recebida não encontrada' });
    }

    const resp = await axios.get(`${FOCUS_URL_RECEBIDAS}/${chave}.pdf`, {
      auth: { username: FOCUS_TOKEN, password: '' },
      headers: { Accept: 'application/pdf' },
      responseType: 'arraybuffer',
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (resp.status !== 200) {
      return res.status(resp.status).json({ erro: 'Erro ao buscar PDF na Focus NFe' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="nfe_${chave}.pdf"`);
    res.send(resp.data);
  } catch (err) {
    console.error('Erro ao baixar PDF da NF-e recebida:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * POST /api/nfe-recebidas/:id/manifestar
 * Registra a manifestação do destinatário (ciencia, confirmacao, desconhecimento, nao_realizada).
 * Body: { tipo: 'desconhecimento' | 'nao_realizada' | 'ciencia' | 'confirmacao', justificativa?: string }
 * "nao_realizada" exige justificativa (15 a 255 caracteres, validado também pela Focus).
 */
router.post('/:id/manifestar', async (req, res) => {
  const { id } = req.params;
  if (isNaN(Number(id))) {
    return res.status(400).json({ erro: 'ID inválido' });
  }
  if (!FOCUS_TOKEN) {
    return res.status(500).json({ erro: 'FOCUS_TOKEN não configurado' });
  }

  const { tipo, justificativa } = req.body || {};
  if (!TIPOS_MANIFESTO_VALIDOS.includes(tipo)) {
    return res.status(400).json({ erro: `tipo inválido. Use um de: ${TIPOS_MANIFESTO_VALIDOS.join(', ')}` });
  }
  if (tipo === 'nao_realizada') {
    const j = String(justificativa ?? '').trim();
    if (j.length < 15 || j.length > 255) {
      return res.status(400).json({ erro: 'justificativa deve ter entre 15 e 255 caracteres para nao_realizada.' });
    }
  }

  try {
    const chave = await buscarChavePorId(id);
    if (!chave) {
      return res.status(404).json({ erro: 'NF-e recebida não encontrada' });
    }

    const body = tipo === 'nao_realizada' ? { tipo, justificativa: justificativa.trim() } : { tipo };

    const resp = await axios.post(`${FOCUS_URL_RECEBIDAS}/${chave}/manifesto`, body, {
      auth: { username: FOCUS_TOKEN, password: '' },
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });

    if (resp.status !== 200) {
      return res.status(resp.status).json({ erro: 'Focus NFe recusou a manifestação', detalhe: resp.data });
    }

    await db.query(
      `
      UPDATE nfe_recebidas
      SET manifestacao = $1,
          manifestacao_justificativa = $2,
          manifestada_em = NOW(),
          atualizado_em = NOW()
      WHERE id = $3
      `,
      [tipo, tipo === 'nao_realizada' ? justificativa.trim() : null, id]
    );

    res.json({ sucesso: true, tipo, resposta: resp.data });
  } catch (err) {
    console.error('Erro ao manifestar NF-e recebida:', err);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
