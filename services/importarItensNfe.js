// services/importarItensNfe.js
// Busca o XML completo de cada NF-e recebida (nfe_completa=true) na Focus e extrai
// os itens/produtos (<det><prod>) para a tabela nfe_recebidas_itens, alimentando a
// análise por categoria (NCM). Só processa notas que ainda não têm itens — idempotente.

const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const db = require("../db");

const FOCUS_URL_RECEBIDAS = "https://api.focusnfe.com.br/v2/nfes_recebidas";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "det",
  // Evita conversão automática pra número (perderia zero à esquerda em NCM de capítulos 01-09)
  parseTagValue: false,
});

function extrairItens(xml) {
  const doc = parser.parse(xml);
  const infNFe = doc?.nfeProc?.NFe?.infNFe || doc?.NFe?.infNFe;
  if (!infNFe || !infNFe.det) return [];

  const dets = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det];

  return dets.map((det) => {
    const prod = det.prod || {};
    return {
      numeroItem: Number(det["@_nItem"]) || 0,
      codigoProduto: prod.cProd != null ? String(prod.cProd) : null,
      descricao: prod.xProd != null ? String(prod.xProd) : null,
      ncm: prod.NCM != null ? String(prod.NCM) : null,
      cfop: prod.CFOP != null ? String(prod.CFOP) : null,
      quantidade: prod.qCom != null ? Number(prod.qCom) : null,
      valorUnitario: prod.vUnCom != null ? Number(prod.vUnCom) : null,
      valorTotal: prod.vProd != null ? Number(prod.vProd) : null,
    };
  });
}

async function importarItensDaNota(nota, focusToken) {
  const resp = await axios.get(`${FOCUS_URL_RECEBIDAS}/${nota.chave_nfe}.xml`, {
    auth: { username: focusToken, password: "" },
    headers: { Accept: "application/xml" },
    responseType: "text",
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    return { status: "erro", motivo: `XML indisponível (status ${resp.status})` };
  }

  const itens = extrairItens(resp.data);
  if (!itens.length) return { status: "sem_itens" };

  for (const item of itens) {
    await db.query(
      `
      INSERT INTO nfe_recebidas_itens (
        nfe_recebida_id, chave_nfe, numero_item, codigo_produto,
        descricao, ncm, cfop, quantidade, valor_unitario, valor_total
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (chave_nfe, numero_item) DO NOTHING
      `,
      [
        nota.id,
        nota.chave_nfe,
        item.numeroItem,
        item.codigoProduto,
        item.descricao,
        item.ncm,
        item.cfop,
        item.quantidade,
        item.valorUnitario,
        item.valorTotal,
      ]
    );
  }

  return { status: "ok" };
}

/**
 * Importa os itens de todas as NF-e pendentes (nfe_completa=true e sem itens ainda).
 * @param {object} [opts]
 * @param {number} [opts.limite] - máximo de notas a processar nesta chamada (default: sem limite)
 * @param {number} [opts.esperaMs] - intervalo entre chamadas à Focus (default: 700ms, ~85 req/min)
 * @returns {Promise<{total:number, sucesso:number, semItens:number, erros:number}>}
 */
async function importarItensPendentes(opts = {}) {
  const focusToken = process.env.FOCUS_TOKEN;
  if (!focusToken) {
    throw new Error("FOCUS_TOKEN não configurado.");
  }

  const limite = opts.limite || null;
  const esperaMs = opts.esperaMs ?? 700;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  const pendentesQuery = await db.query(`
    SELECT n.id, n.chave_nfe
    FROM nfe_recebidas n
    LEFT JOIN nfe_recebidas_itens i ON i.chave_nfe = n.chave_nfe
    WHERE (n.payload->>'nfe_completa') = 'true'
      AND i.id IS NULL
    GROUP BY n.id, n.chave_nfe
    ${limite ? `LIMIT ${Number(limite)}` : ""}
  `);

  const pendentes = pendentesQuery.rows;
  let sucesso = 0;
  let semItens = 0;
  let erros = 0;

  for (const nota of pendentes) {
    await esperar(esperaMs);
    try {
      const resultado = await importarItensDaNota(nota, focusToken);
      if (resultado.status === "ok") sucesso++;
      else if (resultado.status === "sem_itens") semItens++;
      else erros++;
    } catch (err) {
      console.error(`[importarItensNfe] [${nota.chave_nfe}] erro:`, err.message);
      erros++;
    }
  }

  return { total: pendentes.length, sucesso, semItens, erros };
}

module.exports = { importarItensPendentes, importarItensDaNota, extrairItens };
