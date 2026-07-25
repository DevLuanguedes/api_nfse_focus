const express = require("express");
const router = express.Router();
const db = require("../db");

function sanitizeRef(ref) {
  return String(ref ?? "").trim().replace(/[^a-zA-Z0-9]/g, "");
}

const WEBHOOK_RECEBIDAS_TOKEN = process.env.WEBHOOK_RECEBIDAS_TOKEN;

router.post("/focus/nfse", async (req, res) => {
  try {
    console.log("📩 WEBHOOK FOCUS RECEBIDO");
    console.log(JSON.stringify(req.body, null, 2));

    const retorno = req.body || {};

    const refBruto = retorno.ref ?? retorno.ref_api;
    const ref = sanitizeRef(refBruto);
    const numero_nf =
      retorno.numero_nf ??
      retorno.numero ??
      retorno.numero_documento ??
      retorno.numero_nota ??
      (retorno.nfse && retorno.nfse.numero) ??
      (retorno.dados && retorno.dados.numero) ??
      null;
    const codigo_verificacao =
      retorno.codigo_verificacao ?? (retorno.nfse && retorno.nfse.codigo_verificacao) ?? null;
    const status = retorno.status;

    if (!ref) {
      return res.sendStatus(200);
    }

    // ref_api no banco é sanitizada (igual à usada na emissão)
    await db.query(
      `
      UPDATE notas_fiscais
      SET 
        numero_nf = COALESCE(NULLIF(TRIM($1::text), ''), numero_nf),
        codigo_verificacao = COALESCE(NULLIF(TRIM($2::text), ''), codigo_verificacao),
        status_nf = COALESCE($3, status_nf),
        atualizado_em = NOW()
      WHERE ref_api = $4
      `,
      [numero_nf ?? "", codigo_verificacao ?? "", status ?? "", ref]
    );

    if (numero_nf) console.log("[Webhook] ref:", ref, "-> numero_nf:", numero_nf);

    res.sendStatus(200);
  } catch (err) {
    console.error("ERRO WEBHOOK:", err);
    res.sendStatus(200);
  }
});

/**
 * POST /webhook/focus/nfse-recebida?token=...
 * Evento "nfsen_recebida" da Focus NFe: notas emitidas por terceiros contra o CNPJ da empresa.
 * Protegido por token (configurar WEBHOOK_RECEBIDAS_TOKEN e usar a mesma URL/token no painel da Focus).
 */
router.post("/focus/nfse-recebida", async (req, res) => {
  try {
    if (WEBHOOK_RECEBIDAS_TOKEN && req.query.token !== WEBHOOK_RECEBIDAS_TOKEN) {
      return res.sendStatus(401);
    }

    console.log("📩 WEBHOOK FOCUS NFSE RECEBIDA");
    console.log(JSON.stringify(req.body, null, 2));

    const dados = req.body || {};
    const chaveNfse = String(dados.chave_nfse ?? "").trim();

    if (!chaveNfse) {
      return res.sendStatus(200);
    }

    await db.query(
      `
      INSERT INTO notas_recebidas (
        chave_nfse, focus_id, nome_prestador, documento_prestador,
        valor_total, data_emissao, data_geracao, situacao, versao, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (chave_nfse) DO UPDATE SET
        focus_id = COALESCE(EXCLUDED.focus_id, notas_recebidas.focus_id),
        nome_prestador = COALESCE(EXCLUDED.nome_prestador, notas_recebidas.nome_prestador),
        documento_prestador = COALESCE(EXCLUDED.documento_prestador, notas_recebidas.documento_prestador),
        valor_total = COALESCE(EXCLUDED.valor_total, notas_recebidas.valor_total),
        data_emissao = COALESCE(EXCLUDED.data_emissao, notas_recebidas.data_emissao),
        data_geracao = COALESCE(EXCLUDED.data_geracao, notas_recebidas.data_geracao),
        situacao = COALESCE(EXCLUDED.situacao, notas_recebidas.situacao),
        versao = COALESCE(EXCLUDED.versao, notas_recebidas.versao),
        payload = EXCLUDED.payload,
        atualizado_em = NOW()
      `,
      [
        chaveNfse,
        dados.id ?? null,
        dados.nome_prestador ?? null,
        dados.documento_prestador ?? null,
        dados.valor_total ?? null,
        dados.data_emissao ?? null,
        dados.data_geracao ?? null,
        dados.situacao ?? null,
        dados.versao != null ? String(dados.versao) : null,
        JSON.stringify(dados),
      ]
    );

    console.log("[Webhook] nota recebida gravada, chave_nfse:", chaveNfse);

    res.sendStatus(200);
  } catch (err) {
    console.error("ERRO WEBHOOK NFSE RECEBIDA:", err);
    res.sendStatus(200);
  }
});

