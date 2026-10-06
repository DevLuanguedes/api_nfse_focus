/**
 * Indica se o subitem da lista de serviço (CTN 6 dígitos) exige o Grupo Obra
 * (E0370: CEP_Obra, Logradouro_Obra, Numero_Obra, Bairro_Obra, UF_Obra,
 * Codigo_Municipio_Obra). Subitens citados no erro E0370 (07.02.01, 07.02.02,
 * 07.04.01, 07.05.01, 07.05.02, 07.06.01, 07.06.02, 07.07.01, 07.08.01,
 * 07.17.01, 07.19.01). Fonte única usada tanto na emissão (routes/upload.js)
 * quanto na transformação da planilha (services/siteEnderecoObra.js), pra não
 * ter duas listas que podem ficar dessincronizadas.
 */
const SUBITENS_OBRA = new Set([
  "070201",
  "070202",
  "070401",
  "070501",
  "070502",
  "070601",
  "070602",
  "070701",
  "070801",
  "071701",
  "071901",
]);

function isSubitemObra(ctn6) {
  const s = String(ctn6 || "").replace(/\D/g, "").padStart(6, "0");
  return SUBITENS_OBRA.has(s);
}

module.exports = { isSubitemObra };
