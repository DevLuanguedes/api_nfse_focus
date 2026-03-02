/**
 * Cria a tabela municipio_aliquota_iss para armazenar alíquotas de ISS por município.
 * Rode uma vez: node scripts/criar_tabela_municipio_aliquota_iss.js
 */

require("dotenv").config();
const db = require("../db");

const SQL = `
CREATE TABLE IF NOT EXISTS municipio_aliquota_iss (
  codigo_ibge CHAR(7) PRIMARY KEY,
  cidade VARCHAR(120),
  uf CHAR(2),
  aliquota NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE municipio_aliquota_iss IS 'Alíquotas de ISS por município (código IBGE 7 dígitos). Preenchido ao cadastrar na transformação ou ao emitir NF.';
`;

async function main() {
  try {
    await db.query(SQL);
    console.log("Tabela municipio_aliquota_iss criada ou já existente.");
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
}

main();
