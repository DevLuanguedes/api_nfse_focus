/**
 * API de municípios e alíquotas ISS (tabela municipio_aliquota_iss).
 * GET listar, POST cadastrar um, POST cadastrar-varios (lista).
 */

const express = require("express");
const db = require("../db");
const { salvarAliquotaMunicipio } = require("../services/aliquotasMunicipio");

const router = express.Router();

/** GET /api/municipios-aliquotas - Lista todos os municípios cadastrados */
router.get("/", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT codigo_ibge, cidade, uf, aliquota, created_at, updated_at FROM municipio_aliquota_iss ORDER BY uf, cidade"
    );
    res.json(r.rows || []);
  } catch (err) {
    console.error("Erro ao listar municípios:", err);
    res.status(500).json({ erro: err.message });
  }
});

/** POST /api/municipios-aliquotas - Cadastra ou atualiza um município */
router.post("/", async (req, res) => {
  try {
    const { codigo_ibge, cidade, uf, aliquota } = req.body || {};
    const codigo = String(codigo_ibge ?? "").replace(/\D/g, "");
    if (codigo.length !== 7) {
      return res.status(400).json({ erro: "Código IBGE deve ter 7 dígitos." });
    }
    const num = Number(aliquota);
    if (!Number.isFinite(num)) {
      return res.status(400).json({ erro: "Alíquota inválida (informe um número em %)." });
    }
    const ok = await salvarAliquotaMunicipio(codigo, cidade, uf, num);
    if (!ok) return res.status(500).json({ erro: "Falha ao salvar no banco." });
    res.json({ ok: true, codigo_ibge: codigo });
  } catch (err) {
    console.error("Erro ao cadastrar município:", err);
    res.status(500).json({ erro: err.message });
  }
});

/** POST /api/municipios-aliquotas/cadastrar-varios - Cadastra vários de uma vez */
router.post("/cadastrar-varios", async (req, res) => {
  try {
    const { aliquotas } = req.body || {};
    if (!Array.isArray(aliquotas) || aliquotas.length === 0) {
      return res.status(400).json({ erro: "Envie um array 'aliquotas' com objetos { codigo, cidade?, uf?, aliquota }." });
    }
    let salvos = 0;
    for (const item of aliquotas) {
      const codigo = String(item.codigo ?? "").replace(/\D/g, "");
      if (codigo.length !== 7) continue;
      const num = Number(item.aliquota);
      if (!Number.isFinite(num)) continue;
      const ok = await salvarAliquotaMunicipio(codigo, item.cidade, item.uf, num);
      if (ok) salvos++;
    }
    res.json({ ok: true, salvos });
  } catch (err) {
    console.error("Erro ao cadastrar vários:", err);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
