/**
 * Replica a lógica da macro VBA "Varredura_Consolidar_Somar_Preencher".
 * Agrupa linhas da planilha Varredura (formato portal) por coluna BI,
 * soma valores (CS), concatena "PO: X Line Y", extrai UF/Município de BH
 * e código serviço de AL. Retorna uma linha por grupo no formato usado pela API Focus.
 *
 * Colunas Varredura (índices 0-based):
 *   R=17 (PO No.), T=19 (Line No.), AL=37 (LC Code), BH=59 (Location), BI=60 (chave), CS=96 (valor)
 */

const COL = {
  PO: 17,           // R - PO No.
  LINE: 19,        // T - Line No.
  LC_CODE: 37,     // AL - Service code (7.02 -> 070202, 7.03 -> 070203)
  LOCATION: 59,    // BH - BR_UF_MUNICIPIO_TAX
  CHAVE: 60,       // BI - chave (fallback quando não há "site")
  VALOR: 96,       // CS - valor a somar (TOTAL)
  UNIT_PRICE: 34,  // Unit Price
  AC_QTY: 23,      // AC Qty
  PARCELA_AC: 16,  // Parcela/AC (fallback)
};

/**
 * Encontra o índice da coluna pelo nome do cabeçalho (case insensitive).
 * @param {Array<string>} headers - Linha de cabeçalho
 * @param {...string} nomes - Nomes possíveis (ex.: "site", "Site Code")
 * @returns {number|null}
 */
function indiceColuna(headers, ...nomes) {
  if (!Array.isArray(headers) || !headers.length) return null;
  const norm = (s) => (s != null ? String(s).trim().toLowerCase() : "");
  const set = new Set(nomes.map((n) => norm(n)));
  for (let i = 0; i < headers.length; i++) {
    if (set.has(norm(headers[i]))) return i;
  }
  return null;
}

/**
 * Extrai "BI tratado": parte após último ">", depois parte antes do primeiro "_".
 * @param {string} textoBI - Valor da célula BI
 * @returns {string}
 */
function extrairBITratado(textoBI) {
  if (textoBI == null || textoBI === "") return "";
  let parteFinal = String(textoBI).trim();
  const idxMaior = parteFinal.lastIndexOf(">");
  if (idxMaior >= 0) parteFinal = parteFinal.slice(idxMaior + 1).trim();
  const idxUnder = parteFinal.indexOf("_");
  if (idxUnder >= 0) parteFinal = parteFinal.slice(0, idxUnder).trim();
  return parteFinal;
}

/**
 * Extrai o Site Code quando a célula vem no formato "xxx<!>xxx<!>SITECODE_rest".
 * Ex.: '200040266884000<!>20241022268163<!>T15_SP522535_00D07924848327_SP' → "T15"
 * Regra: valor entre o 2º "<!>" e o próximo "_".
 * @param {string} valor - Valor da coluna (ex.: Manufacturer / Site Code)
 * @returns {string}
 */
function extrairSiteCodeEntreSegundoDelimitador(valor) {
  if (valor == null || valor === "") return "";
  const s = String(valor).trim();
  const delim = "<!>";
  const idx1 = s.indexOf(delim);
  if (idx1 < 0) return "";
  const idx2 = s.indexOf(delim, idx1 + delim.length);
  if (idx2 < 0) return "";
  const inicio = idx2 + delim.length;
  const idxUnder = s.indexOf("_", inicio);
  const fim = idxUnder >= 0 ? idxUnder : s.length;
  return s.slice(inicio, fim).trim();
}

/**
 * Monta texto "PO: X Line Y" a partir das células R e T.
 * @param {string} po - Valor coluna R
 * @param {string} line - Valor coluna T
 * @returns {string}
 */
function montarTextoPOLine(po, line) {
  const r = (po != null && po !== "") ? String(po).trim() : "";
  const t = (line != null && line !== "") ? String(line).trim() : "";
  if (r === "") return "";
  let texto = "PO: " + r;
  if (t !== "") texto += " Line " + t;
  return texto;
}

/**
 * Extrai UF e Município do valor da coluna BH (ex.: BR_SP_SAO PAULO_TAX ou BR_PB_CABEDELO_Tax,CABEDELO).
 * Quando há vírgula, usa apenas a primeira parte (formato BR_UF_MUNICIPIO_Tax) para não misturar com texto após a vírgula.
 * @param {string} location - Valor célula BH
 * @returns {{ uf: string, municipio: string }}
 */
