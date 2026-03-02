/**
 * Importa dados do CSV para a tabela site_endereco_obra.
 * Formato: site_code, uf_servico, cidade_servico, cep_obra, logradouro_obra, numero_obra, bairro_obra, uf_obra, codigo_municipio_obra, created_at, updated_at
 *
 * Uso: node scripts/importar_site_endereco_obra_csv.js caminho/para/arquivo.csv
 */

require("dotenv").config();
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const db = require("../db");

async function main() {
  const filepath = process.argv[2];
  if (!filepath || !fs.existsSync(filepath)) {
    console.error("Uso: node scripts/importar_site_endereco_obra_csv.js <arquivo.csv>");
    process.exit(1);
  }

  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER);
  if (!hasDb) {
    console.error("Configure DATABASE_URL ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.");
    process.exit(1);
  }

  const content = fs.readFileSync(filepath, "utf8");
  let rows;
  try {
    rows = parse(content, { relax_column_count: true, trim: true });
  } catch (err) {
    console.error("Erro ao parsear CSV:", err.message);
    process.exit(1);
  }

  let inseridos = 0;
  let erros = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 2) continue;

    const site_code = String(row[0] || "").trim();
    const uf_servico = String(row[1] || "").trim().toUpperCase().slice(0, 2);
    if (!site_code || !uf_servico) {
      erros++;
      continue;
    }

    const cidade_servico = row[2] ? String(row[2]).trim() : null;
    const cep_obra = row[3] ? String(row[3]).trim() : null;
    const logradouro_obra = row[4] ? String(row[4]).trim() : null;
    const numero_obra = row[5] ? String(row[5]).trim() : null;
    const bairro_obra = row[6] ? String(row[6]).trim() : null;
    const uf_obra = row[7] ? String(row[7]).trim().toUpperCase().slice(0, 2) : null;
    const codigo_municipio_obra = row[8] ? String(row[8]).trim().replace(/\D/g, "").slice(0, 7) || null : null;

    try {
      await db.query(
        `INSERT INTO site_endereco_obra (
          site_code, uf_servico, cidade_servico, cep_obra, logradouro_obra, numero_obra, bairro_obra, uf_obra, codigo_municipio_obra, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (site_code, uf_servico) DO UPDATE SET
          cidade_servico = COALESCE(EXCLUDED.cidade_servico, site_endereco_obra.cidade_servico),
          cep_obra = COALESCE(EXCLUDED.cep_obra, site_endereco_obra.cep_obra),
          logradouro_obra = COALESCE(EXCLUDED.logradouro_obra, site_endereco_obra.logradouro_obra),
          numero_obra = COALESCE(EXCLUDED.numero_obra, site_endereco_obra.numero_obra),
          bairro_obra = COALESCE(EXCLUDED.bairro_obra, site_endereco_obra.bairro_obra),
          uf_obra = COALESCE(EXCLUDED.uf_obra, site_endereco_obra.uf_obra),
          codigo_municipio_obra = COALESCE(EXCLUDED.codigo_municipio_obra, site_endereco_obra.codigo_municipio_obra),
          updated_at = NOW()`,
        [
          site_code,
          uf_servico,
          cidade_servico,
          cep_obra,
          logradouro_obra,
          numero_obra,
          bairro_obra,
          uf_obra,
          codigo_municipio_obra,
        ]
      );
      inseridos++;
    } catch (err) {
      console.error("Linha", i + 1, site_code, uf_servico, err.message);
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
