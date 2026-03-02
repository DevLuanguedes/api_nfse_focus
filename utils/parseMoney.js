module.exports = function parseMoney(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;

  // Se já veio número do Excel
  if (typeof valor === "number") return valor;

  let v = String(valor).trim();

  // remove R$, espaços e %
  v = v.replace(/[R$\s%]/g, "");

  // remove separador de milhar (1.234,56)
  v = v.replace(/\.(?=\d{3})/g, "");

  // troca vírgula decimal por ponto
  v = v.replace(",", ".");

  const n = Number(v);
  return isNaN(n) ? 0 : n;
};
