/**
 * Aumenta tamanho das colunas: numero_obra VARCHAR(100), site_code VARCHAR(120).
 * Rode uma vez: node scripts/alter_site_endereco_obra_numero.js
 */
require("dotenv").config();
const db = require("../db");

async function main() {
  try {
    await db.query("ALTER TABLE site_endereco_obra ALTER COLUMN numero_obra TYPE VARCHAR(100);");
    console.log("Coluna numero_obra alterada para VARCHAR(100).");
  } catch (err) {
    if (!err.message.includes("already")) console.error("numero_obra:", err.message);
  }
  try {
    await db.query("ALTER TABLE site_endereco_obra ALTER COLUMN site_code TYPE VARCHAR(120);");
    console.log("Coluna site_code alterada para VARCHAR(120).");
  } catch (err) {
    if (!err.message.includes("already")) console.error("site_code:", err.message);
  }
}
main();
