/**
 * Cria todas as tabelas necessárias no banco (usuarios, notas_fiscais, municipio_aliquota_iss, site_endereco_obra).
 * Útil no Fly.io: fly ssh console -a api-sig-premcell → node scripts/criar_todas_tabelas.js
 */

require("dotenv").config();
const db = require("../db");

const SCRIPTS = [
  {
    name: "usuarios",
    sql: `
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
  `,
  },
  {
    name: "notas_fiscais",
    sql: `
    CREATE TABLE IF NOT EXISTS notas_fiscais (
      id SERIAL PRIMARY KEY,
      ref_api VARCHAR(100) NOT NULL UNIQUE,
      numero_nf VARCHAR(50),
      serie_nf VARCHAR(20),
      codigo_verificacao VARCHAR(100),
      status_nf VARCHAR(50),
      tipo_procedimento VARCHAR(60),
      cliente_nome VARCHAR(255),
      cliente_documento VARCHAR(32),
      cliente_email VARCHAR(255),
      valor_servicos NUMERIC(15,2),
      aliquota NUMERIC(7,4),
      valor_iss NUMERIC(15,2),
      data_emissao TIMESTAMP WITH TIME ZONE,
      criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      payload_envio JSONB,
      payload_retorno JSONB
    );
  `,
  },
  {
    name: "municipio_aliquota_iss",
    sql: `
    CREATE TABLE IF NOT EXISTS municipio_aliquota_iss (
      codigo_ibge CHAR(7) PRIMARY KEY,
      cidade VARCHAR(120),
      uf CHAR(2),
      aliquota NUMERIC(5,2) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `,
  },
  {
    name: "site_endereco_obra",
    sql: `
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
  `,
  },
];

async function main() {
  const hasDb = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
  if (!hasDb) {
    console.error("Configure DATABASE_URL (Fly) ou DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (local).");
    process.exit(1);
  }
  try {
    const tabs = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const dbs = await db.query("SELECT datname FROM pg_database WHERE datistemplate = false");
    const outrosBancos = dbs.rows.map((r) => r.datname).filter((d) => !["postgres", "template0", "template1"].includes(d));

    if (tabs.rows.length === 0 && outrosBancos.length > 0) {
      console.warn("\n*** AVISO: Este banco está vazio e existem outros bancos:", outrosBancos.join(", "));
      console.warn("*** Seus dados podem estar em outro banco. Rode: node scripts/listar_bancos_e_tabelas.js");
      console.warn("*** Se estiver certo, pressione Ctrl+C para cancelar ou aguarde 5s para continuar...\n");
      await new Promise((r) => setTimeout(r, 5000));
    }

    for (const { name, sql } of SCRIPTS) {
      await db.query(sql);
      console.log("Tabela", name, "criada ou já existente.");
    }
    console.log("Todas as tabelas prontas.");
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
}

main();