function extrairUFMunicipio(location) {
  if (location == null || location === "") return { uf: "", municipio: "" };
  let raw = String(location).trim();
  // Se tiver vírgula, usar só a primeira parte (BR_UF_MUNICIPIO_Tax) para extrair UF e município
  if (raw.indexOf(",") >= 0) raw = raw.split(",")[0].trim();
  let texto = raw.replace(/BR_/gi, "").replace(/_Tax/gi, "").replace(/_TAX/gi, "");
  const partes = texto.split("_");
  const uf = (partes[0] || "").trim().toUpperCase().slice(0, 2);
  const municipio = partes.length > 1 ? partes.slice(1).join(" ").trim() : "";
  return { uf, municipio };
}

/**
 * Extrai cidade e UF de uma célula "PO Ship To" (ex.: "SAO PAULO / SP", "Cidade - SP", "Cidade, SP").
 * @param {string} texto - Valor da coluna PO Ship To
 * @returns {{ uf: string, municipio: string }}
 */
function extrairCidadeUfDePoShipTo(texto) {
  if (texto == null || texto === "") return { uf: "", municipio: "" };
  const s = String(texto).trim();
  if (!s) return { uf: "", municipio: "" };
  const separadores = [" / ", " - ", " – ", ", ", " | ", "  "];
  for (const sep of separadores) {
    const partes = s.split(sep);
    if (partes.length >= 2) {
      const ultima = partes[partes.length - 1].trim().toUpperCase();
      if (ultima.length === 2 && /^[A-Z]{2}$/.test(ultima)) {
        const municipio = partes.slice(0, -1).join(sep).trim();
        return { uf: ultima, municipio };
      }
    }
  }
  if (s.length >= 3 && /^[A-Z]{2}$/.test(s.slice(-2).toUpperCase())) {
    return { uf: s.slice(-2).toUpperCase(), municipio: s.slice(0, -2).trim() };
  }
  return { uf: "", municipio: "" };
}

/**
 * Deriva item_lista_servico (CTN 6 dígitos) do LC Code (coluna AL).
 * Se contém "7.02" -> 070202; "7.03.02" -> 070302; "7.03" -> 070203.
 * @param {string} lcCode - Valor coluna AL
 * @returns {string}
 */
function codigoServicoDeAL(lcCode) {
  if (lcCode == null || lcCode === "") return "";
  const s = String(lcCode).toUpperCase().replace(/,/g, ".");
  if (s.indexOf("7.02") >= 0) return "070202";
  if (s.indexOf("7.03.02") >= 0) return "070302";
  if (s.indexOf("7.03") >= 0) return "070203";
  return "";
}

/**
 * Consolida linhas por Site Code (ou BI se não houver coluna site).
 * Valor bruto = Unit Price * AC Qty por linha, somado por grupo.
 *
 * Ref = [PO]-[Line]-[Parcela/AC]-[Valor] (da primeira linha do grupo),
 * ex.: "46552632-1-1-1234.56".
 * É equivalente a: [@PO]&"-"&[@Line]&"-"&[@[Parcela/AC]]&"-"&[@valor_servico]
 * (usando o valor total consolidado do grupo).
 *
 * @param {Array<Array>} rows - Linhas de dados (cada linha é array por índice de coluna)
 * @param {Array<string>} [headers] - Cabeçalho (para resolver nomes: site, Unit Price, AC Qty, Parcela/AC)
 * @param {object} [opts] - Colunas customizadas (0-based)
 * @returns {Array<object>}
 */
