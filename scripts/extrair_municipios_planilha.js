/**
 * Extrai municípios únicos (código IBGE, cidade, UF) de uma planilha tratada
 * (formato Automação 7.02) e gera/atualiza data/aliquotas_municipios.json
 * para você preencher as alíquotas manualmente (quando a API não retorna).
 *
 * Uso: node scripts/extrair_municipios_planilha.js <planilha_tratada.xlsx>
 *      node scripts/extrair_municipios_planilha.js <planilha_tratada.xlsx> --merge
 *
 * Sem --merge: só lista no console os municípios encontrados.
 * Com --merge: atualiza data/aliquotas_municipios.json, mantendo alíquotas
 * já preenchidas e adicionando códigos novos com valor "" para preencher.
 */

const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

const NOME_ABA = "Automação 7.02";

function main() {
  const planilhaPath = process.argv[2];
  const merge = process.argv.includes("--merge");

  if (!planilhaPath) {
    console.error("Uso: node scripts/extrair_municipios_planilha.js <planilha_tratada.xlsx> [--merge]");
    process.exit(1);
  }

  const abs = path.resolve(planilhaPath);
  if (!fs.existsSync(abs)) {
    console.error("Arquivo não encontrado:", abs);
    process.exit(1);
  }

  const wb = XLSX.readFile(abs);
  const sh = wb.Sheets[NOME_ABA] || wb.Sheets[wb.SheetNames[0]];
  if (!sh) {
    console.error("Nenhuma aba encontrada.");
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  if (rows.length < 2) {
    console.error("Planilha sem dados.");
    process.exit(1);
  }

  const header = rows[0].map((h) => (h != null ? String(h).trim() : ""));
  const idxCodigo = header.indexOf("codigo_municipio_servico");
  const idxCidade = header.indexOf("Cidade_Servico");
  const idxUF = header.indexOf("UF_Servico");

  if (idxCodigo < 0 || idxCidade < 0 || idxUF < 0) {
    console.error("Colunas codigo_municipio_servico, Cidade_Servico ou UF_Servico não encontradas.");
    process.exit(1);
  }

  const seen = new Map(); // codigo 7 digitos -> { cidade, uf }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const codigo = String(row[idxCodigo] ?? "").replace(/\D/g, "");
    const cidade = String(row[idxCidade] ?? "").trim();
    const uf = String(row[idxUF] ?? "").trim();
    if (codigo.length === 7 && (cidade || uf)) {
      if (!seen.has(codigo)) seen.set(codigo, { cidade, uf });
    }
  }

  const lista = Array.from(seen.entries())
    .map(([cod, o]) => ({ codigo: cod, cidade: o.cidade, uf: o.uf }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  console.log("Municípios na planilha:", lista.length);
  lista.forEach((m) => console.log("  %s  %s / %s", m.codigo, m.cidade, m.uf));

  if (!merge) {
    console.log("\nPara atualizar data/aliquotas_municipios.json com esses códigos (para preencher alíquotas), rode com --merge");
    return;
  }

  const dataPath = path.resolve(__dirname, "..", "data", "aliquotas_municipios.json");
  let existente = {};
  if (fs.existsSync(dataPath)) {
    try {
      existente = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      Object.keys(existente).forEach((k) => {
        if (!/^\d{7}$/.test(k) || k.startsWith("_")) delete existente[k];
      });
    } catch {
      existente = {};
    }
  }

  const resultado = { _comentario: "Código IBGE (7 dígitos) -> alíquota ISS em %. Preencha e salve." };
  lista.forEach((m) => {
    resultado[m.codigo] = existente[m.codigo] != null && existente[m.codigo] !== "" ? existente[m.codigo] : "";
  });
  Object.keys(existente).forEach((k) => {
    if (/^\d{7}$/.test(k) && !resultado[k]) resultado[k] = existente[k];
  });

  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(resultado, null, 2), "utf8");
  console.log("\nAtualizado:", dataPath);
  console.log("Preencha as alíquotas (em %) nos códigos que estão com \"\" e salve o arquivo.");
}

main();
