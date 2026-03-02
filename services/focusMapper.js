function limparNumero(valor) {
  if (!valor) return null;
  return String(valor).replace(/\D/g, "");
}

function normalizarBoolean(valor) {
  if (typeof valor === "boolean") return valor;
  if (!valor) return false;
  return String(valor).toLowerCase() === "true";
}

function normalizarValor(valor) {
  if (!valor) return 0;
  return Number(String(valor).replace(",", "."));
}

function normalizarAliquota(valor) {
  if (!valor) return 0;
  return Number(
    String(valor)
      .replace("%", "")
      .replace(",", ".")
  ) / 100;
}

function normalizarData(dataExcel) {
  // Excel number → Date
  if (typeof dataExcel === "number") {
    const jsDate = new Date((dataExcel - 25569) * 86400 * 1000);
    return jsDate.toISOString().slice(0, 10);
  }

  // dd/mm/yyyy
  if (typeof dataExcel === "string" && dataExcel.includes("/")) {
    const [d, m, y] = dataExcel.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

function montarPayloadFocus(linha, prestador) {
  return {
    ref: linha.Ref,

    prestador: {
      cnpj: prestador.cnpj,
      inscricao_municipal: prestador.inscricao_municipal,
      codigo_municipio: prestador.codigo_municipio,
      optante_simples_nacional: prestador.optante_simples_nacional
    },

    tomador: {
      razao_social: linha["Razão Social"],
      email: linha["E-mail"],
      documento: {
        numero: limparNumero(linha.Documento_Tomador),
        tipo: "CNPJ"
      },
      endereco: {
        logradouro: linha.Logradouro,
        numero: String(linha.Número),
        complemento: linha.Complemento,
        bairro: linha.Bairro,
        codigo_municipio: String(linha.Codigo_Municipio_Tomador),
        uf: linha.UF_Tomador,
        cep: limparNumero(linha.CEP)
      }
    },

    servico: {
      item_lista_servico: linha.item_lista_servico,
      codigo_tributario_municipio: linha.codigo_tributario_municipio,
      discriminacao: linha.descricao_servico,
      valor_servicos: normalizarValor(linha.valor_servico),
      aliquota: normalizarAliquota(linha.aliquota_iss),
      iss_retido: normalizarBoolean(linha.iss_retido)
    },

    natureza_operacao: Number(linha.natureza_operacao),
    data_emissao: normalizarData(linha.data_emissao)
  };
}

module.exports = { montarPayloadFocus };
