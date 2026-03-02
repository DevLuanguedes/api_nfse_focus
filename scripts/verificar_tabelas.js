/**
 * Verifica quais tabelas existem no banco antes de criar.
 * Uso: node scripts/verificar_tabelas.js
 * No Fly: fly ssh console -a api-sig-premcell → node scripts/verificar_tabelas.js
 */

require("dotenv").config();
const db = require("../db");

const TABELAS_ESPERADAS = ["usuarios", "notas_fiscais", "municipio_aliquota_iss", "site_endereco_obra"];

async function main() {
  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
  if (!hasDb) {
    console.error("Configure DATABASE_URL (Fly) ou DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (local).");
    process.exit(1);
  }

  try {
    const res = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const existentes = res.rows.map((r) => r.table_name);

    console.log("Conexão com o banco: OK");
    console.log("\nTabelas no banco:", existentes.length ? existentes.join(", ") : "(nenhuma)");
    console.log("");

    for (const nome of TABELAS_ESPERADAS) {
      const existe = existentes.includes(nome);
      const status = existe ? "OK" : "FALTA";
      console.log(`  ${nome}: ${status}`);
    }

    const faltando = TABELAS_ESPERADAS.filter((t) => !existentes.includes(t));
    if (faltando.length > 0) {
      console.log("\nPara criar as tabelas faltantes, rode: node scripts/criar_todas_tabelas.js");
    } else {
      console.log("\nTodas as tabelas necessárias existem.");
    }
  } catch (err) {
    console.error("Erro ao verificar (não conectou?):", err.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
