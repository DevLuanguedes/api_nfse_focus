// db.js
require('dotenv').config();
const { Pool } = require('pg');

const POSTGRES_DEFAULT_PORT = 5432;

// Fly.io Postgres fornece DATABASE_URL; localmente use DB_HOST, DB_USER, etc.
let config;
if (process.env.DATABASE_URL) {
  let connectionString = String(process.env.DATABASE_URL).trim();
  if (connectionString.includes(":9/") || connectionString.match(/:9$/)) {
    connectionString = connectionString.replace(/:9(\/|$)/g, `:${POSTGRES_DEFAULT_PORT}$1`);
  }
  // Fly Postgres: host .flycast → .internal; rede interna não usa SSL
  if (connectionString.includes("api-sig-db.flycast") || connectionString.includes("api-sig-db.internal")) {
    connectionString = connectionString.replace("api-sig-db.flycast", "api-sig-db.internal");
    connectionString = connectionString.replace(/([?&])sslmode=[^&]*/g, "").replace(/\?&/, "?").replace(/\?$/, "");
    if (!connectionString.includes("sslmode=")) {
      connectionString += connectionString.includes("?") ? "&sslmode=disable" : "?sslmode=disable";
    }
  }
  config = { connectionString };
} else {
  let port = Number(process.env.DB_PORT || POSTGRES_DEFAULT_PORT);
  if (port === 9 || port === Number("9")) {
    port = POSTGRES_DEFAULT_PORT;
    console.warn("[db] DB_PORT era 9; usando 5432.");
  }
  config = {
    host: process.env.DB_HOST || "localhost",
    port,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME,
  };
}

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('[db] Erro no pool:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