function varreduraConsolidar(rows, headers, opts = {}) {
  const col = {
    chave: opts.groupBy ?? COL.CHAVE,
    po: opts.po ?? COL.PO,
    line: opts.line ?? COL.LINE,
    location: opts.location ?? COL.LOCATION,
    serviceCode: opts.serviceCode ?? COL.LC_CODE,
    value: opts.value ?? COL.VALOR,
    unitPrice: opts.unitPrice ?? COL.UNIT_PRICE,
    acQty: opts.acQty ?? COL.AC_QTY,
    parcelaAC: opts.parcelaAC ?? COL.PARCELA_AC,
    cidade: opts.cidade ?? null,
    uf: opts.uf ?? null,
    poShipTo: opts.poShipTo ?? null,
  };

  const dictTexto = new Map();
  const dictSoma = new Map();
  const dictUF = new Map();
  const dictMunicipio = new Map();
  const dictServico = new Map();
  const dictFirstRow = new Map();
  const dictRef = new Map();
  const dictChaveParaRowIndices = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const chaveVal = row[col.chave];
    let chave = chaveVal != null ? String(chaveVal).trim() : "";
    if (chave.indexOf("<!>") >= 0) {
      const extraido = extrairSiteCodeEntreSegundoDelimitador(chaveVal);
      if (extraido) chave = extraido;
    }
    if (chave === "") continue;

    const resultadoTexto = montarTextoPOLine(row[col.po], row[col.line]);
    const unitPrice = Number(row[col.unitPrice]) || 0;
    const acQty = Number(row[col.acQty]) || 0;
    const valorBruto = unitPrice * acQty;
    const valorCS = Number(row[col.value]) || 0;
    const valorSoma = valorBruto > 0 ? valorBruto : valorCS;
    // Cidade e UF: coluna BH (PO Ship To) pode vir em formato "BR_UF_MUNICIPIO" ou "Cidade / UF"
    let uf = "";
    let municipio = "";
    if (col.poShipTo != null) {
      const valorBH = row[col.poShipTo];
      const loc = extrairUFMunicipio(valorBH);
      if (loc.uf && loc.municipio) {
        uf = loc.uf;
        municipio = loc.municipio;
      } else {
        const shipTo = extrairCidadeUfDePoShipTo(valorBH);
        uf = shipTo.uf || "";
        municipio = shipTo.municipio || "";
      }
    }
    if ((!uf || !municipio) && col.location != null) {
      const loc = extrairUFMunicipio(row[col.location]);
      if (loc.uf) uf = loc.uf;
      if (loc.municipio) municipio = loc.municipio;
    }
    const codigoServico = codigoServicoDeAL(row[col.serviceCode]);

    const poStr = (row[col.po] != null && row[col.po] !== "") ? String(row[col.po]).trim() : "";
    const lineStr = (row[col.line] != null && row[col.line] !== "") ? String(row[col.line]).trim() : "";
    const parcelaStr = (row[col.parcelaAC] != null && row[col.parcelaAC] !== "") ? String(row[col.parcelaAC]).trim() : "";
    const refLinha = [poStr, lineStr, parcelaStr].filter(Boolean).join("-");

    // 7.03: agrupar só pelo prefixo da PO (parte antes do "-"), independente do Site. Ex.: 6211HG2963610-171 e 6211HG2963610-172 → 1 NF.
    const poPrefix = (poStr.indexOf("-") >= 0 ? poStr.split("-")[0] : poStr).trim() || poStr;
    const chaveAgrupamento = (codigoServico === "070203")
      ? "703|" + poPrefix
      : chave;

    if (dictTexto.has(chaveAgrupamento)) {
      if (resultadoTexto !== "") {
        dictTexto.set(chaveAgrupamento, dictTexto.get(chaveAgrupamento) + "  " + resultadoTexto);
      }
      dictSoma.set(chaveAgrupamento, dictSoma.get(chaveAgrupamento) + valorSoma);
      if (codigoServico !== "") dictServico.set(chaveAgrupamento, codigoServico);
      dictChaveParaRowIndices.get(chaveAgrupamento).push(i);
    } else {
      dictTexto.set(chaveAgrupamento, resultadoTexto);
      dictSoma.set(chaveAgrupamento, valorSoma);
      dictUF.set(chaveAgrupamento, uf);
      dictMunicipio.set(chaveAgrupamento, municipio);
      dictFirstRow.set(chaveAgrupamento, row);
      dictServico.set(chaveAgrupamento, codigoServico);
      dictRef.set(chaveAgrupamento, refLinha || chave);
      dictChaveParaRowIndices.set(chaveAgrupamento, [i]);
    }
  }

  // Fallback 1: PO Ship To (cidade e UF na mesma coluna)
  if (col.poShipTo != null) {
    for (const chave of dictTexto.keys()) {
      const firstRow = dictFirstRow.get(chave);
      if (dictMunicipio.get(chave) === "" || dictUF.get(chave) === "") {
        const shipTo = extrairCidadeUfDePoShipTo(firstRow[col.poShipTo]);
        if (shipTo.municipio && dictMunicipio.get(chave) === "") dictMunicipio.set(chave, shipTo.municipio);
        if (shipTo.uf && dictUF.get(chave) === "") dictUF.set(chave, shipTo.uf);
      }
    }
  }
  // Fallback 2: colunas separadas Cidade e UF
  if (col.cidade != null || col.uf != null) {
    for (const chave of dictTexto.keys()) {
      const firstRow = dictFirstRow.get(chave);
      if (dictMunicipio.get(chave) === "" && col.cidade != null) {
        const v = firstRow[col.cidade];
        if (v != null && String(v).trim() !== "") dictMunicipio.set(chave, String(v).trim());
      }
      if (dictUF.get(chave) === "" && col.uf != null) {
        const v = firstRow[col.uf];
        if (v != null && String(v).trim() !== "") dictUF.set(chave, String(v).trim().toUpperCase().slice(0, 2));
      }
    }
  }

  const CUSTOMER = 0;
  const CNPJ_COL = 16;
  const idxRetInss = indiceColuna(headers, "INSS Rate", "RET. INSS");
  const resultado = [];
  for (const chave of dictTexto.keys()) {
    const firstRow = dictFirstRow.get(chave);
    // Para 7.03 a chave é "703|prefixoPO" (sem site); site para exibição vem da primeira linha do grupo
    let sitePuro = chave;
    if (chave.startsWith("703|")) {
      const raw = firstRow[col.chave];
      if (raw != null && String(raw).indexOf("<!>") >= 0) sitePuro = extrairSiteCodeEntreSegundoDelimitador(raw) || String(raw).trim();
      else sitePuro = String(raw ?? "").trim();
    } else if (chave.indexOf("|703|") >= 0) sitePuro = chave.split("|703|")[0];
    // Ref = PO + "-" + Line + "-" + Parcela/AC + "-" + Valor (primeira linha + valor consolidado do grupo)
    const poR = (firstRow[col.po] != null && firstRow[col.po] !== "") ? String(firstRow[col.po]).trim() : "";
    const lineR = (firstRow[col.line] != null && firstRow[col.line] !== "") ? String(firstRow[col.line]).trim() : "";
    const parcelaR = (firstRow[col.parcelaAC] != null && firstRow[col.parcelaAC] !== "") ? String(firstRow[col.parcelaAC]).trim() : "";
    const soma = Number(dictSoma.get(chave) ?? 0);
    const valorR = Number.isFinite(soma) ? soma.toFixed(2) : "";
    const refMontada = [poR, lineR, parcelaR, valorR].filter(Boolean).join("-") || dictRef.get(chave) || chave;

    const rowObj = {};
    rowObj.Customer = firstRow[CUSTOMER];
    rowObj.CNPJ = firstRow[CNPJ_COL];
    rowObj.Ref = refMontada;
    rowObj.valor_servico = Number.isFinite(soma) ? Number(soma.toFixed(2)) : dictSoma.get(chave);
    rowObj.Cidade_Servico = dictMunicipio.get(chave) ?? "";
    rowObj.UF_Servico = dictUF.get(chave) ?? "";
    rowObj.item_lista_servico = dictServico.get(chave) || "";
    rowObj.site = sitePuro;
    rowObj.PO_Line_text = dictTexto.get(chave);
    rowObj._firstPO = firstRow[col.po];
    rowObj._firstLine = firstRow[col.line];
    rowObj._firstParcelaAC = firstRow[col.parcelaAC];
    if (idxRetInss != null) rowObj["INSS Rate"] = firstRow[idxRetInss];
    rowObj._rowIndices = dictChaveParaRowIndices.get(chave) || [];
    resultado.push(rowObj);
  }

  return resultado;
}

/**
 * Detecta se a planilha é formato "Varredura/portal" (tem coluna BI com chave e colunas R, T, CS, BH, AL).
 * Recebe a primeira linha (cabeçalho) como array ou objeto.
 */
function ehFormatoVarredura(headerRow) {
  const arr = Array.isArray(headerRow)
    ? headerRow
    : Object.keys(headerRow || {});
  return arr.length > COL.CHAVE;
}

module.exports = {
  varreduraConsolidar,
  extrairBITratado,
  extrairSiteCodeEntreSegundoDelimitador,
  montarTextoPOLine,
  extrairUFMunicipio,
  codigoServicoDeAL,
  ehFormatoVarredura,
  indiceColuna,
  COL,
};
