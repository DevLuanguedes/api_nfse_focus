/**
 * Cria a tabela site_endereco_obra para armazenar endereços de obra por site e UF.
 * Chave: (site_code, uf_servico). Rode uma vez: node scripts/criar_tabela_site_endereco_obra.js
 *
 * Requisitos: PostgreSQL rodando e arquivo .env com:
 *   DB_HOST, DB_PORT (opcional, padrão 5432), DB_USER, DB_PASSWORD, DB_NAME
 */

require("dotenv").config();
const db = require("../db");

const SQL = `
CREATE TABLE IF NOT EXISTS site_endereco_obra (
  site_code VARCHAR(60) NOT NULL,
  uf_servico CHAR(2) NOT NULL,
  cidade_servico VARCHAR(120),
  cep_obra VARCHAR(20),
  logradouro_obra VARCHAR(200),
  numero_obra VARCHAR(30),
  bairro_obra VARCHAR(120),
  uf_obra CHAR(2),
  codigo_municipio_obra CHAR(7),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (site_code, uf_servico)
);

COMMENT ON TABLE site_endereco_obra IS 'Endereço da obra por site e UF do serviço. Usado na transformação da planilha para preencher CEP_Obra, Logradouro_Obra, etc.';
`;

async function main() {
  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
  if (!hasDb) {
    console.error("Configure o .env com: DATABASE_URL (Fly) ou DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (local)");
    process.exit(1);
  }
  try {
    await db.query(SQL);
    console.log("Tabela site_endereco_obra criada ou já existente.");
  } catch (err) {
    console.error("Erro no banco:", err.message);
    if (err.message.includes("connect") || err.message.includes("ECONNREFUSED")) {
      console.error("Verifique se o PostgreSQL está rodando e se .env está correto (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).");
    }
    if (err.message.includes("password") || err.message.includes("authentication")) {
      console.error("Verifique DB_USER e DB_PASSWORD no .env.");
    }
    process.exit(1);
  }
}

main();
