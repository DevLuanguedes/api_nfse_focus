/**
 * Data de emissão para NFSe / planilha.
 * Retorna sempre YYYY-MM-DD no fuso America/Sao_Paulo (evita "amanhã" em UTC vs hoje no Brasil).
 */
const TZ_BR = "America/Sao_Paulo";

function ymdHojeBr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ_BR });
}

function ymdFromExcelSerial(valor) {
  const dias = Math.floor(Number(valor));
  if (Number.isNaN(dias)) return ymdHojeBr();
  const excelEpoch = new Date(1899, 11, 30);
  const dt = new Date(excelEpoch.getTime() + dias * 86400000);
  return dt.toLocaleDateString("en-CA", { timeZone: TZ_BR });
}

module.exports = function parseDataEmissao(valor) {
  if (valor === undefined || valor === null || valor === "") {
    return ymdHojeBr();
  }

  if (typeof valor === "number" && !Number.isNaN(valor)) {
    return ymdFromExcelSerial(valor);
  }

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toLocaleDateString("en-CA", { timeZone: TZ_BR });
  }

  if (typeof valor === "string") {
    const s = valor.trim();
    if (!s) return ymdHojeBr();

    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10);
    }

    const [d, m, y] = s.split("/");
    if (d && m && y) {
      const yy = String(y).trim().padStart(4, "0");
      const mm = String(m).trim().padStart(2, "0");
      const dd = String(d).trim().padStart(2, "0");
      if (/^\d{4}$/.test(yy) && /^\d{2}$/.test(mm) && /^\d{2}$/.test(dd)) {
        return `${yy}-${mm}-${dd}`;
      }
    }
  }

  return ymdHojeBr();
};
