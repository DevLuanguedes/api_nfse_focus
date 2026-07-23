/**
 * Cria a tabela nfe_recebidas (NF-e modelo 55 emitidas por terceiros contra o CNPJ da empresa).
 * Útil no Fly.io: fly ssh console -a api-sig-premcell → node scripts/criar_tabela_nfe_recebidas.js
 */

require("dotenv").config();
const db = require("../db");

const SQL = `
CREATE TABLE IF NOT EXISTS nfe_recebidas (
  id SERIAL PRIMARY KEY,
  chave_nfe VARCHAR(60) NOT NULL UNIQUE,
  focus_id VARCHAR(60),
  nome_emitente VARCHAR(255),
  cnpj_emitente VARCHAR(32),
  valor_total NUMERIC(15,2),
  data_emissao TIMESTAMP WITH TIME ZONE,
  data_geracao TIMESTAMP WITH TIME ZONE,
  situacao VARCHAR(50),
  versao VARCHAR(20),
  manifestacao VARCHAR(30),
  manifestacao_justificativa TEXT,
  manifestada_em TIMESTAMP WITH TIME ZONE,
  payload JSONB,
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

async function main() {
  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
  if (!hasDb) {
    console.error("Configure DATABASE_URL (Fly) ou DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (local).");
    process.exit(1);
  }
  try {
    await db.query(SQL);
    console.log("Tabela nfe_recebidas criada ou já existente.");
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
}

main();
