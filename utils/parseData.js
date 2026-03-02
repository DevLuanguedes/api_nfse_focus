module.exports = function parseDataEmissao(valor) {
  if (typeof valor === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + valor * 86400000)
      .toISOString();
  }

  if (typeof valor === "string") {
    const [d, m, y] = valor.split("/");
    return new Date(`${y}-${m}-${d}T00:00:00`).toISOString();
  }

  return new Date().toISOString();
};
