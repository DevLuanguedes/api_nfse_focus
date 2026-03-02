const XLSX = require("xlsx");

function lerPlanilha(caminhoArquivo) {
  const workbook = XLSX.readFile(caminhoArquivo);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json(sheet, {
    defval: null
  });
}

module.exports = { lerPlanilha };
