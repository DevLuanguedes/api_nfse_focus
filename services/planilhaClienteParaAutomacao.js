/**
 * Recebe a planilha do cliente (formato portal) e devolve um arquivo XLSX
 * no formato "Automação 7.02", pronto para upload na API e emissão de NF.
 *
 * Se informar templatePath (caminho do automacao_NFSE_7.02.xlsm), usa a aba
 * "Automação 7.02" como modelo: mesma ordem de colunas e larguras, e mantém
 * as outras abas (ISS_Base, Dados, etc.) no arquivo de saída.
 */

const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const { varreduraConsolidar, ehFormatoVarredura, indiceColuna, extrairUFMunicipio, COL } = require("./varreduraConsolidar");
const { preencherCodigosMunicipio } = require("./ibgeMunicipios");
const { preencherAliquotasMunicipio } = require("./aliquotasMunicipio");
const { preencherEnderecosObra } = require("./siteEnderecoObra");
const prestador = require("../config/prestador");
const tomadorFixo = require("../config/tomadorFixo");

/** Nome da aba de saída (igual ao da macro) */
const NOME_ABA_SAIDA = "Automação 7.02";

/** Ordem das colunas da planilha Automação 7.02 (quando não há template) */
const HEADER_AUTOMACAO_702 = [
  "Razão Social", "Nome Fantasia", "Documento_Tomador", "E-mail", "Logradouro", "Número", "Complemento",
  "Cidade_Tomador", "Codigo_Municipio_Tomador", "Bairro", "UF_Tomador", "telefone_tomador", "CEP",
  "HUAWEI", "data_emissao", "Ref", "Parcela/AC", "PO", "Line", "Cidade_Servico", "UF_Servico",
  "codigo_municipio_servico", "Valor Liquido", "valor_servico", "outras_retencoes", "valor_inss", "valor_iss",
  "valor_iss_retido", "RET. INSS", "item_lista_servico", "descricao_servico", "aliquota_iss", "iss_retido",
  "optante_simples_nacional", "natureza_operacao", "tributacao_iss", "cnpj_prestador", "CEP_Obra",
  "Logradouro_Obra", "Numero_Obra", "Bairro_Obra", "UF_Obra", "Codigo_Municipio_Obra", "SITE",
];

/**
 * Regras de tributação por item_lista_servico (código LC 116).
 * Cada código define os campos fixos e as fórmulas (valor_inss, valor_iss, Valor Liquido, etc.).
 *
 * Regra completa 070202 (confirmada):
 *   RET. INSS = 3.5
 *   iss_retido = 2
 *   optante_simples_nacional = false
 *   natureza_operacao = 2
 *   tributacao_iss = 1
 *   valor_inss = valor_servico * (aliquota_inss/100)
 *   valor_iss = valor_servico * (aliquota_iss/100)
 *   valor_iss_retido = valor_servico * (aliquota_iss/100)
 *   Valor Liquido = valor_servico - valor_iss - valor_inss
 */
const REGRAS_TRIBUTACAO_POR_SERVICO = {
  // 7.02 – obras (com INSS retido)
  "070202": {
    retInss: 3.5,
    iss_retido: 2,
    optante_simples_nacional: false,
    natureza_operacao: 2,
    tributacao_iss: 1,
    aliquota_inss: 3.5,
  },
  // 7.03 – serviços sem INSS (apenas ISS 2% + IR/PIS/COFINS/CSLL na Focus)
  // Aqui controlamos apenas o que impacta a planilha: sem INSS, ISS retido e regime.
  "070203": {
    retInss: 0,                    // sem retenção de INSS
    iss_retido: 2,                 // ISSQN retido pelo tomador
    optante_simples_nacional: false,
    natureza_operacao: 2,
    tributacao_iss: 1,
    // NÃO definimos aliquota_inss -> valor_inss fica 0 na planilha
  },
};

/**
 * Aplica as regras de tributação conforme o código do serviço da planilha.
 * Preenche todos os campos definidos na regra (fixos e calculados).
 * @param {Array<object>} consolidado - Linhas consolidadas (mutadas no lugar)
 */
function aplicarRegrasTributacaoPorServico(consolidado) {
  const round2 = (n) => Math.round(n * 100) / 100;

  for (const linha of consolidado) {
    // Normaliza código de serviço para 6 dígitos (ex.: "07020300" -> "070203")
    let codigo = String(linha.item_lista_servico ?? "").replace(/\D/g, "");
    if (!codigo) continue;
    if (codigo.length > 6) codigo = codigo.slice(0, 6);
    if (codigo.length < 6) codigo = codigo.padStart(6, "0");
    const regra = REGRAS_TRIBUTACAO_POR_SERVICO[codigo];
    if (!regra) continue;

    const valorServico = Number(linha.valor_servico);
    if (!Number.isFinite(valorServico)) continue;

    // Para 7.03, a alíquota de ISS é sempre 2% e não há INSS.
    // Cidade de serviço e código do município de prestação: sempre Bauru/SP (3506003).
    if (codigo === "070203") {
      linha.aliquota_iss = 2;
      linha.valor_inss = 0;
      linha.Cidade_Servico = "BAURU";
      linha.UF_Servico = "SP";
      linha.codigo_municipio_servico = "3506003";
    }

    const aliquotaIssRaw = linha.aliquota_iss ?? "";
    const aliquotaIss = Number(String(aliquotaIssRaw).replace(",", "."));
    const aliquotaInss = regra.aliquota_inss != null ? Number(regra.aliquota_inss) : null;

    // Campos fixos (sempre aplicar para o código 070202)
    if (regra["RET. INSS"] != null) linha["RET. INSS"] = regra["RET. INSS"];
    else if (regra.retInss != null) linha["RET. INSS"] = regra.retInss;
    if (regra.iss_retido != null) linha.iss_retido = regra.iss_retido;
    if (regra.optante_simples_nacional !== undefined) linha.optante_simples_nacional = regra.optante_simples_nacional;
    if (regra.natureza_operacao != null) linha.natureza_operacao = regra.natureza_operacao;
    if (regra.tributacao_iss != null) linha.tributacao_iss = regra.tributacao_iss;

    // Calculados: valor_inss, valor_iss, valor_iss_retido
    if (Number.isFinite(aliquotaInss)) {
      linha.valor_inss = round2(valorServico * (aliquotaInss / 100));
    }
    if (Number.isFinite(aliquotaIss)) {
      linha.valor_iss = round2(valorServico * (aliquotaIss / 100));
      linha.valor_iss_retido = round2(valorServico * (aliquotaIss / 100));
    } else {
      linha.valor_iss = 0;
      linha.valor_iss_retido = 0;
    }

    // Valor Liquido = valor_servico - valor_iss - valor_inss
    const valorIss = Number(linha.valor_iss) || 0;
    const valorInss = Number(linha.valor_inss) || 0;
    linha["Valor Liquido"] = round2(valorServico - valorIss - valorInss);
  }
}

