/**
 * Cruza cidade e estado (UF) com a API do IBGE para obter o código do município (7 dígitos).
 * API: https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios
 */

const axios = require("axios");

const BASE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades";
const CACHE = new Map();
const TIMEOUT_MS = 15000;

/**
 * Remove acentos e normaliza para comparação (minúsculo, trim).
 */
function normalizarNome(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Busca municípios da UF na API do IBGE (com cache em memória por UF).
 * @param {string} uf - Sigla do estado (SP, RJ, MG, etc.)
 * @returns {Promise<Array<{ id: number, nome: string }>>}
 */
async function buscarMunicipiosPorUF(uf) {
  const sigla = String(uf || "").trim().toUpperCase();
  if (!sigla || sigla.length !== 2) return [];

  if (CACHE.has(sigla)) return CACHE.get(sigla);

  try {
    const { data } = await axios.get(`${BASE_URL}/estados/${sigla}/municipios`, {
      timeout: TIMEOUT_MS,
      headers: { Accept: "application/json" },
    });
    const lista = Array.isArray(data) ? data : [];
    CACHE.set(sigla, lista);
    return lista;
  } catch (err) {
    console.warn("[IBGE] Erro ao buscar municípios da UF", sigla, err.message);
    return [];
  }
}

/**
 * Retorna o código IBGE (7 dígitos) do município a partir do nome da cidade e da UF.
 * Faz correspondência normalizada (sem acento, case insensitive).
 *
 * @param {string} nomeCidade - Nome do município (ex.: "São Paulo", "SAO PAULO", "Bauru")
 * @param {string} uf - Sigla do estado (ex.: "SP")
 * @returns {Promise<string|null>} - Código de 7 dígitos ou null se não encontrar
 */
async function codigoMunicipioPorCidadeEUf(nomeCidade, uf) {
  const nomeNorm = normalizarNome(nomeCidade);
  if (!nomeNorm) return null;

  const municipios = await buscarMunicipiosPorUF(uf);
  for (const m of municipios) {
    const nomeMun = normalizarNome(m.nome);
    if (nomeMun === nomeNorm) return String(m.id).padStart(7, "0");
    if (nomeMun.includes(nomeNorm) || nomeNorm.includes(nomeMun)) {
      return String(m.id).padStart(7, "0");
    }
  }
  return null;
}

/**
 * Preenche codigo_municipio em linhas que tenham Cidade_Servico e UF_Servico
 * mas não tenham codigo_municipio_servico. Modifica o array in-place.
 *
 * @param {Array<object>} linhas - Array de objetos (linhas consolidadas)
 * @param {string} [campoCidade] - Nome do campo da cidade (default: Cidade_Servico)
 * @param {string} [campoUF] - Nome do campo da UF (default: UF_Servico)
 * @param {string} [campoCodigo] - Nome do campo onde gravar o código (default: codigo_municipio_servico)
 */
async function preencherCodigosMunicipio(linhas, campoCidade = "Cidade_Servico", campoUF = "UF_Servico", campoCodigo = "codigo_municipio_servico") {
  for (const linha of linhas) {
    const codigoAtual = linha[campoCodigo];
    if (codigoAtual != null && String(codigoAtual).replace(/\D/g, "").length >= 7) continue;

    const cidade = linha[campoCidade];
    const uf = linha[campoUF];
    if (!cidade || !uf) continue;

    const codigo = await codigoMunicipioPorCidadeEUf(cidade, uf);
    if (codigo) linha[campoCodigo] = codigo;
  }
}

module.exports = {
  buscarMunicipiosPorUF,
  codigoMunicipioPorCidadeEUf,
  preencherCodigosMunicipio,
  normalizarNome,
};
