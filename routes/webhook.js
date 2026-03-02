const express = require("express");
const router = express.Router();
const db = require("../db");

function sanitizeRef(ref) {
  return String(ref ?? "").trim().replace(/[^a-zA-Z0-9]/g, "");
}

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

module.exports = router;
