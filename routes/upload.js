const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const axios = require("axios");

const db = require("../db");
const { salvarAliquotaMunicipio } = require("../services/aliquotasMunicipio");
const { transformarPlanilhaClienteParaAutomacao, atualizarPlanilhaOriginalComNfs } = require("../services/planilhaClienteParaAutomacao");
const { varreduraConsolidar, indiceColuna, COL } = require("../services/varreduraConsolidar");
const { isSubitemObra } = require("../services/isSubitemObra");
const parseMoney = require("../utils/parseMoney");
const parseBoolean = require("../utils/parseBoolean");
const parseData = require("../utils/parseData");
const prestador = require("../config/prestador");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const FOCUS_URL = "https://api.focusnfe.com.br/v2/nfsen";
const FOCUS_TOKEN = process.env.FOCUS_TOKEN;

/* ================================
   HELPERS
================================ */
function onlyDigits(v) {
  return String(v ?? "").replace(/\D/g, "");
}

function sanitizeRef(ref) {
  return String(ref ?? "").trim().replace(/[^a-zA-Z0-9]/g, "");
}

function getLinha(linha, ...keys) {
  for (const k of keys) {
    const val = linha?.[k];
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return null;
}

function ibge7(v) {
  const s = onlyDigits(v);
  if (s.length === 7) return s;
  if (s.length === 6) return s + "0";
  throw new Error(`IBGE inválido: "${v}"`);
}

/**
 * Sincroniza com a Focus apenas as refs presentes na planilha original do cliente
 * antes de gerar a planilha final com Invoice No*.
 * Isso evita pular números (ex.: 20064 -> 20158) quando parte das NFs ainda
 * não tinha numero_nf gravado no banco no momento da emissão.
 *
 * - Lê a planilha enviada (formato portal)
 * - Reaproveita a lógica de varreduraConsolidar para obter todas as Refs
 * - Consulta o banco pelas ref_api correspondentes
 * - Para as que ainda não têm numero_nf, consulta a Focus e atualiza o banco
 */
async function sincronizarRefsDaPlanilhaComFocus(buffer) {
  if (!FOCUS_TOKEN) return;
  try {
    const sanitizeRef = (r) => String(r ?? "").trim().replace(/[^a-zA-Z0-9]/g, "");

    // Lê planilha original do cliente
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!raw.length) return;

    // Mesmo pré-processamento usado em atualizarPlanilhaOriginalComNfs
    const semLinhas1e3 = raw.filter((_, i) => i !== 0 && i !== 2);
    if (semLinhas1e3.length < 2) return;

    const headers = semLinhas1e3[0];
    const rows = semLinhas1e3.slice(1);
    if (!rows.length) return;

    // Mesmo mapeamento de colunas usado em atualizarPlanilhaOriginalComNfs
    const numCols = Array.isArray(headers) ? headers.length : 0;
    const usarColunasFixas = numCols > (COL.PORTAL_INVOICE_AMOUNT ?? 67);

    // Em atualizarPlanilhaOriginalComNfs usamos:
    //   groupBy: indiceColuna(... "Site Code"/"BI"/"Chave"/"Manufacturer") ?? COL.CHAVE
    //   location / poShipTo / serviceCode / value / po / line / unitPrice / acQty / parcelaAC
    const idxChave = indiceColuna(headers, "Site Code", "BI", "Chave", "SiteCode", "Manufacturer");
    const groupBy = idxChave ?? COL.CHAVE;

    const consolidado = varreduraConsolidar(rows, headers, {
      groupBy,
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

    if (!Array.isArray(consolidado) || consolidado.length === 0) return;

    const refsSan = Array.from(
      new Set(
        consolidado
          .map((item) => sanitizeRef(item.Ref))
          .filter((r) => r && r.length > 0)
      )
    );
    if (refsSan.length === 0) return;

    // Consulta banco para saber quais refs ainda estão sem numero_nf
    const placeholders = refsSan.map((_, i) => `$${i + 1}`).join(", ");
    const r = await db.query(
      `SELECT ref_api, numero_nf FROM notas_fiscais WHERE ref_api IN (${placeholders})`,
      refsSan
    );

    const refsSemNumero = (r.rows || [])
      .filter((row) => !row.numero_nf || String(row.numero_nf).trim() === "")
      .map((row) => row.ref_api)
      .filter(Boolean);

    if (refsSemNumero.length === 0) return;

    console.log("[atualizar-planilha-com-nfs] Sincronizando", refsSemNumero.length, "refs com Focus antes de gerar planilha do cliente...");

    for (const ref of refsSemNumero) {
      const refSan = sanitizeRef(ref);
      if (!refSan) continue;
      try {
        const url = `${FOCUS_URL}/${encodeURIComponent(refSan)}`;
        const resp = await axios.get(url, {
          auth: { username: FOCUS_TOKEN, password: "" },
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
          validateStatus: () => true,
        });

        const data = resp.data || {};
        if (resp.status !== 200) {
          console.warn("[atualizar-planilha-com-nfs] Focus não retornou 200 para ref:", refSan, "status:", resp.status);
          continue;
        }

        const numeroNf = extrairNumeroFocus(data);
        const codigoVerif = extrairCodigoVerificacaoFocus(data);
        const status = data.status != null ? String(data.status) : null;

        if (!numeroNf && !status) continue;

        await db.query(
          `
          UPDATE notas_fiscais
          SET numero_nf = COALESCE(NULLIF(TRIM($1::text), ''), numero_nf),
              codigo_verificacao = COALESCE(NULLIF(TRIM($2::text), ''), codigo_verificacao),
              status_nf = COALESCE($3, status_nf),
              payload_retorno = $4,
              atualizado_em = NOW()
          WHERE ref_api = $5
          `,
          [numeroNf ?? "", codigoVerif ?? "", status ?? "", JSON.stringify(data), refSan]
        );
        if (numeroNf) {
          console.log("[atualizar-planilha-com-nfs] Atualizada ref:", refSan, "-> numero_nf:", numeroNf);
        }
      } catch (err) {
        console.warn("[atualizar-planilha-com-nfs] Erro ao sincronizar ref:", refSan, err.message);
      }
    }
  } catch (err) {
    console.warn("[atualizar-planilha-com-nfs] Erro geral ao sincronizar refs com Focus:", err.message);
  }
}

/**
 * Payload NFSe Nacional (Bauru)
 * - NÃO envia xLocPrestacao
 * - codigo_municipio_prestacao deve ser Bauru (3506003) conforme suporte Focus
 * - Inclui NBS e, se CTN exigir, inclui grupo OBRA (E0370)
 */
function montarPayloadNfsen(linha) {
  const warnings = [];
  // Arredondamento para 2 casas: 3ª casa >= 5 sobe (ex.: 37,215 → 37,22). Evita erro de float.
  const round2 = (n) => {
    const x = Number(n);
    if (Number.isNaN(x)) return 0;
    const tres = Math.round(x * 1000) / 1000;
    return Number(tres.toFixed(2));
  };

  // Ref do envio (para query string)
  const refPlanilha = getLinha(linha, "Ref", "ref");
  const ref = sanitizeRef(refPlanilha);
  if (!ref) throw new Error('Campo "Ref" vazio/ inválido (após sanitização).');

  // Datas (calendário Brasil; parseData já devolve YYYY-MM-DD)
  let dataEmissao = parseData(getLinha(linha, "data_emissao", "Data Emissão", "Data_Emissao"));
  const hojeBr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const ymd = String(dataEmissao).slice(0, 10);
  if (ymd > hojeBr) {
    dataEmissao = hojeBr;
  }
  const dataCompetencia = String(dataEmissao).slice(0, 10);

  // Prestador (config)
  const cnpjPrestador = onlyDigits(prestador?.cnpj_prestador);
  const imPrestador = String(prestador?.inscricao_municipal_prestador ?? "");
  const cMunBauru = onlyDigits(prestador?.codigo_municipio_prestador); // 3506003

  if (!cnpjPrestador || cnpjPrestador.length !== 14) warnings.push("Config prestador: cnpj_prestador inválido.");
  if (!imPrestador) warnings.push("Config prestador: inscricao_municipal_prestador vazio.");
  if (!/^\d{7}$/.test(cMunBauru)) warnings.push("Config prestador: codigo_municipio_prestador inválido (7 dígitos).");

  // Tomador
  const docTomador = onlyDigits(getLinha(linha, "Documento_Tomador"));
  const isCnpjTomador = docTomador.length === 14;
  const isCpfTomador = docTomador.length === 11;
  if (!isCnpjTomador && !isCpfTomador) warnings.push("Documento_Tomador não tem 11 ou 14 dígitos.");

  const cMunTomador = onlyDigits(getLinha(linha, "Codigo_Municipio_Tomador"));
  if (!/^\d{7}$/.test(cMunTomador)) warnings.push("Codigo_Municipio_Tomador inválido (7 dígitos).");

  // Serviço / Nacional
  // CTN vem da coluna item_lista_servico (ex.: 7.03, 070203). Normalizar para 6 dígitos.
  let cTribNac = String(getLinha(linha, "item_lista_servico") ?? "").replace(/\D/g, "");
  if (cTribNac.length > 6) cTribNac = cTribNac.slice(0, 6);
  cTribNac = cTribNac.padStart(6, "0");
  // Bauru aceita 070301 para "elaboração de projetos" (7.03). Planilha pode vir 7.03 -> 000703, ou 070203.
  const isServico703 = cTribNac === "070203" || cTribNac === "000703";
  const cTribNacEnvio = isServico703 ? "070301" : cTribNac;

  // Retenção ISS (tpRetISSQN). Para 070301 em Bauru a regra municipal exige 1 = Não retido.
  let tipoRetencaoIss = Number(getLinha(linha, "iss_retido")); // 1/2/3
  if (![1, 2, 3].includes(tipoRetencaoIss)) warnings.push("iss_retido deve ser 1/2/3 (tpRetISSQN).");
  if (cTribNacEnvio === "070301") tipoRetencaoIss = 1; // Bauru: elaboração de projetos (070301) = ISS não retido (tpRetISSQN=1)

  // Valores
  const valorServico = parseMoney(getLinha(linha, "valor_servico"));
  if (valorServico === null || Number.isNaN(valorServico)) warnings.push("valor_servico inválido.");
  const basePisCofins = valorServico || 0;

  const tributacaoIss = Number(getLinha(linha, "tributacao_iss"));
  if (![1, 2, 3, 4].includes(tributacaoIss)) warnings.push("tributacao_iss deve ser 1..4.");

  let valorCp = getLinha(linha, "valor_inss");
  const situacaoTributariaPisCofins = "01"; // Operação Tributável com Alíquota Básica
  // tpRetPisCofins (NT 007/2026 — códigos 1 e 2 antigos foram substituídos por 0 e 3,
  // que já contemplam CSLL explicitamente): 0 = PIS/COFINS/CSLL não retidos, 3 = todos retidos.
  // Regra: para 7.02 e demais serviços, nada é retido (0). Somente para 7.03 aplicamos retenção (3).
  let tipoRetencaoPisCofins = 0;

  // Alíquota (%)
  const pAliq = getLinha(linha, "aliquota_iss");
  // Alguns retornos mostraram pAliq=0.05 (5% em decimal). A Focus/Emissor pode aceitar tanto 5 quanto 0.05.
  // Vamos normalizar para 0.05 se vier 5.
  // const pAliqNorm = pAliq > 1 ? pAliq / 100 : pAliq;

  // NBS (você informou). Para 7.03, sempre 1.1403.10.00 -> 114031000
  let codigoNbsDefault = "101025210";
  if (isServico703) {
    codigoNbsDefault = "114031000";
  }
  const codigoNbs = String(getLinha(linha, "codigo_nbs") ?? codigoNbsDefault)
    .replace(/\D/g, "")
    .padStart(9, "0");
  if (codigoNbs.length !== 9) warnings.push("codigo_nbs inválido (precisa 9 dígitos).");

  // Regras específicas por CTN
  // Município de prestação: onde o serviço é prestado. Para 7.02 vem da planilha (codigo_municipio_servico, preenchido por IBGE ou pelo usuário). Para 7.03 = Bauru.
  const codigoMunicipioServicoRaw = getLinha(linha, "codigo_municipio_servico", "Codigo_Municipio_Servico", "codigo_municipio_prestacao");
  let codigoMunicipioPrestacao = onlyDigits(codigoMunicipioServicoRaw);
  if (codigoMunicipioPrestacao.length !== 7) codigoMunicipioPrestacao = null;

  let valorTotalTributosFederais = getLinha(linha, "valor_inss");
  let aliquotaPis = 0;
  let aliquotaCofins = 0;
  let valorPis = 0;
  let valorCofins = 0;
  let valorRetidoIrrf = 0;
  let valorRetidoCsll = 0;
  let valorCsllPropria = 0;
  let valorCbs = 0;
  let valorIbsTotal = 0;
  let valorIbsUf = 0;
  let valorIbsMun = 0;
  let ibsCbsSituacaoTributaria = null;
  let ibsCbsClassificacaoTributaria = null;
  let valorCbs703 = 0;   // só para exibição no texto (não altera totais)
  let valorIbs703 = 0;

  // Alíquotas para envio na DPS: Emissor Nacional espera valor em % (0.65 e 3), não dividido por 100.
  let aliquotaPisEnvio = aliquotaPis;
  let aliquotaCofinsEnvio = aliquotaCofins;

if (isServico703) {
  // 1) Município de prestação = Bauru (sempre)
  codigoMunicipioPrestacao = cMunBauru;

  valorCbs703 = round2(basePisCofins * 0.009);
  valorIbs703 = round2(basePisCofins * 0.001);

  // Para 7.03, PIS/COFINS/CSLL são retidos na fonte
  tipoRetencaoPisCofins = 3;

  // 2) Não há INSS -> valor_cp = 0
  valorCp = 0;

  // 3) PIS/COFINS
  const aliquotaPisPercent = 0.65;
  const aliquotaCofinsPercent = 3;

  aliquotaPisEnvio = aliquotaPisPercent;
  aliquotaCofinsEnvio = aliquotaCofinsPercent;

  valorPis = round2(
    basePisCofins * (aliquotaPisPercent / 100)
  );

  valorCofins = round2(
    basePisCofins * (aliquotaCofinsPercent / 100)
  );

  // 4) IRRF 1,5% e CSLL 1%
  const aliqIr = 0.015;
  const aliqCsll = 0.01;

  valorCsllPropria = round2(
    basePisCofins * aliqCsll
  );

  valorRetidoIrrf = round2(
    basePisCofins * aliqIr
  );

  // valor_csll (vRetCSLL no XML / "Contribuições Sociais - Retidas") representa
  // PIS + COFINS + CSLL somados: não existe campo próprio de retenção de PIS/
  // COFINS nesse XML, só "débito de apuração própria" (valor_pis/valor_cofins,
  // enviados à parte). A retenção de fato dos três entra toda aqui.
  valorRetidoCsll = round2(valorPis + valorCofins + valorCsllPropria);

  // Total dos tributos federais:
  // IRRF + PIS + COFINS + CSLL
  const totalFed =
    basePisCofins *
    (
      aliqIr +
      aliqCsll +
      (aliquotaPisPercent / 100) +
      (aliquotaCofinsPercent / 100)
    );

  valorTotalTributosFederais = round2(totalFed);
  } else if (cTribNac === "070202") {
    // 7.02: codigo_municipio_prestacao é obrigatório (preenchido na transformação via IBGE ou pelo usuário)
    if (!codigoMunicipioPrestacao || codigoMunicipioPrestacao.length !== 7) {
      const cidade = getLinha(linha, "Cidade_Servico", "Cidade Serviço");
      const uf = getLinha(linha, "UF_Servico", "UF Serviço");
      throw new Error(
        `Serviço 7.02 sem código do município de prestação (IBGE 7 dígitos). Cidade/UF: ${cidade || "?"} / ${uf || "?"}. Use a etapa Transformar e informe o código para este município.`
      );
    }

    // Reforma tributária (parâmetros confirmados pelo contador para 070202)
    // Base = 100% do valor do serviço; CBS 0,9%; IBS 0,1% (50% UF / 50% Município).
    const baseIbsCbs = round2(valorServico);
    valorCbs = round2(baseIbsCbs * 0.009);
    valorIbsTotal = round2(baseIbsCbs * 0.001);
    valorIbsUf = round2(baseIbsCbs * 0.0005);
    // Ajuste de centavos para garantir coerência: IBS_UF + IBS_MUN = IBS_TOTAL
    valorIbsMun = round2(valorIbsTotal - valorIbsUf);

    // Campos oficiais Focus NFSe Nacional (reforma tributária)
    ibsCbsSituacaoTributaria = "200";
    ibsCbsClassificacaoTributaria = "200046";
  }

  const payload = {
    // DPS base
    data_emissao: dataEmissao,
    data_competencia: dataCompetencia,
    emitente_dps: 1,

    // Município emissor (Bauru)
    codigo_municipio_emissora: cMunBauru,

    // Prestador
    cnpj_prestador: cnpjPrestador,
    inscricao_municipal_prestador: imPrestador,

    // Regime
    codigo_opcao_simples_nacional: parseBoolean(getLinha(linha, "optante_simples_nacional")) ? 3 : 1,
    regime_especial_tributacao: 0,

    valor_total_tributos_federais: round2((Number(valorTotalTributosFederais) || 0) + (Number(valorCbs) || 0)),
    valor_total_tributos_estaduais: valorIbsUf > 0 ? valorIbsUf : undefined,
    valor_total_tributos_municipais: round2((parseMoney(getLinha(linha, "valor_iss_retido")) || 0) + (Number(valorIbsMun) || 0)),

    informacoes_complementares: [
      codigoNbs ? `NBS: ${codigoNbs}` : null,

      getLinha(linha, "CEP_Obra")
        ? `CEP Obra: ${getLinha(linha, "CEP_Obra")}`
        : null,

      getLinha(linha, "Bairro_Obra")
        ? `Bairro Obra: ${getLinha(linha, "Bairro_Obra")}`
        : null,

      getLinha(linha, "Cidade_Servico")
        ? `Cidade Obra: ${getLinha(linha, "Cidade_Servico")}`
        : null,

      valorCbs > 0 || valorIbsTotal > 0
        ? "CBS 0,9%| IBS 0,1%"
        : null,

      isServico703
        ? `Tributos federais retidos: IR 1,5% + PIS 0,65% + COFINS 3,0% + CSLL 1,0% | CBS 0,9% | IBS 0,1%`
        : null,

    ]
      .filter((v) => v && String(v).trim() !== "")
      .join(" | "),


    // Tomador
    ...(isCnpjTomador ? { cnpj_tomador: docTomador } : {}),
    ...(isCpfTomador ? { cpf_tomador: docTomador } : {}),
    razao_social_tomador: getLinha(linha, "Razão Social"),
    email_tomador: getLinha(linha, "E-mail"),
    codigo_municipio_tomador: cMunTomador,
    cep_tomador: onlyDigits(getLinha(linha, "CEP")),
    logradouro_tomador: getLinha(linha, "Logradouro"),
    numero_tomador: String(getLinha(linha, "Número") ?? ""),
    complemento_tomador: getLinha(linha, "Complemento"),
    bairro_tomador: getLinha(linha, "Bairro"),
    uf_tomador: getLinha(linha, "UF_Tomador"),
    telefone_tomador: onlyDigits(getLinha(linha, "telefone_tomador")),

    // Município de prestação: para 7.03 sempre Bauru (cMunBauru)
    codigo_municipio_prestacao: codigoMunicipioPrestacao,

    // Serviço (070203 da planilha -> 070301 para API NFSe Nacional/Bauru)
    codigo_tributacao_nacional_iss: cTribNacEnvio,
    codigo_nbs: codigoNbs,
    descricao_servico: getLinha(linha, "descricao_servico"),
    valor_servico: valorServico,
    tributacao_iss: tributacaoIss,
    tipo_retencao_iss: tipoRetencaoIss,
    percentual_aliquota_relativa_municipio: pAliq,
    valor_cp: valorCp,
    situacao_tributaria_pis_cofins: situacaoTributariaPisCofins,
    tipo_retencao_pis_cofins: tipoRetencaoPisCofins,
    base_calculo_pis_cofins: parseMoney(getLinha(linha, "valor_servico")),
    // Quando PIS/COFINS são 100% retidos na fonte (tipoRetencaoPisCofins=3), o
    // "Débito de Apuração Própria" fica zerado (confirmado no DANFE de uma nota
    // emitida manualmente) — o valor retido de verdade vai todo somado em
    // valor_csll (Contribuições Sociais Retidas). Pra não cair na validação
    // E0694 (valor_pis precisa bater com base_calculo_pis_cofins x aliquota_pis),
    // zeramos a alíquota junto com o valor, não só o valor sozinho.
    aliquota_pis: tipoRetencaoPisCofins === 3 ? 0 : aliquotaPisEnvio,
    aliquota_cofins: tipoRetencaoPisCofins === 3 ? 0 : aliquotaCofinsEnvio,
    valor_pis: tipoRetencaoPisCofins === 3 ? 0 : valorPis,
    valor_cofins: tipoRetencaoPisCofins === 3 ? 0 : valorCofins,
    // Focus: valor_irrf -> vRetIRRF, valor_csll -> vRetCSLL (Documentação Focus NFSe Nacional)
    valor_irrf: valorRetidoIrrf,
    valor_csll: valorRetidoCsll,
    ...(ibsCbsSituacaoTributaria ? { ibs_cbs_situacao_tributaria: ibsCbsSituacaoTributaria } : {}),
    ...(ibsCbsClassificacaoTributaria ? { ibs_cbs_classificacao_tributaria: ibsCbsClassificacaoTributaria } : {}),
  };
  // valor_liquido NÃO é um campo oficial da NFSe Nacional (não existe na
  // especificação da Focus) e NÃO controla o vLiq do XML final — esse é sempre
  // recalculado pela Focus/SEFAZ a partir de vServ, vRetIRRF, vRetCSLL e ISS
  // retido, seguindo o padrão nacional. Mandamos esse campo só como registro
  // interno nosso de quanto a empresa efetivamente recebe em caixa,
  // descontando PIS, COFINS, IRRF e CSLL sempre, e ISS só quando de fato
  // retido (no 7.03 o ISS é "não retido": o prestador recebe o valor cheio e
  // recolhe o ISS por fora depois, então não entra aqui).
  // Usa valorCsllPropria (só CSLL) aqui, não valorRetidoCsll (que já inclui
  // PIS+COFINS) — senão PIS e COFINS seriam descontados em dobro.
  const valorIssRetido = parseMoney(getLinha(linha, "valor_iss_retido")) || 0;
  const issEntraNoLiquido = isServico703 ? tipoRetencaoIss !== 1 : true;
  const totalRetencoes = valorPis + valorCofins + valorRetidoIrrf + valorCsllPropria + (issEntraNoLiquido ? valorIssRetido : 0);
  payload.valor_liquido = round2(Math.max(0, valorServico - totalRetencoes));

  // Local de incidência = município de prestação (obrigatório)
  payload.codigo_local_incidencia = codigoMunicipioPrestacao;
  payload.codigo_municipio_incidencia = codigoMunicipioPrestacao;

  // ===========================
  // GRUPO OBRA (E0370)
  // ===========================
  if (isSubitemObra(cTribNac)) {
    // Você precisa ter essas colunas na planilha, ou ajustar para valores fixos.
    // Colunas sugeridas:
    // CEP_Obra, Logradouro_Obra, Numero_Obra, Complemento_Obra, Bairro_Obra, Codigo_Municipio_Obra, UF_Obra
    const cepObra = onlyDigits(getLinha(linha, "CEP_Obra", "cep_obra"));
    const logradouroObra = getLinha(linha, "Logradouro_Obra", "logradouro_obra");
    const numeroObra = String(getLinha(linha, "Numero_Obra", "Número_Obra", "numero_obra") ?? "");
    const complementoObra = getLinha(linha, "Complemento_Obra", "complemento_obra");
    const bairroObra = getLinha(linha, "Bairro_Obra", "bairro_obra");

    // Município/UF da obra sempre igual ao município/UF de prestação do serviço (a cidade da PO).
    // Nunca usamos a cidade cadastrada em site_endereco_obra aqui: o cadastro do site pode ter o
    // endereço real (ex.: Ilhéus), diferente da cidade que a PO do cliente espera (ex.: Salvador),
    // e a Focus/SEFAZ rejeita a nota quando Mun. Prestação e Mun. Obra divergem.
    const cMunObra = ibge7(codigoMunicipioPrestacao);
    const ufObra = getLinha(linha, "UF_Servico", "UF Serviço");

    

    // Validação mínima (para não mandar vazio e continuar levando E0370)
    const faltando = [];
    if (!cepObra || cepObra.length !== 8) faltando.push("CEP_Obra (8 dígitos)");
    if (!logradouroObra) faltando.push("Logradouro_Obra");
    if (!numeroObra) faltando.push("Numero_Obra");
    if (!bairroObra) faltando.push("Bairro_Obra");
    if (!ufObra) faltando.push("UF_Obra");
    if (!cMunObra) faltando.push("Codigo_Municipio_Obra");

    if (faltando.length) {
      throw new Error(
        `E0370 exige grupo OBRA para CTN ${cTribNac}. Faltando na planilha: ${faltando.join(", ")}`
      );
    }

    // Campos da OBRA conforme documentação (campos *_obra)
    payload.cep_obra = cepObra;
    payload.logradouro_obra = logradouroObra;
    payload.numero_obra = numeroObra;
    if (complementoObra) payload.complemento_obra = complementoObra;
    payload.bairro_obra = bairroObra;
    payload.codigo_municipio_obra = cMunObra;
    // Local de incidência continua igual ao município de prestação (já setado acima)
    payload.uf_obra = ufObra;

    // Opcional: se você tiver CNO/CEI/código da obra
    const codigoObra = getLinha(linha, "codigo_obra", "Codigo_Obra");
    if (codigoObra) payload.codigo_obra = String(codigoObra).trim();
  }

  return { ref, payload, warnings };
}

/* ================================
   EMITIR + SALVAR NO BANCO
================================ */
router.post("/emitir", upload.single("arquivo"), async (req, res) => {
  try {
    if (!FOCUS_TOKEN) return res.json({ sucesso: false, erro: "FOCUS_TOKEN não configurado" });
    if (!req.file) return res.json({ sucesso: false, erro: "Arquivo não enviado" });

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (!Array.isArray(linhas) || linhas.length === 0) {
      return res.json({ sucesso: false, erro: "Planilha sem linhas" });
    }

    const resultados = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      let ref;
      let payload;
      let warnings = [];

      try {
        const r = montarPayloadNfsen(linha);
        ref = r.ref;
        payload = r.payload;
        warnings = r.warnings || [];
      } catch (e) {
        const refLinha = sanitizeRef(getLinha(linha, "Ref", "ref")) || "";
        const msg = e.message || String(e);
        resultados.push({
          ref: refLinha,
          status: "erro",
          erro: { codigo: "erro_payload", mensagem: msg },
          mensagem: msg,
          linha_planilha: i + 1,
        });
        continue;
      }

      console.log(`\n=== LINHA ${i + 1}/${linhas.length} | REF ${ref} ===`);
      if (warnings.length) console.log("WARNINGS:", warnings);

      // 1) Salva/garante registro (não impede envio se falhar)
      console.log("VAI INSERIR NO BANCO...");
      try {
        await db.query(
          `
          INSERT INTO notas_fiscais (
            ref_api,
            status_nf,
            tipo_procedimento,
            cliente_nome,
            cliente_documento,
            cliente_email,
            valor_servicos,
            aliquota,
            data_emissao,
            payload_envio
          ) VALUES (
            $1, 'processando', $2,
            $3, $4, $5,
            $6, $7, $8,
            $9
          )
          ON CONFLICT (ref_api) DO NOTHING
          `,
          [
            ref,
            payload.codigo_tributacao_nacional_iss || null,
            payload.razao_social_tomador || null,
            payload.cnpj_tomador || payload.cpf_tomador || null,
            payload.email_tomador || null,
            payload.valor_servico ?? null,
            payload.percentual_aliquota_relativa_municipio ?? null,
            payload.data_emissao || null,
            JSON.stringify(payload),
          ]
        );
        console.log("BANCO OK");
      } catch (dbErr) {
        console.error("ERRO BANCO (vou continuar e tentar enviar mesmo assim):", dbErr.message);
      }

      // 2) Envia
      const url = `${FOCUS_URL}?ref=${encodeURIComponent(ref)}`;
      console.log("ENVIANDO PARA FOCUS:", url);

      try {
        const resp = await axios.post(url, payload, {
          auth: { username: FOCUS_TOKEN, password: "" },
          headers: { "Content-Type": "application/json" },
          timeout: 60000,
          proxy: false, // evita usar HTTP_PROXY/HTTPS_PROXY (ex.: 127.0.0.1:9) que causa ECONNREFUSED
        });

        console.log("FOCUS RESP STATUS:", resp.status);
        console.log("FOCUS RESP DATA:", resp.data);

        // Extrai número da NF de vários possíveis campos da resposta Focus
        const data = resp.data || {};
        const numeroNf =
          data.numero ??
          data.numero_nf ??
          data.numero_documento ??
          data.numero_nota ??
          (data.nfse && data.nfse.numero) ??
          (data.dados && data.dados.numero) ??
          null;
        const codigoVerif =
          data.codigo_verificacao ??
          data.codigo_verificacao_nfse ??
          (data.nfse && data.nfse.codigo_verificacao) ??
          null;
        if (numeroNf) console.log("Número NF extraído:", numeroNf);

        // 3) Atualiza banco com retorno (só sobrescreve numero_nf/codigo_verificacao se vier valor)
        try {
          await db.query(
            `
            UPDATE notas_fiscais
            SET status_nf = $1,
                numero_nf = COALESCE(NULLIF(TRIM($2::text), ''), numero_nf),
                serie_nf = COALESCE($3, serie_nf),
                codigo_verificacao = COALESCE(NULLIF(TRIM($4::text), ''), codigo_verificacao),
                payload_retorno = $5,
                atualizado_em = NOW()
            WHERE ref_api = $6
            `,
            [
              data.status || "processando",
              numeroNf ?? "",
              data.serie ?? data.serie_nf ?? null,
              codigoVerif ?? "",
              JSON.stringify(data),
              ref,
            ]
          );
        } catch (dbErr2) {
          console.error("ERRO UPDATE BANCO (retorno):", dbErr2.message);
        }

        // Salva alíquota no banco de municípios (para uso futuro na transformação)
        try {
          const codigo = getLinha(linha, "codigo_municipio_servico", "Codigo_Municipio_Obra");
          const aliquota = getLinha(linha, "aliquota_iss");
          if (codigo && onlyDigits(codigo).length === 7 && aliquota != null && String(aliquota).trim() !== "") {
            await salvarAliquotaMunicipio(
              codigo,
              getLinha(linha, "Cidade_Servico"),
              getLinha(linha, "UF_Servico"),
              aliquota
            );
          }
        } catch {
          // ignora falha ao salvar alíquota
        }
        resultados.push({
          ref,
          status: data.status || "ok",
          numero_nf: numeroNf,
          codigo_verificacao: codigoVerif,
          warnings,
        });
      } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;

        console.error("FOCUS ERRO STATUS:", status);
        console.error("FOCUS ERRO DATA:", data || err.message);

        try {
          await db.query(
            `
            UPDATE notas_fiscais
            SET status_nf = 'erro',
                payload_retorno = $1,
                atualizado_em = NOW()
            WHERE ref_api = $2
            `,
            [JSON.stringify(data || { erro: err.message }), ref]
          );
        } catch (dbErr3) {
          console.error("ERRO UPDATE BANCO (erro):", dbErr3.message);
        }

        resultados.push({
          ref,
          status: "erro",
          erro: data || err.message,
          warnings,
        });
      }
    }

    return res.json({ sucesso: true, total_linhas: resultados.length, resultados });
  } catch (err) {
    console.error("🔥 ERRO GERAL:", err);
    return res.json({ sucesso: false, erro: err.message });
  }
});

