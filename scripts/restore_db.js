/**
 * Restaura o banco a partir de um arquivo de backup.
 * Uso: node scripts/restore_db.js backups/backup_2025-02-05_12-30-00.json
 *      node scripts/restore_db.js backups/backup_2025-02-05_12-30-00.json --confirm
 *
 * SEM --confirm: apenas mostra o que seria restaurado.
 * COM --confirm: restaura de verdade (TRUNCATE + INSERT).
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../db");

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const confirm = process.argv.includes("--confirm");
  const filepath = args[0];

  if (!filepath || !fs.existsSync(filepath)) {
    console.error("Uso: node scripts/restore_db.js <arquivo_backup.json> [--confirm]");
    console.error("Exemplo: node scripts/restore_db.js backups/backup_2025-02-05_12-30-00.json --confirm");
    process.exit(1);
  }

  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER);
  if (!hasDb) {
    console.error("Configure DATABASE_URL ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.");
    process.exit(1);
  }

  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch (e) {
    console.error("Arquivo inválido ou corrompido.");
    process.exit(1);
  }

  console.log("Backup de:", backup.createdAt);
  console.log("Tabelas:", Object.keys(backup.tables || {}).join(", "));
  for (const [table, rows] of Object.entries(backup.tables || {})) {
    console.log(`  ${table}: ${rows.length} registros`);
  }

  if (!confirm) {
    console.log("\nModo simulação. Para restaurar de verdade, adicione --confirm");
    process.exit(0);
  }

  console.log("\nRestaurando...");
  try {
    for (const [table, rows] of Object.entries(backup.tables || {})) {
      if (rows.length === 0) continue;
      await db.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const colList = cols.map((c) => `"${c}"`).join(", ");
      for (const row of rows) {
        const values = cols.map((c) => row[c]);
        await db.query(`INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`, values);
      }
      console.log(`  ${table}: ${rows.length} registros restaurados`);
    }
    console.log("\nRestore concluído.");
  } catch (err) {
    console.error("Erro ao restaurar:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
