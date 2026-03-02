module.exports = function parseBoolean(valor) {
  if (typeof valor === "boolean") return valor;
  if (!valor) return false;
  return String(valor).toLowerCase() === "true";
};