/* ================================
   CONSULTAR STATUS POR REF
================================ */
router.get("/status/:ref", async (req, res) => {
  try {
    if (!FOCUS_TOKEN) return res.json({ sucesso: false, erro: "FOCUS_TOKEN não configurado" });

    const ref = sanitizeRef(req.params.ref);
    if (!ref) return res.json({ sucesso: false, erro: "ref inválida" });

    const url = `${FOCUS_URL}/${encodeURIComponent(ref)}`;
    const resp = await axios.get(url, {
      auth: { username: FOCUS_TOKEN, password: "" },
      headers: { "Content-Type": "application/json" },
      timeout: 60000,
    });

    return res.json({ sucesso: true, ref, dados: resp.data });
  } catch (err) {
    return res.json({
      sucesso: false,
      erro: err.response?.data || err.message,
      status: err.response?.status,
    });
  }
});

/* ================================
   SINCRONIZAR NOTAS COM FOCUS (consultar API Focus por ref e atualizar numero_nf no banco)
================================ */
function extrairNumeroFocus(data) {
  if (!data || typeof data !== "object") return null;
  return (
    data.numero ??
    data.numero_nf ??
    data.numero_documento ??
    data.numero_nota ??
    (data.nfse && data.nfse.numero) ??
    (data.dados && data.dados.numero) ??
    null
  );
}
function extrairCodigoVerificacaoFocus(data) {
  if (!data || typeof data !== "object") return null;
  return data.codigo_verificacao ?? (data.nfse && data.nfse.codigo_verificacao) ?? null;
}

