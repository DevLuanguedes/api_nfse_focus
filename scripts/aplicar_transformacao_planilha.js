/**
 * Aplica a transformação (varredura + regras 070202) em uma planilha do cliente
 * e salva o XLSX no formato Automação 7.02.
 *
 * Uso: node scripts/aplicar_transformacao_planilha.js [caminho_planilha]
 * Ex.: node scripts/aplicar_transformacao_planilha.js "c:\\Users\\linha\\Downloads\\ap_brCreateInvoice_46552632_20260124031856.xlsm"
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { transformarPlanilhaClienteParaAutomacao } = require("../services/planilhaClienteParaAutomacao");

const ENTRADA = process.argv[2] || path.join("c:", "Users", "linha", "Downloads", "ap_brCreateInvoice_46552632_20260124031856.xlsm");
const DIR_SAIDA = path.join(__dirname, "..", "uploads", "transformado");
const NOME_SAIDA = "saida_ap_brCreateInvoice_46552632.xlsx";

async function main() {
  const caminhoEntrada = path.resolve(ENTRADA);
  if (!fs.existsSync(caminhoEntrada)) {
    console.error("Arquivo não encontrado:", caminhoEntrada);
    process.exit(1);
  }

  console.log("Lendo:", caminhoEntrada);
  const buffer = fs.readFileSync(caminhoEntrada);

  console.log("Aplicando transformação (colunas por nome + regras 070202 + IBGE + alíquotas)...");
  const opcoes = { retornarMunicipiosSemAliquota: false, sempreGerarBuffer: true };
  let result;
  try {
    result = await transformarPlanilhaClienteParaAutomacao(buffer, opcoes);
  } catch (err) {
    console.error("Erro na transformação:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }

  let outBuffer = result && typeof result === "object" && result.buffer !== undefined && Buffer.isBuffer(result.buffer) ? result.buffer : result;
  if (!outBuffer) {
    console.error("Nenhum buffer gerado. Resultado:", typeof result);
    process.exit(1);
  }
  if (!Buffer.isBuffer(outBuffer)) {
    outBuffer = Buffer.from(outBuffer);
  }

  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  const caminhoSaida = path.join(DIR_SAIDA, NOME_SAIDA);
  fs.writeFileSync(caminhoSaida, outBuffer);
  console.log("Planilha gerada:", path.resolve(caminhoSaida));
}

main();
