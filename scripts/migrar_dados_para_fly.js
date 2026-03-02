/**
 * Copia dados do banco LOCAL para o banco no FLY (municipio_aliquota_iss e site_endereco_obra).
 * NÃO copia usuarios — use o script criar_usuario_admin.js no Fly para isso.
 *
 * Uso (na pasta do projeto):
 *   Defina FLY_DATABASE_URL com a connection string do Postgres no Fly (veja DEPLOY-FLY.md).
 *   Opção 1 - Com tunnel: fly proxy 15433:5432 -a api-sig-db  (local:remota; Postgres escuta na 5432)
 *             Depois: set FLY_DATABASE_URL=postgres://postgres:SUA_SENHA@127.0.0.1:15433/postgres
 *   Opção 2 - Connection string externa do dashboard Fly (Postgres app → Connect).
 *
 *   node scripts/migrar_dados_para_fly.js
 *
 * O .env local deve ter DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (origem).
 */

require("dotenv").config();
const { Pool } = require("pg");

const LOCAL_CONFIG = process.env.LOCAL_DATABASE_URL
  ? { connectionString: process.env.LOCAL_DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER,
      password: String(process.env.DB_PASSWORD || ""),
      database: process.env.DB_NAME,
    };

const FLY_DATABASE_URL = process.env.FLY_DATABASE_URL || process.env.TARGET_DATABASE_URL;

if (!FLY_DATABASE_URL) {
  console.error("Defina FLY_DATABASE_URL (ou TARGET_DATABASE_URL) com a connection string do Postgres no Fly.");
  console.error("Ex.: FLY_DATABASE_URL=postgres://usuario:senha@host:5432/postgres node scripts/migrar_dados_para_fly.js");
  process.exit(1);
}

// Tunnel (localhost) não usa SSL; evita ECONNRESET
const flyConfig = { connectionString: FLY_DATABASE_URL };
if (FLY_DATABASE_URL.includes("127.0.0.1") || FLY_DATABASE_URL.includes("localhost")) {
  flyConfig.ssl = false;
  flyConfig.connectionTimeoutMillis = 10000;
}

const localPool = new Pool(LOCAL_CONFIG);
const flyPool = new Pool(flyConfig);

const TABELAS = [
  {
    nome: "municipio_aliquota_iss",
    colunas: ["codigo_ibge", "cidade", "uf", "aliquota", "created_at", "updated_at"],
    pk: "codigo_ibge",
  },
  {
    nome: "site_endereco_obra",
    colunas: [
      "site_code", "uf_servico", "cidade_servico", "cep_obra", "logradouro_obra",
      "numero_obra", "bairro_obra", "uf_obra", "codigo_municipio_obra", "created_at", "updated_at"
    ],
    pk: ["site_code", "uf_servico"],
  },
];

function escapeVal(val) {
  if (val == null) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (val instanceof Date) return `'${val.toISOString()}'`;
  return "'" + String(val).replace(/'/g, "''") + "'";
}

async function copiarTabela(tabela) {
  const { nome, colunas, pk } = tabela;
  const cols = colunas.join(", ");
  const placeholders = colunas.map((_, i) => `$${i + 1}`).join(", ");
  const upsertCols = colunas.filter(c => !(Array.isArray(pk) ? pk : [pk]).includes(c));
  const conflictTarget = Array.isArray(pk) ? pk.join(", ") : pk;
  const updateSet = upsertCols.map(c => `${c} = EXCLUDED.${c}`).join(", ");

  const res = await localPool.query(`SELECT ${cols} FROM ${nome}`);
  const rows = res.rows;
  if (rows.length === 0) {
    console.log(`  [${nome}] Nenhum registro local, pulando.`);
    return 0;
  }

  let inseridos = 0;
  for (const row of rows) {
    const values = colunas.map(c => row[c]);
    const sql = `
      INSERT INTO ${nome} (${cols})
      VALUES (${placeholders})
      ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateSet}
    `;
    try {
      await flyPool.query(sql, values);
      inseridos++;
    } catch (err) {
      console.error(`  [${nome}] Erro ao inserir linha:`, err.message);
    }
  }
  console.log(`  [${nome}] ${inseridos}/${rows.length} registros copiados/atualizados.`);
  return inseridos;
}

async function main() {
  console.log("Migrando dados: LOCAL → FLY (municipio_aliquota_iss, site_endereco_obra). Usuários NÃO são copiados.\n");

  try {
    await localPool.query("SELECT 1");
    console.log("Conexão LOCAL ok.");
  } catch (err) {
    console.error("Erro ao conectar no banco LOCAL:", err.message);
    process.exit(1);
  }

  try {
    await flyPool.query("SELECT 1");
    console.log("Conexão FLY ok.\n");
  } catch (err) {
    console.error("Erro ao conectar no banco FLY:", err.message);
    if (err.code === "ECONNRESET" || err.code === "ECONNREFUSED") {
      console.error("\n→ Se estiver usando tunnel: deixe RODANDO em outro terminal: fly proxy 15433 -a api-sig-db");
      console.error("→ Depois defina FLY_DATABASE_URL com porta 15433: postgres://USUARIO:SENHA@127.0.0.1:15433/postgres");
    }
    process.exit(1);
  }

  for (const tabela of TABELAS) {
    await copiarTabela(tabela);
  }

  await localPool.end();
  await flyPool.end();
  console.log("\nMigração concluída.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
