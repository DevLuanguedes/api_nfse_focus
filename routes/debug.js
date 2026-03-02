const express = require("express");
const path = require("path");
const router = express.Router();
const db = require("../db");

const { lerPlanilha } = require("../services/planilha");
const prestador = require("../config/prestador");

// ajuste o nome do arquivo se necessário
const CAMINHO_PLANILHA = path.join(
  __dirname,
  "..",
  "uploads",
  "teste_nfse.xlsx"
);

/** GET /api/debug/db - Testa conexão com o banco (útil para diagnóstico) */
router.get("/db", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, mensagem: "Banco conectado" });
  } catch (err) {
    console.error("Erro ao testar banco:", err);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

router.get("/planilha-json", (req, res) => {
  try {
    const linhas = lerPlanilha(CAMINHO_PLANILHA);

    res.json({
      prestador,
      total_linhas: linhas.length,
      exemplo_linha_1: linhas[0] || null,
      exemplo_linha_2: linhas[1] || null
    });

  } catch (err) {
    console.error("Erro debug planilha:", err);
    res.status(500).json({
      erro: "Erro ao ler planilha",
      detalhe: err.message
    });
  }
});

module.exports = router;
