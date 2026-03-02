/**
 * Importa dados do CSV para a tabela municipio_aliquota_iss.
 * Formato esperado (sem cabeçalho): codigo_ibge,cidade,uf,aliquota[,created_at,updated_at]
 *
 * Uso: node scripts/importar_aliquotas_csv.js caminho/para/arquivo.csv
 * Exemplo: node scripts/importar_aliquotas_csv.js "C:\Users\linha\OneDrive\Documentos\table_municipio_aliquota_iss.csv"
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../db");

async function main() {
  const filepath = process.argv[2];
  if (!filepath || !fs.existsSync(filepath)) {
    console.error("Uso: node scripts/importar_aliquotas_csv.js <arquivo.csv>");
    console.error("Exemplo: node scripts/importar_aliquotas_csv.js \"C:\\Users\\...\\table_municipio_aliquota_iss.csv\"");
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
    const cols = lines[i].split(",");
    if (cols.length < 4) continue;

    const codigo = String(cols[0] || "").replace(/\D/g, "").padStart(7, "0").slice(-7);
    const cidade = (cols[1] || "").trim();
    const uf = (cols[2] || "").trim().toUpperCase().slice(0, 2);
    const aliquota = parseFloat(cols[3]);

    if (codigo.length !== 7 || !Number.isFinite(aliquota)) {
      erros++;
      continue;
    }

    try {
      await db.query(
        `INSERT INTO municipio_aliquota_iss (codigo_ibge, cidade, uf, aliquota, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (codigo_ibge) DO UPDATE SET
           cidade = COALESCE(EXCLUDED.cidade, municipio_aliquota_iss.cidade),
           uf = COALESCE(EXCLUDED.uf, municipio_aliquota_iss.uf),
           aliquota = EXCLUDED.aliquota,
           updated_at = NOW()`,
        [codigo, cidade || null, uf || null, aliquota]
      );
      inseridos++;
    } catch (err) {
      console.error("Linha", i + 1, err.message);
      erros++;
    }
  }

  console.log("Importação concluída.");
  console.log("  Inseridos/atualizados:", inseridos);
  if (erros > 0) console.log("  Erros/pulados:", erros);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