router.get("/sincronizar-notas-focus", async (req, res) => {
  try {
    if (!FOCUS_TOKEN) {
      return res.json({ ok: false, erro: "FOCUS_TOKEN não configurado. Configure no .env." });
    }

    const r = await db.query(
      `SELECT ref_api FROM notas_fiscais WHERE ref_api IS NOT NULL AND TRIM(ref_api) <> '' ORDER BY criado_em DESC LIMIT 1000`
    );
    const refs = (r.rows || []).map((row) => String(row.ref_api).trim()).filter(Boolean);
    if (refs.length === 0) {
      return res.json({ ok: true, atualizadas: 0, mensagem: "Nenhuma nota com ref para sincronizar." });
    }

    let atualizadas = 0;
    const erros = [];

    for (const ref of refs) {
      const refSan = sanitizeRef(ref);
      if (!refSan) continue;
      try {
        const url = `${FOCUS_URL}/${encodeURIComponent(refSan)}`;
        const resp = await axios.get(url, {
          auth: { username: FOCUS_TOKEN, password: "" },
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
          validateStatus: () => true,
        });

        const data = resp.data || {};
        if (resp.status !== 200) {
          erros.push({ ref: refSan, status: resp.status, mensagem: data.mensagem || data.erro || "Erro na Focus" });
          continue;
        }

        const numeroNf = extrairNumeroFocus(data);
        const codigoVerif = extrairCodigoVerificacaoFocus(data);
        const status = data.status != null ? String(data.status) : null;

        await db.query(
          `
          UPDATE notas_fiscais
          SET numero_nf = COALESCE(NULLIF(TRIM($1::text), ''), numero_nf),
              codigo_verificacao = COALESCE(NULLIF(TRIM($2::text), ''), codigo_verificacao),
              status_nf = COALESCE($3, status_nf),
              payload_retorno = $4,
              atualizado_em = NOW()
          WHERE ref_api = $5
          `,
          [numeroNf ?? "", codigoVerif ?? "", status ?? "", JSON.stringify(data), refSan]
        );
        atualizadas++;
        if (numeroNf) console.log("[Sincronizar Focus] ref:", refSan, "-> numero_nf:", numeroNf);
      } catch (err) {
        erros.push({ ref: refSan, mensagem: err.message || "Erro ao consultar Focus" });
      }
    }

    return res.json({ ok: true, atualizadas, total_refs: refs.length, erros: erros.slice(0, 20) });
  } catch (err) {
    console.error("Erro ao sincronizar notas com Focus:", err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

/* ================================
   VERIFICAR REFS ESPECÍFICAS (para polling após emissão)
   POST { refs: ["ref1", "ref2", ...] } -> consulta Focus e atualiza banco, retorna resultados
================================ */
router.post("/verificar-refs", async (req, res) => {
  try {
    if (!FOCUS_TOKEN) {
      return res.json({ ok: false, erro: "FOCUS_TOKEN não configurado" });
    }
    const refs = Array.isArray(req.body?.refs) ? req.body.refs : [];
    if (refs.length === 0) {
      return res.json({ ok: true, resultados: [] });
    }
    const resultados = [];
    for (const ref of refs) {
      const refSan = sanitizeRef(ref);
      if (!refSan) {
        resultados.push({ ref, status: "erro", numero_nf: null, codigo_verificacao: null });
        continue;
      }
      try {
        const url = `${FOCUS_URL}/${encodeURIComponent(refSan)}`;
        const resp = await axios.get(url, {
          auth: { username: FOCUS_TOKEN, password: "" },
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
          validateStatus: () => true,
        });
        const data = resp.data || {};
        const numeroNf = extrairNumeroFocus(data);
        const codigoVerif = extrairCodigoVerificacaoFocus(data);
        const status = data.status != null ? String(data.status) : null;
        await db.query(
          `
          UPDATE notas_fiscais
          SET numero_nf = COALESCE(NULLIF(TRIM($1::text), ''), numero_nf),
              codigo_verificacao = COALESCE(NULLIF(TRIM($2::text), ''), codigo_verificacao),
              status_nf = COALESCE($3, status_nf),
              payload_retorno = $4,
              atualizado_em = NOW()
          WHERE ref_api = $5
          `,
          [numeroNf ?? "", codigoVerif ?? "", status ?? "", JSON.stringify(data), refSan]
        );
        resultados.push({
          ref: refSan,
          status: status || "ok",
          numero_nf: numeroNf,
          codigo_verificacao: codigoVerif,
        });
      } catch (err) {
        resultados.push({ ref: refSan, status: "erro", numero_nf: null, codigo_verificacao: null });
      }
    }
    return res.json({ ok: true, resultados });
  } catch (err) {
    console.error("Erro ao verificar refs:", err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

/* ================================
   STATUS REFS (lê do banco - webhook atualiza aqui)
   GET ?refs=ref1,ref2 -> retorna numero_nf, status do banco (atualizado pelo webhook)
   Para refs sem numero_nf, também consulta Focus e atualiza banco (fallback)
================================ */
router.get("/status-refs", async (req, res) => {
  try {
    const refsParam = req.query.refs;
    const refs = Array.isArray(refsParam)
      ? refsParam
      : (typeof refsParam === "string" ? refsParam.split(",").map((r) => r.trim()).filter(Boolean) : []);
    if (refs.length === 0) {
      return res.json({ ok: true, resultados: [] });
    }
    const refsSan = refs.map((r) => sanitizeRef(r)).filter(Boolean);
    if (refsSan.length === 0) {
      return res.json({ ok: true, resultados: [] });
    }

    const placeholders = refsSan.map((_, i) => `$${i + 1}`).join(", ");
    const r = await db.query(
      `SELECT ref_api, numero_nf, status_nf, codigo_verificacao FROM notas_fiscais WHERE ref_api IN (${placeholders})`,
      refsSan
    );
    const mapa = {};
    (r.rows || []).forEach((row) => {
      mapa[row.ref_api] = {
        ref: row.ref_api,
        status: row.status_nf || "ok",
        numero_nf: row.numero_nf,
        codigo_verificacao: row.codigo_verificacao,
      };
    });

    const refsSemNumero = refsSan.filter((ref) => {
      const d = mapa[ref];
      return !d || !d.numero_nf || String(d.numero_nf).trim() === "";
    });

    if (refsSemNumero.length > 0 && FOCUS_TOKEN) {
      for (const refSan of refsSemNumero) {
        try {
          const url = `${FOCUS_URL}/${encodeURIComponent(refSan)}`;
          const resp = await axios.get(url, {
            auth: { username: FOCUS_TOKEN, password: "" },
            headers: { "Content-Type": "application/json" },
            timeout: 10000,
            validateStatus: () => true,
          });
          const data = resp.data || {};
          const numeroNf = extrairNumeroFocus(data);
          const codigoVerif = extrairCodigoVerificacaoFocus(data);
          const status = data.status != null ? String(data.status) : null;
          if (numeroNf || status) {
            await db.query(
              `
              UPDATE notas_fiscais
              SET numero_nf = COALESCE(NULLIF(TRIM($1::text), ''), numero_nf),
                  codigo_verificacao = COALESCE(NULLIF(TRIM($2::text), ''), codigo_verificacao),
                  status_nf = COALESCE($3, status_nf),
                  payload_retorno = $4,
                  atualizado_em = NOW()
              WHERE ref_api = $5
              `,
              [numeroNf ?? "", codigoVerif ?? "", status ?? "", JSON.stringify(data), refSan]
            );
            mapa[refSan] = {
              ref: refSan,
              status: status || "ok",
              numero_nf: numeroNf,
              codigo_verificacao: codigoVerif,
            };
          }
        } catch (err) {
          console.warn("[status-refs] Focus ref:", refSan, err.message);
        }
      }
    }

    const resultados = refsSan.map((ref) => mapa[ref] || { ref, status: "-", numero_nf: null, codigo_verificacao: null });
    return res.json({ ok: true, resultados });
  } catch (err) {
    console.error("Erro ao buscar status-refs:", err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

/* ================================
   TRANSFORMAR PLANILHA DO CLIENTE
   Retorna: { precisaCadastro, municipiosSemAliquota } ou { downloadUrl }
================================ */
const DIR_TRANSFORMADO = path.join(__dirname, "..", "uploads", "transformado");

router.post("/transformar-planilha", upload.single("arquivo"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ sucesso: false, erro: "Nenhum arquivo enviado." });
    }
    console.log("[Transformar] Planilha recebida:", req.file.originalname, "– processando (colunas por nome + regras 070202)...");
    const templatePath = req.body?.templatePath || null;
    let codigosPrestacao = req.body?.codigosPrestacao;
    if (typeof codigosPrestacao === "string") {
      try {
        codigosPrestacao = JSON.parse(codigosPrestacao);
      } catch {
        codigosPrestacao = undefined;
      }
    }
    let excluirLinhas = req.body?.excluirLinhas;
    if (typeof excluirLinhas === "string") {
      try {
        excluirLinhas = JSON.parse(excluirLinhas);
      } catch {
        excluirLinhas = undefined;
      }
    }
    const opcoes = {
      templatePath,
      retornarMunicipiosSemAliquota: true,
      codigosPrestacao: Array.isArray(codigosPrestacao) ? codigosPrestacao : undefined,
      excluirLinhas: excluirLinhas && typeof excluirLinhas === "object" ? excluirLinhas : undefined,
    };
    const result = await transformarPlanilhaClienteParaAutomacao(req.file.buffer, opcoes);

    if (result && typeof result === "object") {
      // 7.02: municípios que o IBGE não localizou – solicitar código (município de prestação)
      if (result.municipiosSemCodigoPrestacao && result.municipiosSemCodigoPrestacao.length > 0) {
        return res.json({
          sucesso: true,
          precisaCadastro: true,
          municipiosSemCodigoPrestacao: result.municipiosSemCodigoPrestacao,
          municipiosSemAliquota: [],
          sitesSemEndereco: [],
        });
      }
      if (result.municipiosSemAliquota && result.municipiosSemAliquota.length > 0) {
        return res.json({
          sucesso: true,
          precisaCadastro: true,
          municipiosSemAliquota: result.municipiosSemAliquota,
          sitesSemEndereco: result.sitesSemEndereco || [],
        });
      }
      if (result.sitesSemEndereco && result.sitesSemEndereco.length > 0) {
        return res.json({
          sucesso: true,
          precisaCadastro: true,
          municipiosSemAliquota: [],
          sitesSemEndereco: result.sitesSemEndereco,
        });
      }
    }

    let buffer = Buffer.isBuffer(result) ? result : (result && typeof result === "object" && result.buffer !== undefined ? result.buffer : result);
    if (!buffer) {
      return res.status(500).json({ sucesso: false, erro: "Falha ao gerar planilha." });
    }
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer);
    }

    fs.mkdirSync(DIR_TRANSFORMADO, { recursive: true });
    const id = `planilha_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const nomeArquivo = `${id}.xlsx`;
    const caminho = path.join(DIR_TRANSFORMADO, nomeArquivo);
    fs.writeFileSync(caminho, buffer);

    let downloadUrlOriginal = null;
    const bufferOriginal = result && typeof result === "object" && result.bufferOriginal && Buffer.isBuffer(result.bufferOriginal) ? result.bufferOriginal : null;
    if (bufferOriginal) {
      const nomeArquivoOriginal = `original_preenchida_${id}.xlsx`;
      const caminhoOriginal = path.join(DIR_TRANSFORMADO, nomeArquivoOriginal);
      fs.writeFileSync(caminhoOriginal, bufferOriginal);
      downloadUrlOriginal = `/api/upload/download/transformado/${nomeArquivoOriginal}`;
    }

    res.json({
      sucesso: true,
      precisaCadastro: false,
      downloadUrl: `/api/upload/download/transformado/${nomeArquivo}`,
      downloadUrlOriginal: downloadUrlOriginal,
      versaoTransformacao: "3-original-preenchida-regras-070202",
    });
  } catch (err) {
    console.error("Erro ao transformar planilha:", err);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/* ================================
   ATUALIZAR PLANILHA COM NÚMEROS NF (após emissão)
   Recebe planilha original do cliente e preenche Invoice No* com numero_nf do banco
================================ */
router.post("/atualizar-planilha-com-nfs", upload.single("arquivo"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ sucesso: false, erro: "Nenhum arquivo enviado." });
    }

    // Antes de gerar a planilha, sincroniza as refs desta planilha com a Focus
    // para garantir que o banco tenha o numero_nf mais atualizado possível.
    await sincronizarRefsDaPlanilhaComFocus(req.file.buffer);

    const { rows } = await db.query(
      `SELECT ref_api, numero_nf, valor_servicos, data_emissao
       FROM notas_fiscais
       WHERE numero_nf IS NOT NULL AND TRIM(numero_nf) <> ''`
    );
    const mapaRefParaDados = new Map();
    for (const r of rows || []) {
      if (r.ref_api && r.numero_nf) {
        const dados = {
          numero_nf: String(r.numero_nf).trim(),
          valor_servicos: r.valor_servicos,
          data_emissao: r.data_emissao,
        };
        mapaRefParaDados.set(sanitizeRef(r.ref_api), dados);
        mapaRefParaDados.set(r.ref_api, dados);
      }
    }

    const buffer = atualizarPlanilhaOriginalComNfs(req.file.buffer, mapaRefParaDados);

    fs.mkdirSync(DIR_TRANSFORMADO, { recursive: true });
    const id = `planilha_nfs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const nomeArquivo = `${id}.xlsx`;
    const caminho = path.join(DIR_TRANSFORMADO, nomeArquivo);
    fs.writeFileSync(caminho, buffer);

    res.json({
      sucesso: true,
      downloadUrl: `/api/upload/download/transformado/${nomeArquivo}`,
    });
  } catch (err) {
    console.error("Erro ao atualizar planilha com NFs:", err);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/** GET /api/upload/download/transformado/:nomeArquivo - Download do XLSX gerado */
router.get("/download/transformado/:nomeArquivo", (req, res) => {
  const nome = path.basename(req.params.nomeArquivo);
  if (!nome.endsWith(".xlsx") || nome.includes("..")) {
    return res.status(400).json({ erro: "Arquivo inválido." });
  }
  const caminho = path.join(DIR_TRANSFORMADO, nome);
  if (!fs.existsSync(caminho)) {
    return res.status(404).json({ erro: "Arquivo não encontrado." });
  }
  res.download(caminho, nome, (err) => {
    if (err) console.error("Erro ao enviar download:", err);
  });
});

module.exports = router;

