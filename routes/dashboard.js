// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

/** Status considerados como "emitida/autorizada" (Focus pode retornar 'autorizado' ou 'autorizada') */
const STATUS_EMITIDA = ['emitida', 'autorizada', 'autorizado'];
/** Status considerados como "pendente" (aguardando ação) */
const STATUS_PENDENTE = ['pendente', 'processando', 'processando_autorizacao'];
/** Status a excluir das somas de notas recebidas (não representam valor válido) */
const STATUS_EXCLUIDO_RECEBIDAS = ['cancelado', 'cancelada', 'substituido', 'substituida'];

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

/**
 * GET /api/dashboard/mensal
 * Totais mensais (ano atual) de notas de serviços recebidas (NFS-e) e de compras (NF-e),
 * para os gráficos da aba Relatórios.
 */
router.get('/mensal', async (req, res) => {
  try {
    const result = await db.query(`
      WITH meses AS (
        SELECT generate_series(1, 12) AS mes
      ),
      servicos AS (
        SELECT EXTRACT(MONTH FROM COALESCE(data_emissao, criado_em))::int AS mes,
               SUM(valor_total) AS total
        FROM notas_recebidas
        WHERE EXTRACT(YEAR FROM COALESCE(data_emissao, criado_em)) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND LOWER(COALESCE(situacao, '')) NOT IN (${STATUS_EXCLUIDO_RECEBIDAS.map((_, i) => `$${i + 1}`).join(', ')})
        GROUP BY 1
      ),
      compras AS (
        SELECT EXTRACT(MONTH FROM COALESCE(data_emissao, criado_em))::int AS mes,
               SUM(valor_total) AS total
        FROM nfe_recebidas
        WHERE EXTRACT(YEAR FROM COALESCE(data_emissao, criado_em)) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND LOWER(COALESCE(situacao, '')) NOT IN (${STATUS_EXCLUIDO_RECEBIDAS.map((_, i) => `$${i + 1}`).join(', ')})
        GROUP BY 1
      )
      SELECT
        m.mes,
        COALESCE(s.total, 0) AS servicos,
        COALESCE(c.total, 0) AS compras
      FROM meses m
      LEFT JOIN servicos s ON s.mes = m.mes
      LEFT JOIN compras c ON c.mes = m.mes
      ORDER BY m.mes
    `, STATUS_EXCLUIDO_RECEBIDAS);

    res.json({
      ano: new Date().getFullYear(),
      meses: result.rows.map(r => ({
        mes: r.mes,
        servicos: Number(r.servicos) || 0,
        compras: Number(r.compras) || 0,
      })),
    });
  } catch (err) {
    console.error('Erro ao buscar totais mensais:', err);
    res.status(500).json({ erro: 'Erro ao buscar totais mensais' });
  }
});

module.exports = router;
