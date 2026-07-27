/**
 * Busca o XML completo de cada NF-e recebida (nfe_completa=true) na Focus e extrai
 * os itens/produtos (<det><prod>) para a tabela nfe_recebidas_itens, permitindo
 * análise por categoria (NCM).
 *
 * Só processa notas que ainda não têm itens importados — pode ser rodado
 * novamente com segurança (idempotente).
 *
 * Uso: fly ssh console -a api-sig-premcell -C "node scripts/importar_itens_nfe.js"
 */

require("dotenv").config();
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const db = require("../db");

const FOCUS_TOKEN = process.env.FOCUS_TOKEN;
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

async function main() {
  if (!FOCUS_TOKEN) {
    console.error("FOCUS_TOKEN não configurado.");
    process.exit(1);
  }

  const pendentes = await db.query(`
    SELECT n.id, n.chave_nfe
    FROM nfe_recebidas n
    LEFT JOIN nfe_recebidas_itens i ON i.chave_nfe = n.chave_nfe
    WHERE (n.payload->>'nfe_completa') = 'true'
      AND i.id IS NULL
    GROUP BY n.id, n.chave_nfe
  `);

  console.log(`Notas pendentes de importação de itens: ${pendentes.rows.length}`);

  let sucesso = 0;
  let semItens = 0;
  let erros = 0;

  // Focus limita ~100 requisições/60s; 700ms entre chamadas fica bem abaixo disso.
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const nota of pendentes.rows) {
    await esperar(700);
    try {
      const resp = await axios.get(`${FOCUS_URL_RECEBIDAS}/${nota.chave_nfe}.xml`, {
        auth: { username: FOCUS_TOKEN, password: "" },
        headers: { Accept: "application/xml" },
        responseType: "text",
        validateStatus: () => true,
      });

      if (resp.status !== 200) {
        console.warn(`  [${nota.chave_nfe}] XML indisponível (status ${resp.status})`);
        erros++;
        continue;
      }

      const itens = extrairItens(resp.data);
      if (!itens.length) {
        semItens++;
        continue;
      }

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

      sucesso++;
      if (sucesso % 25 === 0) console.log(`  processadas: ${sucesso}`);
    } catch (err) {
      console.error(`  [${nota.chave_nfe}] erro:`, err.message);
      erros++;
    }
  }

  console.log(`\nConcluído. Notas com itens importados: ${sucesso} | sem itens no XML: ${semItens} | erros: ${erros}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na importação de itens:", err.message);
  process.exit(1);
});
