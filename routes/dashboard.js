// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

/** Status considerados como "emitida/autorizada" (Focus pode retornar 'autorizado' ou 'autorizada') */
const STATUS_EMITIDA = ['emitida', 'autorizada', 'autorizado'];
/** Status considerados como "pendente" (aguardando ação) */
const STATUS_PENDENTE = ['pendente', 'processando', 'processando_autorizacao'];

/**
 * GET /api/dashboard/resumo
 * Números sempre atualizados do banco (últimos 30 dias).
 */
router.get('/resumo', async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE LOWER(TRIM(status_nf::text)) IN ($1, $2, $3)
            AND (COALESCE(data_emissao::date, criado_em::date) >= CURRENT_DATE - INTERVAL '30 days')
        ) AS nf_emitidas_30d,

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(status_nf::text)) IN ($4, $5, $6)
        ) AS nf_pendentes,

        COALESCE(SUM(
          CASE
            WHEN LOWER(TRIM(status_nf::text)) IN ($1, $2, $3)
             AND (COALESCE(data_emissao::date, criado_em::date) >= CURRENT_DATE - INTERVAL '30 days')
            THEN valor_servicos
            ELSE 0
          END
        ), 0) AS faturamento_30d
      FROM notas_fiscais
      `,
      [STATUS_EMITIDA[0], STATUS_EMITIDA[1], STATUS_EMITIDA[2], STATUS_PENDENTE[0], STATUS_PENDENTE[1], STATUS_PENDENTE[2]]
    );

    const row = result.rows[0] || {};
    res.json({
      nf_emitidas_30d: Number(row.nf_emitidas_30d) || 0,
      nf_pendentes: Number(row.nf_pendentes) || 0,
      faturamento_30d: Number(row.faturamento_30d) || 0,
    });
  } catch (err) {
    console.error('Erro ao buscar resumo do dashboard:', err);
    res.status(500).json({ erro: 'Erro ao buscar resumo do dashboard' });
  }
});

module.exports = router;
