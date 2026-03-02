/**
 * API de endereços de obra por site e UF (tabela site_endereco_obra).
 * GET listar, POST cadastrar um, POST cadastrar-varios (lista).
 */

const express = require("express");
const db = require("../db");
const { salvar } = require("../services/siteEnderecoObra");

const router = express.Router();

/** GET /api/site-enderecos - Lista endereços de obra (só quando ?q= for informado, para não travar o front) */
const LIMITE_BUSCA = 200;

router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.json([]);
    }
    const termo = "%" + q.replace(/%/g, "\\%").replace(/_/g, "\\_") + "%";
    const r = await db.query(
      `SELECT site_code, uf_servico, cidade_servico, cep_obra, logradouro_obra, numero_obra, bairro_obra, uf_obra, codigo_municipio_obra, created_at, updated_at
       FROM site_endereco_obra
       WHERE site_code ILIKE $1 OR uf_servico ILIKE $1 OR cidade_servico ILIKE $1 OR cep_obra ILIKE $1
          OR logradouro_obra ILIKE $1 OR numero_obra ILIKE $1 OR bairro_obra ILIKE $1 OR uf_obra ILIKE $1 OR codigo_municipio_obra::text ILIKE $1
       ORDER BY uf_servico, site_code
       LIMIT $2`,
      [termo, LIMITE_BUSCA]
    );
    res.json(r.rows || []);
  } catch (err) {
    console.error("Erro ao listar endereços obra:", err);
    res.status(500).json({ erro: err.message });
  }
});

/** POST /api/site-enderecos - Cadastra ou atualiza um endereço de obra */
router.post("/", async (req, res) => {
  try {
    const { site_code, uf_servico, cidade_servico, cep_obra, logradouro_obra, numero_obra, bairro_obra, uf_obra, codigo_municipio_obra } = req.body || {};
    const site = String(site_code ?? "").trim();
    const uf = String(uf_servico ?? "").trim().toUpperCase().slice(0, 2);
    if (!site) return res.status(400).json({ erro: "Informe site_code." });
    if (!uf) return res.status(400).json({ erro: "Informe uf_servico (2 letras)." });
    const ok = await salvar({
      site_code: site,
      uf_servico: uf,
      cidade_servico: cidade_servico ?? null,
      cep_obra: cep_obra ?? null,
      logradouro_obra: logradouro_obra ?? null,
      numero_obra: numero_obra ?? null,
      bairro_obra: bairro_obra ?? null,
      uf_obra: uf_obra ?? uf,
      codigo_municipio_obra: codigo_municipio_obra ?? null,
    });
    if (!ok) return res.status(500).json({ erro: "Falha ao salvar no banco." });
    res.json({ ok: true, site_code: site, uf_servico: uf });
  } catch (err) {
    console.error("Erro ao cadastrar endereço obra:", err);
    const msg = err.message || "Erro ao salvar.";
    const hint = msg.includes("does not exist") ? " Rode: node scripts/criar_tabela_site_endereco_obra.js" : "";
    res.status(500).json({ erro: msg + hint });
  }
});

/** POST /api/site-enderecos/cadastrar-varios - Cadastra vários de uma vez */
router.post("/cadastrar-varios", async (req, res) => {
  try {
    const { enderecos } = req.body || {};
    if (!Array.isArray(enderecos) || enderecos.length === 0) {
      return res.status(400).json({ erro: "Envie um array 'enderecos' com objetos { site_code, uf_servico, cep_obra?, logradouro_obra?, numero_obra?, bairro_obra?, uf_obra?, codigo_municipio_obra?, cidade_servico? }." });
    }
    let salvos = 0;
    for (const item of enderecos) {
      const site = String(item.site_code ?? "").trim();
      const uf = String(item.uf_servico ?? "").trim().toUpperCase().slice(0, 2);
      if (!site || !uf) continue;
      const ok = await salvar({
        site_code: site,
        uf_servico: uf,
        cidade_servico: item.cidade_servico ?? null,
        cep_obra: item.cep_obra ?? null,
        logradouro_obra: item.logradouro_obra ?? null,
        numero_obra: item.numero_obra ?? null,
        bairro_obra: item.bairro_obra ?? null,
        uf_obra: item.uf_obra ?? uf,
        codigo_municipio_obra: item.codigo_municipio_obra ?? null,
      });
      if (ok) salvos++;
    }
    res.json({ ok: true, salvos });
  } catch (err) {
    console.error("Erro ao cadastrar vários endereços obra:", err);
    const msg = err.message || "Erro ao salvar.";
    const hint = msg.includes("does not exist") ? " Crie a tabela: node scripts/criar_tabela_site_endereco_obra.js" : "";
    res.status(500).json({ ok: false, erro: msg + hint });
  }
});

module.exports = router;
