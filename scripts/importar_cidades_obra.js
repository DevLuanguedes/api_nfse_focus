/**
 * Importa endereços de obra a partir de uma planilha (ex.: Db_Cidades_01.xlsm).
 * Espera colunas: identificador do site (Site Code, Site, SITE), UF (UF_Obra, UF, UF_Servico),
 * CEP_Obra, Logradouro/Logradour, Numero/Numero_Obra, Bairro_Obra/Bairro_Ob/Bairro,
 * Codigo_Municipio_Obra (opcional), Cidade/Cidade_Servico (opcional).
 *
 * Uso: node scripts/importar_cidades_obra.js <caminho-da-planilha>
 * Ex.: node scripts/importar_cidades_obra.js "C:\Users\linha\Dropbox\Luan\Db_Cidades_01.xlsm"
 *      node scripts/importar_cidades_obra.js ./uploads/Db_Cidades_01.xlsm
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { salvar } = require("../services/siteEnderecoObra");

function indiceColuna(headers, ...nomes) {
  if (!Array.isArray(headers) || !headers.length) return null;
  const norm = (s) => (s != null ? String(s).trim().toLowerCase() : "");
  const set = new Set(nomes.map((n) => norm(n)));
  for (let i = 0; i < headers.length; i++) {
    if (set.has(norm(headers[i]))) return i;
  }
  return null;
}

function valor(row, idx) {
  if (idx == null || idx < 0) return "";
  const v = row[idx];
  return v != null && v !== "" ? String(v).trim() : "";
}

async function main() {
  const planilhaPath = process.argv[2];
  if (!planilhaPath) {
    console.error("Uso: node scripts/importar_cidades_obra.js <caminho-da-planilha>");
    console.error('Ex.: node scripts/importar_cidades_obra.js "C:\\Users\\linha\\Dropbox\\Luan\\Db_Cidades_01.xlsm"');
    process.exit(1);
  }

  const resolvedPath = path.resolve(planilhaPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error("Arquivo não encontrado:", resolvedPath);
    process.exit(1);
  }

  let workbook;
  try {
    workbook = XLSX.readFile(resolvedPath, { cellDates: true });
  } catch (err) {
    console.error("Erro ao ler planilha:", err.message);
    process.exit(1);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!raw.length) {
    console.error("Planilha vazia.");
    process.exit(1);
  }

  // Encontrar a linha de cabeçalho (pode ser linha 0 ou 1 se tiver título tipo "PESQUISE POR SITE")
  const nomesConhecidos = ["site", "uf", "cep", "logradouro", "logradour", "numero", "bairro", "cidade", "código", "codigo"];
  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, raw.length); r++) {
    const row = raw[r] || [];
    const texto = row.map((c) => (c != null ? String(c).trim().toLowerCase() : "")).join(" ");
    if (nomesConhecidos.some((n) => texto.includes(n))) {
      headerRowIndex = r;
      break;
    }
  }

  const headers = raw[headerRowIndex] || [];
  const rows = raw.slice(headerRowIndex + 1).filter((row) => row.some((c) => c != null && c !== ""));

  const idxSite = indiceColuna(headers, "Site Code", "Site", "SITE", "SiteCode", "Código Site", "Pesquise por Site");
  const idxUf = indiceColuna(headers, "UF_Obra", "UF", "UF_Servico", "UF Serviço", "Estado");
  const idxCep = indiceColuna(headers, "CEP_Obra", "CEP", "Cep Obra");
  const idxLogradouro = indiceColuna(headers, "Logradouro_Obra", "Logradouro", "Logradour", "Logradouro Obra");
  const idxNumero = indiceColuna(headers, "Numero_Obra", "Numero", "Número", "Número Obra");
  const idxBairro = indiceColuna(headers, "Bairro_Obra", "Bairro_Ob", "Bairro", "Bairro Obra");
  const idxCodMun = indiceColuna(headers, "Codigo_Municipio_Obra", "Codigo_Municipio", "Código Município", "Código IBGE");
  const idxCidade = indiceColuna(headers, "Cidade_Servico", "Cidade", "Cidade Obra", "Município");

  if (idxSite == null && idxUf == null) {
    console.error("Não foi possível encontrar colunas de Site ou UF. Cabeçalhos na linha", headerRowIndex + 1, ":", headers.slice(0, 20).join(" | "));
    process.exit(1);
  }

  // Se só encontrou uma das colunas, usar primeira coluna como site ou última como UF
  const idxSiteFinal = idxSite != null ? idxSite : 0;
  const idxUfFinal = idxUf != null ? idxUf : headers.length - 1;

  console.log("Cabeçalho na linha", headerRowIndex + 1, "| Colunas:", headers.length, "| Site col:", idxSiteFinal, "| UF col:", idxUfFinal, "| CEP:", idxCep, "| Logradouro:", idxLogradouro);
  if (rows.length > 0) {
    const first = rows[0];
    console.log("Primeira linha (amostra): site=", valor(first, idxSiteFinal) || valor(first, 0), "| uf=", valor(first, idxUfFinal), "| cep=", valor(first, idxCep));
  }

  let importados = 0;
  let ignorados = 0;

  for (const row of rows) {
    const site = valor(row, idxSiteFinal) || (idxSite == null ? valor(row, 0) : "");
    const uf = valor(row, idxUfFinal);
    if (!site || !uf) {
      ignorados++;
      continue;
    }
    const ufNorm = uf.toUpperCase().slice(0, 2);
    if (ufNorm.length !== 2) {
      ignorados++;
      continue;
    }

    const cep = valor(row, idxCep).replace(/\D/g, "");
    const logradouro = valor(row, idxLogradouro);
    const numero = valor(row, idxNumero);
    const bairro = valor(row, idxBairro);
    const codMun = valor(row, idxCodMun).replace(/\D/g, "").slice(0, 7);
    const cidade = valor(row, idxCidade);

    const ok = await salvar({
      site_code: site,
      uf_servico: ufNorm,
      cidade_servico: cidade || null,
      cep_obra: cep || null,
      logradouro_obra: logradouro || null,
      numero_obra: numero || null,
      bairro_obra: bairro || null,
      uf_obra: ufNorm,
      codigo_municipio_obra: codMun || null,
    });
    if (ok) {
      importados++;
      console.log("OK:", site, ufNorm, logradouro || cep || "-");
    } else {
      ignorados++;
    }
  }

  console.log("\nConcluído. Importados:", importados, "| Ignorados:", ignorados);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
