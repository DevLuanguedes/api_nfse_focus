/**
 * Cria a tabela nfe_recebidas_itens (itens/produtos das NF-e recebidas, extraídos do XML completo).
 * Útil no Fly.io: fly ssh console -a api-sig-premcell → node scripts/criar_tabela_nfe_itens.js
 */

require("dotenv").config();
const db = require("../db");

const SQL = `
CREATE TABLE IF NOT EXISTS nfe_recebidas_itens (
  id SERIAL PRIMARY KEY,
  nfe_recebida_id INTEGER REFERENCES nfe_recebidas(id) ON DELETE CASCADE,
  chave_nfe VARCHAR(60) NOT NULL,
  numero_item INTEGER NOT NULL,
  codigo_produto VARCHAR(60),
  descricao TEXT,
  ncm VARCHAR(10),
  cfop VARCHAR(10),
  quantidade NUMERIC(15,4),
  valor_unitario NUMERIC(15,4),
  valor_total NUMERIC(15,2),
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (chave_nfe, numero_item)
);
CREATE INDEX IF NOT EXISTS idx_nfe_itens_ncm ON nfe_recebidas_itens (ncm);
`;

async function main() {
  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
  if (!hasDb) {
    console.error("Configure DATABASE_URL (Fly) ou DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (local).");
    process.exit(1);
  }
  try {
    await db.query(SQL);
    console.log("Tabela nfe_recebidas_itens criada ou já existente.");
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
}

main();
