/**
 * Script para testar o método varreduraConsolidar.
 * Uso: node scripts/testar_varredura_consolidar.js [caminho_planilha]
 *
 * Exemplo (planilha com aba Varredura):
 *   node scripts/testar_varredura_consolidar.js "C:\Users\linha\Dropbox\Luan\automacao_NFSE_7.02.xlsm"
 *
 * Se não passar caminho, tenta o caminho acima e depois "uploads/planilha.xlsx".
 */

const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const {
  varreduraConsolidar,
  ehFormatoVarredura,
  COL,
} = require("../services/varreduraConsolidar");

const CAMINHOS_PADRAO = [
  path.join(process.env.USERPROFILE || "", "Dropbox", "Luan", "automacao_NFSE_7.02.xlsm"),
  path.join(__dirname, "..", "uploads", "planilha.xlsx"),
];

function main() {
  const caminhoArg = process.argv[2];
  const candidatos = caminhoArg ? [path.resolve(caminhoArg)] : CAMINHOS_PADRAO;

  let workbook;
  let caminhoUsado;

  for (const p of candidatos) {
    if (fs.existsSync(p)) {
      try {
        workbook = XLSX.readFile(p, { type: "file", cellDates: true });
        caminhoUsado = p;
        break;
      } catch (e) {
        console.warn("Erro ao ler", p, e.message);
      }
    }
  }

  if (!workbook) {
    console.error("Nenhuma planilha encontrada. Passe o caminho:");
    console.error('  node scripts/testar_varredura_consolidar.js "C:\\Users\\linha\\Dropbox\\Luan\\automacao_NFSE_7.02.xlsm"');
    process.exit(1);
  }

  const sheetName = workbook.SheetNames.includes("Varredura")
    ? "Varredura"
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!raw.length) {
    console.error("Planilha sem dados.");
    process.exit(1);
  }

  const headers = raw[0];
  const rows = raw.slice(1).filter((row) => row.some((c) => c != null && c !== ""));

  console.log("Arquivo:", caminhoUsado);
  console.log("Aba:", sheetName);
  console.log("Linhas de dados (após cabeçalho):", rows.length);
  console.log("Colunas (total):", headers.length);
  console.log("");

  if (headers.length <= COL.CHAVE) {
    console.warn("Aviso: planilha tem menos de 61 colunas. Coluna BI (índice 60) pode estar vazia.");
  }

  const ehVarredura = ehFormatoVarredura(headers);
  console.log("Formato Varredura (>= 61 colunas):", ehVarredura);
  console.log("");

  const resultado = varreduraConsolidar(rows, headers);

  console.log("=== RESULTADO DA CONSOLIDAÇÃO ===");
  console.log("Grupos (linhas consolidadas):", resultado.length);
  console.log("");

  resultado.forEach((linha, i) => {
    console.log(`--- Grupo ${i + 1} ---`);
    console.log("  Ref:", linha.Ref);
    console.log("  valor_servico:", linha.valor_servico);
    console.log("  Cidade_Servico:", linha.Cidade_Servico);
    console.log("  UF_Servico:", linha.UF_Servico);
    console.log("  item_lista_servico:", linha.item_lista_servico);
    if (linha.PO_Line_text) console.log("  PO_Line_text (início):", String(linha.PO_Line_text).slice(0, 80) + (linha.PO_Line_text.length > 80 ? "..." : ""));
    if (linha.Customer) console.log("  Customer:", linha.Customer);
    if (linha.CNPJ) console.log("  CNPJ:", linha.CNPJ);
    console.log("");
  });

  const outPath = path.join(__dirname, "..", "uploads", "teste_varredura_resultado.json");
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(resultado, null, 2), "utf8");
    console.log("Resultado completo salvo em:", outPath);
  } catch (e) {
    console.warn("Não foi possível salvar JSON:", e.message);
  }
}

main();
