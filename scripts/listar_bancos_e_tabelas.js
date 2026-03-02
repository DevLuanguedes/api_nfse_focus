/**
 * Lista bancos do Postgres e onde estão as tabelas.
 * Uso no Fly: fly ssh console -a api-sig-premcell → node scripts/listar_bancos_e_tabelas.js
 */

require("dotenv").config();
const db = require("../db");

async function main() {
  try {
    const u = process.env.DATABASE_URL || "";
    const dbAtual = (u.match(/\/([^/?]+)(\?|$)/) || [])[1] || "?";
    console.log("Banco atual (DATABASE_URL):", dbAtual);

    const dbs = await db.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
    );
    console.log("\nBancos disponíveis:", dbs.rows.map((r) => r.datname).join(", "));

    const tabs = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    console.log("\nTabelas no banco atual:", tabs.rows.length ? tabs.rows.map((r) => r.table_name).join(", ") : "(nenhuma)");

    if (tabs.rows.some((r) => r.table_name === "notas_fiscais")) {
      const r = await db.query("SELECT COUNT(*) as n FROM notas_fiscais");
      console.log("Registros em notas_fiscais:", r.rows[0].n);
    } else {
      console.log("\nSe existir banco 'api_sig_premcell', seus dados podem estar lá.");
      console.log("Altere o DATABASE_URL para usar /api_sig_premcell em vez de /postgres");
    }
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