/**
 * POST /webhook/focus/nfe-recebida?token=...
 * Evento "nfe_recebida" da Focus NFe: NF-e (modelo 55) emitidas por terceiros contra o CNPJ da empresa.
 * Protegido pelo mesmo token de notas recebidas (configurar WEBHOOK_RECEBIDAS_TOKEN e usar a mesma URL/token no painel da Focus).
 *
 * Obs.: a Focus ainda não documentou publicamente o formato exato deste payload (ao contrário do
 * nfsen_recebida), então a extração de campos abaixo é defensiva/best-effort — o payload bruto é
 * sempre gravado em `payload` para não perder dado nenhum caso os nomes de campo estejam diferentes.
 */
router.post("/focus/nfe-recebida", async (req, res) => {
  try {
    if (WEBHOOK_RECEBIDAS_TOKEN && req.query.token !== WEBHOOK_RECEBIDAS_TOKEN) {
      return res.sendStatus(401);
    }

    console.log("📩 WEBHOOK FOCUS NFE RECEBIDA");
    console.log(JSON.stringify(req.body, null, 2));

    const dados = req.body || {};
    const chaveNfe = String(dados.chave_nfe ?? dados.chave ?? dados.chave_acesso ?? "").trim();

    if (!chaveNfe) {
      return res.sendStatus(200);
    }

    const nomeEmitente =
      dados.nome_emitente ?? dados.razao_social_emitente ?? dados.emitente_nome ?? null;
    const cnpjEmitente =
      dados.cnpj_emitente ?? dados.documento_emitente ?? dados.emitente_cnpj ?? null;
    const valorTotal =
      dados.valor_total ?? dados.valor_nf ?? dados.valor_nfe ?? null;
    const manifestacaoFocus = dados.manifestacao_destinatario ?? null;

    await db.query(
      `
      INSERT INTO nfe_recebidas (
        chave_nfe, focus_id, nome_emitente, cnpj_emitente,
        valor_total, data_emissao, data_geracao, situacao, versao, manifestacao, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (chave_nfe) DO UPDATE SET
        focus_id = COALESCE(EXCLUDED.focus_id, nfe_recebidas.focus_id),
        nome_emitente = COALESCE(EXCLUDED.nome_emitente, nfe_recebidas.nome_emitente),
        cnpj_emitente = COALESCE(EXCLUDED.cnpj_emitente, nfe_recebidas.cnpj_emitente),
        valor_total = COALESCE(EXCLUDED.valor_total, nfe_recebidas.valor_total),
        data_emissao = COALESCE(EXCLUDED.data_emissao, nfe_recebidas.data_emissao),
        data_geracao = COALESCE(EXCLUDED.data_geracao, nfe_recebidas.data_geracao),
        situacao = COALESCE(EXCLUDED.situacao, nfe_recebidas.situacao),
        versao = COALESCE(EXCLUDED.versao, nfe_recebidas.versao),
        manifestacao = COALESCE(nfe_recebidas.manifestacao, EXCLUDED.manifestacao),
        payload = CASE WHEN EXCLUDED.valor_total IS NOT NULL THEN EXCLUDED.payload ELSE nfe_recebidas.payload END,
        atualizado_em = NOW()
      `,
      [
        chaveNfe,
        dados.id ?? null,
        nomeEmitente,
        cnpjEmitente,
        valorTotal,
        dados.data_emissao ?? null,
        dados.data_geracao ?? null,
        dados.situacao ?? null,
        dados.versao != null ? String(dados.versao) : null,
        manifestacaoFocus,
        JSON.stringify(dados),
      ]
    );

    console.log("[Webhook] NF-e recebida gravada, chave_nfe:", chaveNfe);

    res.sendStatus(200);
  } catch (err) {
    console.error("ERRO WEBHOOK NFE RECEBIDA:", err);
    res.sendStatus(200);
  }
});

module.exports = router;