/**
 * Monta a descrição do serviço no formato da planilha Automação 7.02.
 * PO_Line_text já contém todas as POs e Lines do grupo (ex.: "PO: 46552632 Line 1  PO: 46552632 Line 2").
 */
function montarDescricaoServico(linha) {
  // Todas as POs e Lines do grupo (concatenadas na varredura), ex.: "PO: 46552632 Line 1  PO: 46552632 Line 2"
  const poLineTexto = (linha.PO_Line_text != null && String(linha.PO_Line_text).trim() !== "")
    ? String(linha.PO_Line_text).trim()
    : (linha._firstPO != null || linha._firstLine != null
        ? "PO: " + (linha._firstPO ?? "").toString().trim() + " LINE: " + (linha._firstLine ?? "").toString().trim()
        : "");
  const cidade = String(linha.Cidade_Servico ?? "").trim();
  const uf = String(linha.UF_Servico ?? "").trim();
  const valor = Number(linha.valor_servico);
  const valorFormatado = Number.isFinite(valor) ? valor.toFixed(2) : "";
  const aliquota = linha.aliquota_iss ?? linha["ISS Rate"] ?? "";
  const retInss = linha["RET. INSS"] ?? linha["INSS Rate"] ?? "";

  // Descobrir CTN normalizado (6 dígitos) para diferenciar 7.02 x 7.03
  let codigo = String(linha.item_lista_servico ?? "").replace(/\D/g, "");
  if (codigo.length > 6) codigo = codigo.slice(0, 6);
  if (codigo.length < 6) codigo = codigo.padStart(6, "0");

  // Descrição especial para 7.03
  if (codigo === "070203") {
    const base = Number.isFinite(valor) ? valor : 0;
    const round2 = (n) => Math.round(n * 100) / 100;

    const aliqPis = 0.0065;   // 0,65%
    const aliqCof = 0.03;     // 3,0%
    const aliqIr = 0.015;     // 1,5%
    const aliqCsll = 0.01;    // 1,0%

    const vPis = round2(base * aliqPis).toFixed(2);
    const vCof = round2(base * aliqCof).toFixed(2);
    const vIr = round2(base * aliqIr).toFixed(2);
    const vCsll = round2(base * aliqCsll).toFixed(2);

    const partes703 = [
      "Elaboração de projetos de obras de construção civil e elétrica, referente a adequação de infraestrutura, instalação e montagem de equipamentos de rede de telefonia celular,",
      "conforme pedidos de compra abaixo: " + poLineTexto,
      `Retenções: PIS 0,65% R$ ${vPis} COFINS 3% R$ ${vCof} IRRF 1,5% R$ ${vIr} CSLL 1% R$ ${vCsll}`,
    ];
    return partes703.filter(Boolean).join(" ");
  }

  // Descrição padrão (7.02 e demais)
  const partes = [
    "Execução por empreitada de obras de construção civil e elétrica – adequação de infraestrutura, instalação e montagem de equipamentos de rede de telefonia celular, conforme pedidos de compra abaixo:",
    poLineTexto,
    "MUNICIPIO: " + cidade + " / " + uf,
    "MATERIAL:",
    "SERVIÇO: " + valorFormatado,
    "BASE DE CÁLCULO ISS: " + valorFormatado,
    "BASE DE CÁLCULO INSS: " + valorFormatado,
    "Retenções ISS " + aliquota + "% Município: " + cidade + " / " + uf,
    "Retenções INSS " + retInss + "%",
    "NFS-e: O ISS desta NFS-e será retido pelo tomador de serviço.",
  ];
  return partes.filter(Boolean).join(" ");
}

/**
 * Mapeia uma linha consolidada (portal + resultado da varredura) para o formato
 * que a API / planilha "Automação 7.02" espera.
 */
