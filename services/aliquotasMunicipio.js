/**
 * Obtém alíquota de ISS por município (código IBGE 7 dígitos).
 *
 * Fontes (em ordem de tentativa):
 * 1. Banco de dados (tabela municipio_aliquota_iss) - seu cadastro
 * 2. Arquivo local data/aliquotas_municipios.json (opcional)
 * 3. API do Sistema Nacional NFSe (ADN) - Parâmetros Municipais
 */

const axios = require("axios");
const path = require("path");
const fs = require("fs");

let _db = null;
function getDb() {
  if (_db === null) {
    try {
      _db = require("../db");
    } catch {
      _db = false;
    }
  }
  return _db || null;
}

/** Bases oficiais: produção e produção restrita (homologação). Tentamos as duas. */
const ADN_BASES = [
  "https://adn.nfse.gov.br/parametrizacao",
  "https://adn.producaorestrita.nfse.gov.br/parametrizacao",
];
const CACHE = new Map(); // codigo -> aliquota (número ou null)
const TIMEOUT_MS = 8000;

/** Caminho do arquivo de fallback (código IBGE -> aliquota) */
function caminhoAliquotasLocal() {
  return path.resolve(__dirname, "..", "data", "aliquotas_municipios.json");
}

/**
 * Carrega tabela local de alíquotas (se existir).
 * @returns {Object.<string, string|number>} mapa codigoIBGE -> aliquota
 */
function carregarAliquotasLocal() {
  const p = caminhoAliquotasLocal();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return {};
    const out = {};
    for (const [key, val] of Object.entries(data)) {
      if (/^\d{7}$/.test(String(key).trim()) && (val != null && val !== "")) out[key.trim()] = val;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Consulta alíquotas na API ADN (Sistema Nacional NFSe).
 * Retorno esperado (exemplo): array de objetos com alíquota por item de lista de serviço.
 *
 * @param {string} codigoMunicipio - Código IBGE 7 dígitos
 * @returns {Promise<number|null>} - Alíquota em % (ex.: 5) ou null
 */
async function aliquotaPorAPI(codigoMunicipio) {
  const codigo = String(codigoMunicipio || "").replace(/\D/g, "");
  if (codigo.length !== 7) return null;

  const pathAliquotas = `parametros_municipais/${codigo}/aliquotas`;
  for (const base of ADN_BASES) {
    const url = `${base}/${pathAliquotas}`;
    try {
      const { data, status } = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: { Accept: "application/json" },
        validateStatus: () => true,
      });
      if (status !== 200 || data == null) continue;
      // Resposta pode ser array de { itemLista, aliquota, ... } ou objeto
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        const aliq = first.aliquota ?? first.Aliquota ?? first.aliq;
        if (aliq != null) return Number(aliq);
      }
      if (typeof data === "object" && data.aliquota != null) return Number(data.aliquota);
      if (typeof data === "object" && data.Aliquota != null) return Number(data.Aliquota);
    } catch {
      // tenta próxima base
    }
  }
  return null;
}

/**
 * Busca alíquota no banco (tabela municipio_aliquota_iss).
 * @param {string} codigoIbge - Código IBGE 7 dígitos
 * @returns {Promise<number|null>}
 */
async function aliquotaPorBanco(codigoIbge) {
  const codigo = String(codigoIbge || "").replace(/\D/g, "");
  if (codigo.length !== 7) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const r = await db.query(
      "SELECT aliquota FROM municipio_aliquota_iss WHERE codigo_ibge = $1",
      [codigo]
    );
    if (r.rows && r.rows[0] != null) {
      const num = Number(r.rows[0].aliquota);
      return Number.isFinite(num) ? num : null;
    }
  } catch {
    // tabela pode não existir
  }
  return null;
}

/**
 * Salva ou atualiza alíquota no banco (municipio_aliquota_iss).
 * @param {string} codigoIbge - Código IBGE 7 dígitos
 * @param {string} [cidade] - Nome do município
 * @param {string} [uf] - UF
 * @param {number|string} aliquota - Alíquota em % (ex.: 5 ou "5")
 * @returns {Promise<boolean>}
 */
