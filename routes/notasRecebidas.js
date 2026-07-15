// routes/notasRecebidas.js
// NFS-e emitidas por terceiros contra o CNPJ da empresa (evento nfsen_recebida da Focus NFe)

const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/notas-recebidas
 * Lista últimas 500 notas recebidas
 */
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        id,
        chave_nfse,
        nome_prestador,
        documento_prestador,
        valor_total,
        data_emissao,
        situacao,
        criado_em
      FROM notas_recebidas
      ORDER BY COALESCE(data_emissao, criado_em) DESC
      LIMIT 500
    `);

    res.json(result.rows || []);
  } catch (err) {
    console.error('Erro ao buscar notas recebidas:', err);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/notas-recebidas/:id
 * Detalhe da nota recebida
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (isNaN(Number(id))) {
    return res.status(400).json({ erro: 'ID inválido' });
  }

  try {
    const result = await db.query(`
      SELECT *
      FROM notas_recebidas
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Nota recebida não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar nota recebida:', err);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
