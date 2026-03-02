/**
 * Importa dados do CSV para a tabela notas_fiscais.
 * Formato (export PostgreSQL): id, ref_api, numero_nf, ..., atualizado_em, , , "{...}", "{...}"
 *
 * Uso: node scripts/importar_notas_fiscais_csv.js caminho/para/arquivo.csv
 */

require("dotenv").config();
const fs = require("fs");
const db = require("../db");

const SEP = ',,"{';  // separador antes dos dois campos JSON
const JSON_SEP = '"}","{';  // separador entre os dois JSONs

function parseJsonSafe(str) {
  if (!str || typeof str !== "string" || !str.trim()) return null;
  try {
    const fixed = str.replace(/'"/g, '"').replace(/"'/g, '"');
    return JSON.parse(fixed);
  } catch {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }
}

/** Quebra cada linha em: array de 17 colunas + payload_envio + payload_retorno */
function parseLine(line) {
  const idx = line.indexOf(SEP);
  if (idx === -1) return null;
  const prefix = line.slice(0, idx);
  const rest = line.slice(idx + SEP.length);
  const cols = prefix.split(",").map((c) => c.trim());
  if (cols.length < 17) return null;
  const jsonParts = rest.split(JSON_SEP);
  const payload_envio_raw = jsonParts[0] ? '"{' + jsonParts[0] + '}"' : "";
  const payload_retorno_raw = jsonParts[1] ? (jsonParts[1].startsWith('"') ? jsonParts[1] : '"{' + jsonParts[1]) : "";
  return { cols, payload_envio_raw, payload_retorno_raw };
}

async function main() {
  const filepath = process.argv[2];
  if (!filepath || !fs.existsSync(filepath)) {
    console.error("Uso: node scripts/importar_notas_fiscais_csv.js <arquivo.csv>");
    process.exit(1);
  }

  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER);
  if (!hasDb) {
    console.error("Configure DATABASE_URL ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.");
    process.exit(1);
  }

  const content = fs.readFileSync(filepath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  let inseridos = 0;
  let erros = 0;

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    if (!parsed) {
      erros++;
      continue;
    }
    const row = parsed.cols;
    const ref_api = String(row[1] || "").trim();
    if (!ref_api) {
      erros++;
      continue;
    }

    const numero_nf = row[2] ? String(row[2]).trim() : null;
    const serie_nf = row[3] ? String(row[3]).trim() : null;
    const codigo_verificacao = row[4] ? String(row[4]).trim() : null;
    const status_nf = row[5] ? String(row[5]).trim() : null;
    const tipo_procedimento = row[6] ? String(row[6]).trim() : null;
    const cliente_nome = row[7] ? String(row[7]).trim() : null;
    const cliente_documento = row[8] ? String(row[8]).trim() : null;
    const cliente_email = row[9] ? String(row[9]).trim() : null;
    const valor_servicos = row[10] != null && row[10] !== "" ? parseFloat(row[10]) : null;
    const aliquota = row[11] != null && row[11] !== "" ? parseFloat(row[11]) : null;
    const valor_iss = row[12] != null && row[12] !== "" ? parseFloat(row[12]) : null;
    const data_emissao = row[13] ? String(row[13]).trim() : null;
    const criado_em = row[14] ? String(row[14]).trim() : null;
    const atualizado_em = row[15] ? String(row[15]).trim() : null;

    const payload_envio = parseJsonSafe(parsed.payload_envio_raw);
    const payload_retorno = parseJsonSafe(parsed.payload_retorno_raw);

    try {
      await db.query(
        `INSERT INTO notas_fiscais (
          ref_api, numero_nf, serie_nf, codigo_verificacao, status_nf, tipo_procedimento,
          cliente_nome, cliente_documento, cliente_email, valor_servicos, aliquota, valor_iss,
          data_emissao, criado_em, atualizado_em, payload_envio, payload_retorno
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (ref_api) DO UPDATE SET
          numero_nf = COALESCE(EXCLUDED.numero_nf, notas_fiscais.numero_nf),
          serie_nf = COALESCE(EXCLUDED.serie_nf, notas_fiscais.serie_nf),
          codigo_verificacao = COALESCE(EXCLUDED.codigo_verificacao, notas_fiscais.codigo_verificacao),
          status_nf = COALESCE(EXCLUDED.status_nf, notas_fiscais.status_nf),
          tipo_procedimento = COALESCE(EXCLUDED.tipo_procedimento, notas_fiscais.tipo_procedimento),
          cliente_nome = COALESCE(EXCLUDED.cliente_nome, notas_fiscais.cliente_nome),
          cliente_documento = COALESCE(EXCLUDED.cliente_documento, notas_fiscais.cliente_documento),
          cliente_email = COALESCE(EXCLUDED.cliente_email, notas_fiscais.cliente_email),
          valor_servicos = COALESCE(EXCLUDED.valor_servicos, notas_fiscais.valor_servicos),
          aliquota = COALESCE(EXCLUDED.aliquota, notas_fiscais.aliquota),
          valor_iss = COALESCE(EXCLUDED.valor_iss, notas_fiscais.valor_iss),
          data_emissao = COALESCE(EXCLUDED.data_emissao, notas_fiscais.data_emissao),
          criado_em = COALESCE(EXCLUDED.criado_em, notas_fiscais.criado_em),
          atualizado_em = COALESCE(EXCLUDED.atualizado_em, notas_fiscais.atualizado_em),
          payload_envio = COALESCE(EXCLUDED.payload_envio, notas_fiscais.payload_envio),
          payload_retorno = COALESCE(EXCLUDED.payload_retorno, notas_fiscais.payload_retorno)
        `,
        [
          ref_api,
          numero_nf,
          serie_nf,
          codigo_verificacao,
          status_nf,
          tipo_procedimento,
          cliente_nome,
          cliente_documento,
          cliente_email,
          valor_servicos,
          aliquota,
          valor_iss,
          data_emissao || null,
          criado_em || null,
          atualizado_em || null,
          payload_envio ? JSON.stringify(payload_envio) : null,
          payload_retorno ? JSON.stringify(payload_retorno) : null,
        ]
      );
      inseridos++;
    } catch (err) {
      console.error("Linha", i + 1, "ref", ref_api.slice(0, 30) + "...", err.message);
      erros++;
    }
  }

  console.log("Importação concluída.");
  console.log("  Inseridos/atualizados:", inseridos);
  if (erros > 0) console.log("  Erros:", erros);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
