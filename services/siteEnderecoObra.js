/**
 * Endereço de obra por site e UF (tabela site_endereco_obra).
 * Usado na transformação da planilha para preencher CEP_Obra, Logradouro_Obra, Numero_Obra, Bairro_Obra, UF_Obra, Codigo_Municipio_Obra.
 */

let _db = null;
function getDb() {
  if (_db === null) {
    try {
      _db = require("../db");
    } catch {
      _db = false;
    }
  }
  return _db || null;
}

/**
 * Busca endereço de obra no banco por site_code e uf_servico.
 * @param {string} siteCode
 * @param {string} ufServico - UF (2 letras)
 * @returns {Promise<object|null>}
 */
async function getBySiteUf(siteCode, ufServico) {
  const site = String(siteCode ?? "").trim();
  const uf = String(ufServico ?? "").trim().toUpperCase().slice(0, 2);
  if (!site || !uf) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const r = await db.query(
      `SELECT site_code, uf_servico, cidade_servico, cep_obra, logradouro_obra, numero_obra, bairro_obra, uf_obra, codigo_municipio_obra
       FROM site_endereco_obra WHERE site_code = $1 AND uf_servico = $2`,
      [site, uf]
    );
    if (r.rows && r.rows[0]) return r.rows[0];
  } catch {
    // tabela pode não existir
  }
  return null;
}

/**
 * Salva ou atualiza endereço de obra (site_code + uf_servico).
 * @param {object} dados - { site_code, uf_servico, cidade_servico?, cep_obra?, logradouro_obra?, numero_obra?, bairro_obra?, uf_obra?, codigo_municipio_obra? }
 * @returns {Promise<boolean>}
 */
async function salvar(dados) {
  const site = String(dados.site_code ?? "").trim().slice(0, 120);
  const ufServico = String(dados.uf_servico ?? "").trim().toUpperCase().slice(0, 2);
  if (!site || !ufServico) return false;
  const db = getDb();
  if (!db) return false;
  const codigoObra = dados.codigo_municipio_obra != null ? String(dados.codigo_municipio_obra).replace(/\D/g, "").slice(0, 7) : null;
  // Truncar para não estourar tamanho das colunas no banco
  const numeroObra = dados.numero_obra != null ? String(dados.numero_obra).trim().slice(0, 100) : null;
  const logradouroObra = dados.logradouro_obra != null ? String(dados.logradouro_obra).trim().slice(0, 200) : null;
  const bairroObra = dados.bairro_obra != null ? String(dados.bairro_obra).trim().slice(0, 120) : null;
  const cidadeServico = dados.cidade_servico != null ? String(dados.cidade_servico).trim().slice(0, 120) : null;
  const cepObra = dados.cep_obra != null ? String(dados.cep_obra).replace(/\D/g, "").slice(0, 20) : null;
  try {
    await db.query(
      `INSERT INTO site_endereco_obra (
        site_code, uf_servico, cidade_servico, cep_obra, logradouro_obra, numero_obra, bairro_obra, uf_obra, codigo_municipio_obra, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (site_code, uf_servico) DO UPDATE SET
        cidade_servico = COALESCE(EXCLUDED.cidade_servico, site_endereco_obra.cidade_servico),
        cep_obra = COALESCE(EXCLUDED.cep_obra, site_endereco_obra.cep_obra),
        logradouro_obra = COALESCE(EXCLUDED.logradouro_obra, site_endereco_obra.logradouro_obra),
        numero_obra = COALESCE(EXCLUDED.numero_obra, site_endereco_obra.numero_obra),
        bairro_obra = COALESCE(EXCLUDED.bairro_obra, site_endereco_obra.bairro_obra),
        uf_obra = COALESCE(EXCLUDED.uf_obra, site_endereco_obra.uf_obra),
        codigo_municipio_obra = COALESCE(EXCLUDED.codigo_municipio_obra, site_endereco_obra.codigo_municipio_obra),
        updated_at = NOW()`,
      [
        site,
        ufServico,
        cidadeServico ?? null,
        cepObra ?? null,
        logradouroObra ?? null,
        numeroObra ?? null,
        bairroObra ?? null,
        (dados.uf_obra != null ? String(dados.uf_obra).trim().toUpperCase().slice(0, 2) : null) || ufServico,
        codigoObra || null,
      ]
    );
    return true;
  } catch (err) {
    console.error("[siteEnderecoObra] Erro ao salvar:", err.message);
    throw err;
  }
}

/**
 * Preenche nas linhas consolidadas os campos CEP_Obra, Logradouro_Obra, Numero_Obra, Bairro_Obra, UF_Obra, Codigo_Municipio_Obra
 * a partir da tabela site_endereco_obra (por site + UF_Servico).
 * Modifica o array in-place. Retorna lista de { site_code, uf_servico, cidade_servico } que não têm endereço cadastrado.
 *
 * @param {Array<object>} consolidado - Linhas com site, UF_Servico, Cidade_Servico
 * @returns {Promise<Array<{ site_code, uf_servico, cidade_servico }>>} sitesSemEndereco
 */
async function preencherEnderecosObra(consolidado) {
  const sitesSemEndereco = [];
  const cache = new Map(); // key = `${site}|${uf}` -> row from DB

  for (const linha of consolidado) {
    const site = String(linha.site ?? linha["Site Code"] ?? "").trim();
    const uf = String(linha.UF_Servico ?? "").trim().toUpperCase().slice(0, 2);

    // Para serviços 7.03 (070203), não é necessário endereço de obra: pular totalmente
    let codigo = String(linha.item_lista_servico ?? "").replace(/\D/g, "");
    if (codigo.length > 6) codigo = codigo.slice(0, 6);
    if (codigo.length < 6) codigo = codigo.padStart(6, "0");
    if (codigo === "070203") {
      continue;
    }
    if (!site || !uf) continue;

    const key = `${site}|${uf}`;
    let endereco = cache.get(key);
    if (endereco === undefined) {
      endereco = await getBySiteUf(site, uf);
      cache.set(key, endereco);
    }

    // Considerar "com endereço" só se tiver CEP ou logradouro preenchidos (senão pedir cadastro)
    const cepPreenchido = endereco && (String(endereco.cep_obra ?? "").trim().replace(/\D/g, "").length >= 8);
    const logPreenchido = endereco && (String(endereco.logradouro_obra ?? "").trim() !== "");
    const temEnderecoValido = cepPreenchido || logPreenchido;

    if (temEnderecoValido) {
      linha.CEP_Obra = endereco.cep_obra ?? "";
      linha.Logradouro_Obra = endereco.logradouro_obra ?? "";
      linha.Numero_Obra = endereco.numero_obra ?? "";
      linha.Bairro_Obra = endereco.bairro_obra ?? "";
      linha.UF_Obra = endereco.uf_obra ?? uf;
      linha.Codigo_Municipio_Obra = endereco.codigo_municipio_obra ?? "";
    } else {
      // Sem registro no banco ou registro com endereço vazio: marcar para cadastro (evitar duplicatas)
      if (!sitesSemEndereco.some((s) => s.site_code === site && s.uf_servico === uf)) {
        sitesSemEndereco.push({
          site_code: site,
          uf_servico: uf,
          cidade_servico: (linha.Cidade_Servico ?? "").trim(),
        });
      }
    }
  }

  return sitesSemEndereco;
}

module.exports = {
  getBySiteUf,
  salvar,
  preencherEnderecosObra,
};
