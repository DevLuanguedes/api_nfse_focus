/**
 * Cria a tabela usuarios para login do painel.
 * Rode uma vez: node scripts/criar_tabela_usuarios.js
 */

require("dotenv").config();
const db = require("../db");

const SQL = `
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) DEFAULT 'operador',
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE usuarios IS 'Usuários do painel (login).';
`;

async function main() {
  try {
    await db.query(SQL);
    console.log("Tabela usuarios criada ou já existente.");
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
}

main();