function linhaConsolidadaParaAutomacao(linha) {
  const parcelaAC = linha._firstParcelaAC != null ? String(linha._firstParcelaAC).trim() : "";
  const poTexto = linha.PO_Line_text ?? "";
  const firstPO = linha._firstPO != null ? String(linha._firstPO).trim() : "";
  const firstLine = linha._firstLine != null ? String(linha._firstLine).trim() : "";

  return {
    Ref: linha.Ref ?? "",
    "Razão Social": tomadorFixo.razao_social ?? "",
    "Nome Fantasia": tomadorFixo.nome_fantasia ?? "",
    Documento_Tomador: tomadorFixo.documento_tomador ?? "",
    "E-mail": tomadorFixo.email ?? "",
    Logradouro: tomadorFixo.logradouro ?? "",
    Número: tomadorFixo.numero ?? "",
    Complemento: tomadorFixo.complemento ?? "",
    Cidade_Tomador: tomadorFixo.cidade_tomador ?? "",
    Codigo_Municipio_Tomador: tomadorFixo.codigo_municipio_tomador ?? "",
    Bairro: tomadorFixo.bairro ?? "",
    UF_Tomador: tomadorFixo.uf_tomador ?? "",
    telefone_tomador: tomadorFixo.telefone_tomador ?? "",
    CEP: tomadorFixo.cep ?? "",
    HUAWEI: "",
    data_emissao: "", // preenchido com fórmula =HOJE() na planilha
    "Parcela/AC": parcelaAC,
    PO: poTexto,
    Line: firstLine,
    Cidade_Servico: linha.Cidade_Servico ?? "",
    UF_Servico: linha.UF_Servico ?? "",
    codigo_municipio_servico: linha.codigo_municipio_servico ?? "",
    "Valor Liquido": linha["Valor Liquido"] ?? linha.valor_servico ?? "",
    valor_servico: linha.valor_servico ?? "",
    outras_retencoes: "",
    valor_inss: linha.valor_inss ?? "",
    valor_iss: linha.valor_iss ?? "",
    valor_iss_retido: linha.valor_iss_retido ?? "",
    "RET. INSS": linha["RET. INSS"] ?? linha["INSS Rate"] ?? "",
    item_lista_servico: linha.item_lista_servico ?? "",
    descricao_servico: montarDescricaoServico(linha),
    aliquota_iss: linha.aliquota_iss ?? linha["ISS Rate"] ?? "",
    iss_retido: linha.iss_retido ?? "",
    optante_simples_nacional: linha.optante_simples_nacional ?? "",
    natureza_operacao: linha.natureza_operacao ?? 1,
    tributacao_iss: linha.tributacao_iss ?? 1,
    cnpj_prestador: prestador.cnpj_prestador ?? linha.cnpj_prestador ?? "",
    CEP_Obra: linha.CEP_Obra ?? "",
    Logradouro_Obra: linha.Logradouro_Obra ?? "",
    Numero_Obra: linha.Numero_Obra ?? "",
    Bairro_Obra: linha.Bairro_Obra ?? "",
    UF_Obra: linha.UF_Obra ?? "",
    Codigo_Municipio_Obra: linha.Codigo_Municipio_Obra ?? "",
    SITE: linha.site ?? linha["Site Code"] ?? "",
    codigo_nbs: linha.codigo_nbs ?? "101025210",
  };
}

/**
 * Lê o template (automacao_NFSE_7.02.xlsm) e retorna { header, cols } da aba "Automação 7.02".
 */
function lerTemplateAutomacao(templatePath) {
  if (!templatePath || !fs.existsSync(templatePath)) return null;
  try {
    const wb = XLSX.readFile(templatePath);
    const sh = wb.Sheets[NOME_ABA_SAIDA];
    if (!sh) return null;
    const raw = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
    const header = (raw[0] && raw[0].length) ? raw[0] : HEADER_AUTOMACAO_702;
    return { header, cols: sh["!cols"] || null, workbook: wb };
  } catch {
    return null;
  }
}

/**
 * Converte objeto de linha (chave = nome da coluna) em array na ordem do header.
 */
function linhaParaArray(linhaObj, header) {
  return header.map((h) => {
    const v = linhaObj[h];
    return v === undefined || v === null ? "" : v;
  });
}

