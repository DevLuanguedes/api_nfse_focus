/**
 * Faz backup completo do banco (todas as tabelas) em JSON.
 * Uso: node scripts/backup_db.js
 * No Fly: fly ssh console -a api-sig-premcell → node scripts/backup_db.js
 *
 * Salva em: backups/backup_YYYY-MM-DD_HH-mm-ss.json
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../db");

const BACKUPS_DIR = path.join(__dirname, "..", "backups");

async function main() {
  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER);
  if (!hasDb) {
    console.error("Configure DATABASE_URL ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `backup_${timestamp}.json`;
  const filepath = path.join(BACKUPS_DIR, filename);

  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const tablesRes = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tables = tablesRes.rows.map((r) => r.table_name);

    const backup = { createdAt: new Date().toISOString(), tables: {} };

    for (const table of tables) {
      const res = await db.query(`SELECT * FROM "${table}"`);
      backup.tables[table] = res.rows;
      console.log(`  ${table}: ${res.rows.length} registros`);
    }

    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), "utf8");
    console.log("\nBackup salvo:", filepath);
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
