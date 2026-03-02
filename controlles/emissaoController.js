const mapLinhaParaFocus = require("../utils/mapLinhaFocus");

exports.emitirNotas = async (req, res) => {
  const { linhasPlanilha, prestador } = req.body;

  const notas = [];

  for (const linha of linhasPlanilha) {
    const jsonFocus = await mapLinhaParaFocus(linha, prestador);
    notas.push(jsonFocus);
  }

  res.json({
    sucesso: true,
    total: notas.length,
    exemplo: notas[0]
  });
};