/** Converte índice de coluna (0-based) em letra Excel (0=A, 14=O, 26=AA). */
function colunaParaLetra(idx) {
  let s = "";
  let i = idx;
  while (i >= 0) {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

/** Converte letra Excel em índice 0-based. AN=39, BZ=77, etc. */
function letraParaIndice(letras) {
  const s = String(letras || "").trim().toUpperCase();
  if (!s) return null;
  let idx = 0;
  for (let i = 0; i < s.length; i++) {
    idx = idx * 26 + (s.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/** Colunas fixas do portal (AN, AO, AP, AR, BH, BZ, CA, CB, CC–CJ, CQ, BK–BM) - usadas na transformação */
const COL_PORTAL = {
  BH: letraParaIndice("BH"),
  ISS_RATE: letraParaIndice("AN"),
  INSS_BASE_RATE: letraParaIndice("AO"),
  INSS_RATE: letraParaIndice("AP"),
  PCC_RATE: letraParaIndice("AR"),
  ISS_CITY: letraParaIndice("BZ"),
  ISS_STATE: letraParaIndice("CA"),
  ISS_BASE: letraParaIndice("CB"),
  INVOICE_AMOUNT: letraParaIndice("BP"),
  SERVICE_CODE: letraParaIndice("CC"),
  ISS_TYPE: letraParaIndice("CD"),
  INVOICE_TYPE_BR: letraParaIndice("BK"),
  DOC_FISCAL: letraParaIndice("BL"),
  SERIES: letraParaIndice("BM"),
  INSS_BASE_CN: letraParaIndice("CE"),
  INSS_RATE_CN: letraParaIndice("CF"),
  IR_TAX_CN: letraParaIndice("CG"),
  IR_CATEGORY: letraParaIndice("CH"),
  IR_BASE_CN: letraParaIndice("CI"),
  IR_RATE_CN: letraParaIndice("CJ"),
  PCC_CODE_CN: letraParaIndice("CQ"),
  LC_CODE: 37,
};

/** Na planilha original do cliente: valor como texto no formato 0.00 (ponto), para não conflitar com Excel em formato brasileiro. */
function numeroPlanilhaOriginal(val) {
  const n = Number(String(val ?? "").replace(",", "."));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

/** Célula na planilha original: texto no formato "0.00" (ponto), evita conflito com formato numérico brasileiro. */
function celulaNumeroOriginal(val) {
  return { t: "s", v: String(numeroPlanilhaOriginal(val).toFixed(2)) };
}

/** Indica se o código de serviço é 702 (7.02 / 070202). */
function ehCodigo702(val) {
  if (val == null) return false;
  const s = String(val).trim();
  return s.indexOf("7.02") >= 0 || s.replace(/[^0-9]/g, "") === "702";
}

/** Indica se o código de serviço é 703 (7.03 / 070203). */
function ehCodigo703(val) {
  if (val == null) return false;
  const s = String(val).trim().replace(/\D/g, "");
  return s === "070203" || s === "000703" || (s.length >= 3 && s.slice(0, 3) === "703");
}

/**
 * Preenche campos na planilha original do cliente (formato portal) para que
 * possa ser submetida no portal para abrir solicitações de invoice.
 * Colunas fixas: AN=ISS Rate, AO=INSS Base Rate, AP=INSS Rate, BZ=ISS_City, CA=ISS_State, CB=ISS_Base, BP=Invoice Amount.
 * Cidade e UF são extraídos da coluna BH (formato BR_UF_CIDADE_Tax, ex: BR_GO_GOIANESIA_Tax).
 * Números e rates: sempre formato 0.00 (ponto decimal, sem vírgula).
 */
function preencherPlanilhaOriginal(workbook, sheetName, headers, consolidado, rows) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return;

  const numCols = Array.isArray(headers) ? headers.length : 0;
  const usarColunasFixas = numCols > (COL_PORTAL.ISS_BASE ?? 79);

  const colBH = usarColunasFixas ? COL_PORTAL.BH : (indiceColuna(headers, "PO Ship To", "BH", "PO Ship TO") ?? COL.LOCATION);
  const colServiceCode = usarColunasFixas ? COL_PORTAL.LC_CODE : (indiceColuna(headers, "LC Code", "AL", "Service Code") ?? COL.LC_CODE);
  const idxIssRate = usarColunasFixas ? COL_PORTAL.ISS_RATE : indiceColuna(headers, "ISS Rate", "ISS Rate.");
  const idxInssBaseRate = usarColunasFixas ? COL_PORTAL.INSS_BASE_RATE : indiceColuna(headers, "INSS Base Rate", "INSS Base");
  const idxInssRate = usarColunasFixas ? COL_PORTAL.INSS_RATE : indiceColuna(headers, "INSS Rate", "INSS Rate.");
  const idxIssCity = usarColunasFixas ? COL_PORTAL.ISS_CITY : indiceColuna(headers, "ISS_City", "ISS City", "Cidade_Servico");
  const idxIssState = usarColunasFixas ? COL_PORTAL.ISS_STATE : indiceColuna(headers, "ISS_State", "ISS State", "UF_Servico");
  const idxIssBase = usarColunasFixas ? COL_PORTAL.ISS_BASE : indiceColuna(headers, "ISS_Base", "ISS Base");
  const idxInvoiceAmount = usarColunasFixas ? COL_PORTAL.INVOICE_AMOUNT : indiceColuna(headers, "Invoice Amount (Incl, Tax)*", "Invoice Amount");
  const idxServiceCode = usarColunasFixas ? COL_PORTAL.SERVICE_CODE : indiceColuna(headers, "Service_Code", "CC");
  const idxIssType = usarColunasFixas ? COL_PORTAL.ISS_TYPE : indiceColuna(headers, "ISS_TYPE", "CD");
  const idxInvoiceTypeBr = usarColunasFixas ? COL_PORTAL.INVOICE_TYPE_BR : indiceColuna(headers, "Invoice Type(Brazil)", "BK");
  const idxDocFiscal = usarColunasFixas ? COL_PORTAL.DOC_FISCAL : indiceColuna(headers, "DOC_Fiscal", "BL");
  const idxSeries = usarColunasFixas ? COL_PORTAL.SERIES : indiceColuna(headers, "Series", "BM");
  const idxInssBaseCn = usarColunasFixas ? COL_PORTAL.INSS_BASE_CN : indiceColuna(headers, "INSS税基", "CE");
  const idxInssRateCn = usarColunasFixas ? COL_PORTAL.INSS_RATE_CN : indiceColuna(headers, "INSS税率", "CF");
  const idxIrTaxCn = usarColunasFixas ? COL_PORTAL.IR_TAX_CN : indiceColuna(headers, "是否含IR税金", "CG");
  const idxPccRate = usarColunasFixas ? COL_PORTAL.PCC_RATE : indiceColuna(headers, "PCC Rate", "AR");
  const idxIrCategory = usarColunasFixas ? COL_PORTAL.IR_CATEGORY : indiceColuna(headers, "IR_Category", "CH");
  const idxIrBaseCn = usarColunasFixas ? COL_PORTAL.IR_BASE_CN : indiceColuna(headers, "IR税基", "CI");
  const idxIrRateCn = usarColunasFixas ? COL_PORTAL.IR_RATE_CN : indiceColuna(headers, "IR税率", "CJ");
  const idxPccCodeCn = usarColunasFixas ? COL_PORTAL.PCC_CODE_CN : indiceColuna(headers, "PCC代扣税码", "CQ");

  for (const item of consolidado) {
    const rowIndices = item._rowIndices || [];
    const itemCodigo = String(item.item_lista_servico ?? "").replace(/\D/g, "");
    const eh703 = itemCodigo === "070203" || itemCodigo === "000703" || itemCodigo.slice(0, 3) === "703";

    for (const rowIdx of rowIndices) {
      const excelRow = rowIdx + 4;
      const row = rows && rows[rowIdx] ? rows[rowIdx] : null;

      // 7.03: cidade/UF vêm do item (BAURU/SP). Demais: extrair da coluna BH da planilha original.
      let cidade = "";
      let uf = "";
      if (eh703) {
        cidade = (item.Cidade_Servico ?? "").trim() || "";
        uf = (item.UF_Servico ?? "").trim().toUpperCase().slice(0, 2) || "";
      } else if (row != null && colBH != null) {
        const valorBH = row[colBH];
        const extraido = extrairUFMunicipio(valorBH);
        uf = extraido.uf || "";
        cidade = extraido.municipio || "";
      }
      if (idxIssCity != null && cidade) {
        sheet[colunaParaLetra(idxIssCity) + excelRow] = { t: "s", v: cidade };
      }
      if (idxIssState != null && uf) {
        sheet[colunaParaLetra(idxIssState) + excelRow] = { t: "s", v: uf };
      }

      if (idxIssRate != null && !eh703 && (item.aliquota_iss != null || item["ISS Rate"] != null)) {
        const v = item.aliquota_iss ?? item["ISS Rate"];
        if (v !== "" && v != null) sheet[colunaParaLetra(idxIssRate) + excelRow] = celulaNumeroOriginal(v);
      }
      if (idxInssBaseRate != null) sheet[colunaParaLetra(idxInssBaseRate) + excelRow] = celulaNumeroOriginal(eh703 ? 0 : 100);
      if (idxInssRate != null && (item["RET. INSS"] != null || item["INSS Rate"] != null)) {
        const v = item["RET. INSS"] ?? item["INSS Rate"];
        if (v !== "" && v != null) sheet[colunaParaLetra(idxInssRate) + excelRow] = celulaNumeroOriginal(v);
      }
      if (idxIssBase != null && item.valor_servico != null && !eh703) {
        sheet[colunaParaLetra(idxIssBase) + excelRow] = celulaNumeroOriginal(item.valor_servico);
      }
      if (idxInvoiceAmount != null && item.valor_servico != null) {
        sheet[colunaParaLetra(idxInvoiceAmount) + excelRow] = celulaNumeroOriginal(item.valor_servico);
      }

      // 7.02: preenche Service Code, ISS Type, etc. do portal
      if (row != null && colServiceCode != null && ehCodigo702(row[colServiceCode])) {
        if (idxServiceCode != null) sheet[colunaParaLetra(idxServiceCode) + excelRow] = { t: "s", v: "7.02 INSTALACAO" };
        if (idxIssType != null) sheet[colunaParaLetra(idxIssType) + excelRow] = { t: "s", v: "SUBSTITUTE" };
        if (idxInvoiceTypeBr != null) sheet[colunaParaLetra(idxInvoiceTypeBr) + excelRow] = { t: "s", v: "141-SP" };
        if (idxDocFiscal != null) sheet[colunaParaLetra(idxDocFiscal) + excelRow] = { t: "s", v: "NFS_E" };
        if (idxSeries != null) sheet[colunaParaLetra(idxSeries) + excelRow] = { t: "s", v: "0" };
        if (idxInssBaseCn != null && item.valor_servico != null) sheet[colunaParaLetra(idxInssBaseCn) + excelRow] = celulaNumeroOriginal(item.valor_servico);
        if (idxInssRateCn != null) sheet[colunaParaLetra(idxInssRateCn) + excelRow] = { t: "s", v: "3.5" };
        if (idxIrTaxCn != null) sheet[colunaParaLetra(idxIrTaxCn) + excelRow] = { t: "s", v: "4" };
      }

      // 7.03: preenche colunas do portal conforme especificação (AN=0, AR=0, CB=0, CD=NORMAL, CG=1, CH/CI/CJ/CQ)
      if (eh703) {
        if (idxIssRate != null) sheet[colunaParaLetra(idxIssRate) + excelRow] = celulaNumeroOriginal(0);
        if (idxPccRate != null) sheet[colunaParaLetra(idxPccRate) + excelRow] = celulaNumeroOriginal(0);
        if (idxIssBase != null) sheet[colunaParaLetra(idxIssBase) + excelRow] = celulaNumeroOriginal(0);
        if (idxServiceCode != null) sheet[colunaParaLetra(idxServiceCode) + excelRow] = { t: "s", v: "7.03 ELABORACAO PROJETOS" };
        if (idxIssType != null) sheet[colunaParaLetra(idxIssType) + excelRow] = { t: "s", v: "NORMAL" };
        if (idxInvoiceTypeBr != null) sheet[colunaParaLetra(idxInvoiceTypeBr) + excelRow] = { t: "s", v: "141-SP" };
        if (idxDocFiscal != null) sheet[colunaParaLetra(idxDocFiscal) + excelRow] = { t: "s", v: "NFS_E" };
        if (idxSeries != null) sheet[colunaParaLetra(idxSeries) + excelRow] = { t: "s", v: "0" };
        if (idxInssBaseCn != null) sheet[colunaParaLetra(idxInssBaseCn) + excelRow] = celulaNumeroOriginal(0);
        if (idxInssRateCn != null) sheet[colunaParaLetra(idxInssRateCn) + excelRow] = celulaNumeroOriginal(0);
        if (idxIrTaxCn != null) sheet[colunaParaLetra(idxIrTaxCn) + excelRow] = { t: "s", v: "1" };
        if (idxIrCategory != null) sheet[colunaParaLetra(idxIrCategory) + excelRow] = { t: "s", v: "17080150" };
        if (idxIrBaseCn != null && item.valor_servico != null) sheet[colunaParaLetra(idxIrBaseCn) + excelRow] = celulaNumeroOriginal(item.valor_servico);
        if (idxIrRateCn != null) sheet[colunaParaLetra(idxIrRateCn) + excelRow] = celulaNumeroOriginal(1.5);
        if (idxPccCodeCn != null) sheet[colunaParaLetra(idxPccCodeCn) + excelRow] = { t: "s", v: "BR_PCC_P_4.65" };
      }
    }
  }
}

/**
 * Lê a planilha do cliente (buffer ou caminho), aplica a lógica da macro
 * e retorna um buffer XLSX no formato "Automação 7.02".
 *
 * @param {Buffer|string} entrada - Buffer do arquivo .xlsx/.xlsm ou caminho do arquivo
 * @param {object} [opcoes] - { templatePath, retornarMunicipiosSemAliquota: boolean }
 * @returns {Promise<Buffer|{ buffer: Buffer|null, municipiosSemAliquota: Array }>}
 */
async function transformarPlanilhaClienteParaAutomacao(entrada, opcoes = {}) {
  const workbook =
    Buffer.isBuffer(entrada)
      ? XLSX.read(entrada, { type: "buffer", cellDates: true })
      : XLSX.readFile(entrada, { cellDates: true });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!raw.length) {
    throw new Error("Planilha do cliente está vazia.");
  }

  // Pré-tratamento: excluir linhas 1 e 3 (índices 0 e 2); depois a linha 1 vira cabeçalho
  const semLinhas1e3 = raw.filter((_, i) => i !== 0 && i !== 2);
  if (semLinhas1e3.length < 2) {
    throw new Error("Após excluir linhas 1 e 3, a planilha precisa ter pelo menos cabeçalho e uma linha de dados.");
  }
  const headers = semLinhas1e3[0];
  const rows = semLinhas1e3.slice(1);

  if (!rows.length) {
    throw new Error("Planilha do cliente não tem linhas de dados (após o cabeçalho).");
  }

  const { indiceColuna } = require("./varreduraConsolidar");
  // Resolver colunas pelo nome do cabeçalho (planilha do cliente pode ter ordem diferente)
  const idxChave = indiceColuna(headers, "Site Code", "BI", "Chave", "SiteCode", "Manufacturer");
  const idxLocation = indiceColuna(headers, "Location", "BH", "LOCATION", "Local", "Local de Serviço", "Local de Prestação");
  const idxPoShipTo = indiceColuna(headers, "PO Ship To", "PO Ship To.", "Ship To", "ShipTo", "PO ShipTo");
  const idxCidade = indiceColuna(headers, "Cidade", "City", "Município", "Municipio", "Cidade_Servico", "Cidade Serviço");
  const idxUF = indiceColuna(headers, "UF", "State", "Estado", "UF_Servico", "UF Serviço");
  const idxServiceCode = indiceColuna(headers, "LC Code", "AL", "LC_CODE", "Service Code", "Código Serviço");
  const idxValue = indiceColuna(headers, "TOTAL", "CS", "Valor", "Total");
  const idxPO = indiceColuna(headers, "PO", "PO No.", "PO No", "PO No.", "R", "PO No");
  const idxLine = indiceColuna(headers, "Line", "Line No.", "Line No", "Line No.", "T", "Line No");
  const idxUnitPrice = indiceColuna(headers, "Unit Price");
  const idxACQty = indiceColuna(headers, "AC Qty", "AC Qty.");
  const idxParcelaAC = indiceColuna(headers, "Parcela/AC", "Parcela/AC.", "Parcela/AC", "Parcela", "AC");

  const numCols = Array.isArray(headers) ? headers.length : 0;
  const chaveCol = idxChave ?? COL.CHAVE;
  if (numCols <= chaveCol) {
    throw new Error(
      `Planilha do cliente precisa da coluna Site Code/BI (ou pelo menos ${chaveCol + 1} colunas). Encontradas: ${numCols}`
    );
  }

  // Na planilha do cliente: Location tem "Financial", "BM1" (errado). Cidade e UF ficam na coluna BH = PO Ship To.
  // Formato portal (60+ colunas): BH = índice 59. Usar BH como PO Ship To para cidade/UF; não usar Location para isso.
  const locationCol = numCols >= 60 ? null : (idxLocation ?? COL.LOCATION);
  const poShipToCol = numCols >= 60 ? COL.LOCATION : (idxPoShipTo ?? null);
  const usarFallbackCidadeUf = numCols < 60;

  const consolidado = varreduraConsolidar(rows, headers, {
    groupBy: idxChave ?? COL.CHAVE,
    location: locationCol,
    poShipTo: poShipToCol,
    cidade: usarFallbackCidadeUf ? (idxCidade ?? null) : null,
    uf: usarFallbackCidadeUf ? (idxUF ?? null) : null,
    serviceCode: idxServiceCode ?? COL.LC_CODE,
    value: idxValue ?? COL.VALOR,
    po: idxPO ?? COL.PO,
    line: idxLine ?? COL.LINE,
    unitPrice: idxUnitPrice ?? COL.UNIT_PRICE,
    acQty: idxACQty ?? COL.AC_QTY,
    parcelaAC: idxParcelaAC ?? COL.PARCELA_AC,
  });

  // Preenche codigo_municipio_servico via API IBGE (cidade + UF)
  await preencherCodigosMunicipio(consolidado);
  // Preenche aliquota_iss por código do município (banco -> local -> API NFSe)
  await preencherAliquotasMunicipio(consolidado);
  // Aplica regras de tributação por código de serviço (ex.: 070202, 070302 = ISS município + INSS 3,5%)
  aplicarRegrasTributacaoPorServico(consolidado);

  // Aplicar códigos de município de prestação informados pelo usuário (apenas 7.02 – quando o IBGE não encontrou)
  if (Array.isArray(opcoes.codigosPrestacao) && opcoes.codigosPrestacao.length > 0) {
    const normalizar = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const mapa = new Map();
    for (const item of opcoes.codigosPrestacao) {
      const c = normalizar(item.cidade);
      const u = (item.uf || "").trim().toUpperCase().slice(0, 2);
      if (c && u) mapa.set(c + "|" + u, String(item.codigo_ibge ?? "").replace(/\D/g, "").slice(0, 7));
    }
    for (const linha of consolidado) {
      let cod = String(linha.item_lista_servico ?? "").replace(/\D/g, "");
      if (cod.length > 6) cod = cod.slice(0, 6);
      if (cod.length < 6) cod = cod.padStart(6, "0");
      if (cod !== "070202") continue;
      const codAtual = String(linha.codigo_municipio_servico ?? "").replace(/\D/g, "");
      if (codAtual.length === 7) continue;
      const key = normalizar(linha.Cidade_Servico) + "|" + (linha.UF_Servico || "").trim().toUpperCase().slice(0, 2);
      const codigoIbge = mapa.get(key);
      if (codigoIbge && codigoIbge.length === 7) linha.codigo_municipio_servico = codigoIbge;
    }
  }

  // Para 7.02: municípios que o IBGE não localizou e ainda não têm código informado – solicitar ao usuário
  const municipiosSemCodigoPrestacao = [];
  const seenCodigo = new Set();
  for (const linha of consolidado) {
    let cod = String(linha.item_lista_servico ?? "").replace(/\D/g, "");
    if (cod.length > 6) cod = cod.slice(0, 6);
    if (cod.length < 6) cod = cod.padStart(6, "0");
    if (cod !== "070202") continue;
    const codMun = String(linha.codigo_municipio_servico ?? "").replace(/\D/g, "");
    if (codMun.length === 7) continue;
    const cidade = (linha.Cidade_Servico ?? "").trim();
    const uf = (linha.UF_Servico ?? "").trim().toUpperCase().slice(0, 2);
    if (!cidade || !uf) continue;
    const key = cidade.toLowerCase() + "|" + uf;
    if (seenCodigo.has(key)) continue;
    seenCodigo.add(key);
    municipiosSemCodigoPrestacao.push({ cidade, uf });
  }
  if (municipiosSemCodigoPrestacao.length > 0) {
    return { buffer: null, municipiosSemCodigoPrestacao, municipiosSemAliquota: [], sitesSemEndereco: [] };
  }

  // Preenche endereços de obra (CEP_Obra, Logradouro_Obra, etc.) por site + UF (banco site_endereco_obra)
  const sitesSemEndereco = await preencherEnderecosObra(consolidado);

  const retornarSemAliquota = opcoes.retornarMunicipiosSemAliquota === true && !opcoes.sempreGerarBuffer;

  // Sempre pedir cadastro de endereço antes de gerar a planilha quando houver sites sem endereço
  if (sitesSemEndereco && sitesSemEndereco.length > 0) {
    if (retornarSemAliquota) {
      const seen = new Set();
      const municipiosSemAliquota = [];
      for (const linha of consolidado) {
        const cod = String(linha.codigo_municipio_servico ?? "").replace(/\D/g, "");
        if (cod.length !== 7) continue;
        if (linha.aliquota_iss != null && String(linha.aliquota_iss).trim() !== "") continue;
        if (seen.has(cod)) continue;
        seen.add(cod);
        municipiosSemAliquota.push({
          codigo: cod,
          cidade: (linha.Cidade_Servico ?? "").trim(),
          uf: (linha.UF_Servico ?? "").trim().toUpperCase().slice(0, 2),
        });
      }
      return { buffer: null, municipiosSemAliquota, sitesSemEndereco };
    }
    return { buffer: null, municipiosSemAliquota: [], sitesSemEndereco };
  }

  if (retornarSemAliquota) {
    const seen = new Set();
    const municipiosSemAliquota = [];
    for (const linha of consolidado) {
      const cod = String(linha.codigo_municipio_servico ?? "").replace(/\D/g, "");
      if (cod.length !== 7) continue;
      if (linha.aliquota_iss != null && String(linha.aliquota_iss).trim() !== "") continue;
      if (seen.has(cod)) continue;
      seen.add(cod);
      municipiosSemAliquota.push({
        codigo: cod,
        cidade: (linha.Cidade_Servico ?? "").trim(),
        uf: (linha.UF_Servico ?? "").trim().toUpperCase().slice(0, 2),
      });
    }
    if (municipiosSemAliquota.length > 0) {
      return { buffer: null, municipiosSemCodigoPrestacao: [], municipiosSemAliquota, sitesSemEndereco: sitesSemEndereco || [] };
    }
  }

  const linhasAutomacao = consolidado.map(linhaConsolidadaParaAutomacao);

  const preencherOriginal = opcoes.preencherOriginal !== false;
  if (preencherOriginal) {
    preencherPlanilhaOriginal(workbook, sheetName, headers, consolidado, rows);
  }

  const templatePath = opcoes.templatePath ? path.resolve(opcoes.templatePath) : null;
  const template = lerTemplateAutomacao(templatePath);
  const header = template ? template.header : HEADER_AUTOMACAO_702;

  const aoa = [header, ...linhasAutomacao.map((linha) => linhaParaArray(linha, header))];
  const novaAba = XLSX.utils.aoa_to_sheet(aoa);
  if (template && template.cols) novaAba["!cols"] = template.cols;

  // Coluna data_emissao: fórmula =HOJE() em cada linha de dados (sempre data do dia)
  const idxDataEmissao = header.indexOf("data_emissao");
  if (idxDataEmissao >= 0 && linhasAutomacao.length > 0) {
    const colLetra = colunaParaLetra(idxDataEmissao);
    for (let r = 0; r < linhasAutomacao.length; r++) {
      const excelRow = r + 2; // linha 1 = cabeçalho, dados a partir da 2
      novaAba[colLetra + excelRow] = { f: "=TODAY()", z: "dd/mm/yyyy" };
    }
  }

  let wbOut;
  if (template && template.workbook) {
    wbOut = template.workbook;
    wbOut.Sheets[NOME_ABA_SAIDA] = novaAba;
  } else {
    wbOut = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbOut, novaAba, NOME_ABA_SAIDA);
  }

  const buffer = XLSX.write(wbOut, { type: "buffer", bookType: "xlsx" });
  const bufferOriginal = preencherOriginal ? XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) : null;

  if (retornarSemAliquota) {
    return { buffer, bufferOriginal, municipiosSemCodigoPrestacao: [], municipiosSemAliquota: [], sitesSemEndereco: [] };
  }
  return bufferOriginal ? { buffer, bufferOriginal } : buffer;
}

/**
 * Verifica se o buffer/caminho parece ser planilha do cliente (formato portal).
 * Checa se a primeira aba tem pelo menos 61 colunas (índice BI).
 */
function ehPlanilhaCliente(entrada) {
  try {
    const workbook =
      Buffer.isBuffer(entrada)
        ? XLSX.read(entrada, { type: "buffer" })
        : XLSX.readFile(entrada);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    return raw.length > 0 && ehFormatoVarredura(raw[0]);
  } catch {
    return false;
  }
}

/**
 * Atualiza a planilha original do cliente com dados das NFs emitidas.
 * Preenche: Invoice No*, Invoice Date*, Invoice Amount (Incl, Tax)*.
 *
 * @param {Buffer|string} entrada - Buffer ou caminho da planilha original do cliente
 * @param {Map|object} mapaRefParaDados - ref_api (sanitizada) -> { numero_nf, valor_servicos, data_emissao }
 * @returns {Buffer} planilha atualizada
 */
function atualizarPlanilhaOriginalComNfs(entrada, mapaRefParaDados) {
  const sanitizeRef = (r) => String(r ?? "").trim().replace(/[^a-zA-Z0-9]/g, "");
  const mapObj = mapaRefParaDados instanceof Map ? mapaRefParaDados : new Map(Object.entries(mapaRefParaDados || {}));

  const workbook =
    Buffer.isBuffer(entrada)
      ? XLSX.read(entrada, { type: "buffer", cellDates: true })
      : XLSX.readFile(entrada, { cellDates: true });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!raw.length) throw new Error("Planilha está vazia.");

  const semLinhas1e3 = raw.filter((_, i) => i !== 0 && i !== 2);
  if (semLinhas1e3.length < 2) throw new Error("Planilha sem dados suficientes.");

  const headers = semLinhas1e3[0];
  const rows = semLinhas1e3.slice(1);

  const numCols = Array.isArray(headers) ? headers.length : 0;
  const usarColunasFixas = numCols > (COL_PORTAL.INVOICE_AMOUNT ?? 67);
  const colBH = usarColunasFixas ? COL_PORTAL.BH : (indiceColuna(headers, "PO Ship To", "BH", "PO Ship TO") ?? COL.LOCATION);
  const idxInvoiceNo = indiceColuna(headers, "Invoice No*", "Invoice No", "Número NF", "numero_nf");
  const idxInvoiceDate = indiceColuna(headers, "Invoice Date*", "Invoice Date", "Data NF", "data_emissao");
  const idxInvoiceAmount = usarColunasFixas ? COL_PORTAL.INVOICE_AMOUNT : indiceColuna(headers, "Invoice Amount (Incl, Tax)*", "Invoice Amount");
  const idxIssBase = usarColunasFixas ? COL_PORTAL.ISS_BASE : indiceColuna(headers, "ISS_Base", "ISS Base");
  const idxIssCity = usarColunasFixas ? COL_PORTAL.ISS_CITY : indiceColuna(headers, "ISS_City", "ISS City", "Cidade_Servico");
  const idxIssState = usarColunasFixas ? COL_PORTAL.ISS_STATE : indiceColuna(headers, "ISS_State", "ISS State", "UF_Servico");
  const colLC = usarColunasFixas ? COL_PORTAL.LC_CODE : (indiceColuna(headers, "LC Code", "AL", "Service Code") ?? COL.LC_CODE);

  if (idxInvoiceNo == null) throw new Error('Coluna "Invoice No*" não encontrada na planilha.');

  const consolidado = varreduraConsolidar(rows, headers, {
    groupBy: indiceColuna(headers, "Site Code", "BI", "Chave", "Manufacturer") ?? COL.CHAVE,
    location: raw[0]?.length >= 60 ? null : (indiceColuna(headers, "Location", "BH") ?? COL.LOCATION),
    poShipTo: raw[0]?.length >= 60 ? COL.LOCATION : (indiceColuna(headers, "PO Ship To", "Ship To") ?? null),
    cidade: null,
    uf: null,
    serviceCode: indiceColuna(headers, "LC Code") ?? COL.LC_CODE,
    value: indiceColuna(headers, "TOTAL") ?? COL.VALOR,
    po: indiceColuna(headers, "PO", "PO No.") ?? COL.PO,
    line: indiceColuna(headers, "Line", "Line No.") ?? COL.LINE,
    unitPrice: indiceColuna(headers, "Unit Price") ?? COL.UNIT_PRICE,
    acQty: indiceColuna(headers, "AC Qty") ?? COL.AC_QTY,
    parcelaAC: indiceColuna(headers, "Parcela/AC") ?? COL.PARCELA_AC,
  });

  function formatarDataEmissao(val) {
    if (val == null) return "";
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  for (const item of consolidado) {
    const refSan = sanitizeRef(item.Ref);
    const dados = mapObj.get(refSan) ?? mapObj.get(item.Ref);
    if (!dados) continue;
    const numeroNf = dados.numero_nf ? String(dados.numero_nf).trim() : "";
    if (!numeroNf) continue;

    const rowIndices = item._rowIndices || [];
    for (const rowIdx of rowIndices) {
      const excelRow = rowIdx + 4;
      const row = rows[rowIdx];
      if (idxInvoiceNo != null) {
        sheet[colunaParaLetra(idxInvoiceNo) + excelRow] = { t: "s", v: numeroNf };
      }
      if (idxInvoiceDate != null && dados.data_emissao) {
        const dataStr = formatarDataEmissao(dados.data_emissao);
        if (dataStr) sheet[colunaParaLetra(idxInvoiceDate) + excelRow] = { t: "s", v: dataStr };
      }
      if (dados.valor_servicos != null) {
        if (idxInvoiceAmount != null) sheet[colunaParaLetra(idxInvoiceAmount) + excelRow] = celulaNumeroOriginal(dados.valor_servicos);
        if (idxIssBase != null) sheet[colunaParaLetra(idxIssBase) + excelRow] = celulaNumeroOriginal(dados.valor_servicos);
      }
      // ISS City e ISS State: para 7.03 sempre Bauru/SP; para 7.02 e demais extrair da coluna BH
      let cidadeISS = "";
      let ufISS = "";
      const lcCode = row != null && colLC != null ? String(row[colLC] ?? "").trim() : "";
      if (lcCode.indexOf("7.03") >= 0) {
        cidadeISS = "Bauru";
        ufISS = "SP";
      } else if (row != null && colBH != null) {
        const extraido = extrairUFMunicipio(row[colBH]);
        cidadeISS = extraido.municipio || "";
        ufISS = extraido.uf || "";
      }
      if (cidadeISS && idxIssCity != null) {
        sheet[colunaParaLetra(idxIssCity) + excelRow] = { t: "s", v: cidadeISS };
      }
      if (ufISS && idxIssState != null) {
        sheet[colunaParaLetra(idxIssState) + excelRow] = { t: "s", v: ufISS };
      }
    }
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

module.exports = {
  transformarPlanilhaClienteParaAutomacao,
  linhaConsolidadaParaAutomacao,
  ehPlanilhaCliente,
  atualizarPlanilhaOriginalComNfs,
  NOME_ABA_SAIDA,
};
