const parseData = require("./parseData");
const parseMoney = require("./parseMoney");
const parseBoolean = require("./parseBoolean");

module.exports = async function mapLinhaParaFocus(linha, prestador) {
  return {
    prestador,

    tomador: {
      razao_social_tomador: linha["Razão Social"],
      nome_fantasia: linha["Nome Fantasia"],
      cnpj: String(linha["Documento_Tomador"]).replace(/\D/g, ""),
      email_tomador: linha["E-mail"],
      endereco: {
        logradouro_tomador: linha["Logradouro"],
        numero_tomador: linha["Número"],
        complemento_tomador: linha["Complemento"],
        bairro_tomador: linha["Bairro"],
        codigo_municipio_tomador: String(linha["Codigo_Municipio_Tomador"]),
        uf: linha["UF_Tomador"],
        cep_tomador: String(linha["CEP"]).replace(/\D/g, ""),
        telefone_tomador: linha["telefone_tomador"]
      }
    },

    servico: {
      codigo_municipio_prestacao: linha["codigo_municipio_servico"], // OK
      valor_servico: parseMoney(linha["valor_servico"]),   //OK
      aliquota: parseMoney(linha["aliquota_iss"]) / 100,
      tipo_retencao_iss: linha["iss_retido"],    // OK
      item_lista_servico: linha["item_lista_servico"], //OK
      descricao_servico: linha["descricao_servico"],    // OK
      codigo_tributario_municipio: linha["codigo_tributario_municipio"],
      tributacao_iss: linha["tributacao_iss"]   //OK
    },

    data_emissao: parseData(linha["data_emissao"]),   // OK
    natureza_operacao: String(linha["natureza_operacao"])
  };
};