async function salvarAliquotaMunicipio(codigoIbge, cidade, uf, aliquota) {
  const codigo = String(codigoIbge || "").replace(/\D/g, "");
  if (codigo.length !== 7) return false;
  const num = Number(aliquota);
  if (!Number.isFinite(num)) return false;
  const db = getDb();
  if (!db) return false;
  try {
    await db.query(
      `INSERT INTO municipio_aliquota_iss (codigo_ibge, cidade, uf, aliquota, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (codigo_ibge) DO UPDATE SET
         cidade = COALESCE(EXCLUDED.cidade, municipio_aliquota_iss.cidade),
         uf = COALESCE(EXCLUDED.uf, municipio_aliquota_iss.uf),
         aliquota = EXCLUDED.aliquota,
         updated_at = NOW()`,
      [codigo, cidade || null, (uf || "").trim().toUpperCase().slice(0, 2) || null, num]
    );
    CACHE.set(codigo, num);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna a alíquota de ISS para um município (código IBGE 7 dígitos).
 * Ordem: cache -> banco -> arquivo local -> API ADN.
 *
 * @param {string} codigoMunicipio - Código IBGE 7 dígitos (ex.: "3550308")
 * @param {object} [opcoes] - { usarBanco, usarLocal, usarAPI } (default true)
 * @returns {Promise<number|null>} - Alíquota em % (ex.: 5) ou null
 */
async function aliquotaPorMunicipio(codigoMunicipio, opcoes = {}) {
  const codigo = String(codigoMunicipio || "").replace(/\D/g, "");
  if (codigo.length !== 7) return null;

  if (CACHE.has(codigo)) return CACHE.get(codigo);

  const usarBanco = opcoes.usarBanco !== false;
  const usarLocal = opcoes.usarLocal !== false;
  const usarAPI = opcoes.usarAPI !== false;

  if (usarBanco) {
    const num = await aliquotaPorBanco(codigo);
    if (num != null) {
      CACHE.set(codigo, num);
      return num;
    }
  }

  if (usarLocal) {
    const local = carregarAliquotasLocal();
    const val = local[codigo];
    if (val != null && val !== "") {
      const num = Number(val);
      if (Number.isFinite(num)) {
        CACHE.set(codigo, num);
        return num;
      }
    }
  }

  if (usarAPI) {
    const num = await aliquotaPorAPI(codigo);
    CACHE.set(codigo, num);
    return num;
  }

  CACHE.set(codigo, null);
  return null;
}

/**
 * Preenche aliquota_iss nas linhas que tenham codigo_municipio_servico
 * e ainda não tenham aliquota_iss (ou tenham vazio).
 * Modifica o array in-place.
 *
 * @param {Array<object>} linhas - Linhas consolidadas (com codigo_municipio_servico)
 * @param {string} [campoCodigo] - Campo do código do município (default: codigo_municipio_servico)
 * @param {string} [campoAliquota] - Campo onde gravar a alíquota (default: aliquota_iss)
 */
async function preencherAliquotasMunicipio(
  linhas,
  campoCodigo = "codigo_municipio_servico",
  campoAliquota = "aliquota_iss"
) {
  for (const linha of linhas) {
    const aliquotaAtual = linha[campoAliquota];
    if (aliquotaAtual != null && String(aliquotaAtual).trim() !== "") continue;

    const codigo = linha[campoCodigo];
    if (!codigo) continue;

    const codigoStr = String(codigo).replace(/\D/g, "");
    if (codigoStr.length < 7) continue;

    const aliquota = await aliquotaPorMunicipio(codigoStr);
    if (aliquota != null) linha[campoAliquota] = aliquota;
  }
}

module.exports = {
  aliquotaPorMunicipio,
  aliquotaPorAPI,
  aliquotaPorBanco,
  salvarAliquotaMunicipio,
  preencherAliquotasMunicipio,
  carregarAliquotasLocal,
  caminhoAliquotasLocal,
};
