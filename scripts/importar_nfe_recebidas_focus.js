/**
 * Importa (backfill) as NF-e recebidas já registradas na Focus NFe para o CNPJ configurado,
 * cobrindo o histórico que a Focus tem disponível (a SEFAZ só distribui documentos a partir
 * de quando a consulta foi habilitada para o destinatário — não há histórico anterior a isso).
 *
 * Usa a mesma lógica de upsert do webhook (routes/webhook.js), então pode ser rodado
 * novamente sem duplicar dados (ON CONFLICT por chave_nfe).
 *
 * Uso: fly ssh console -a api-sig-premcell -C "node scripts/importar_nfe_recebidas_focus.js"
 */

require("dotenv").config();
const axios = require("axios");
const db = require("../db");
const prestador = require("../config/prestador");

const FOCUS_TOKEN = process.env.FOCUS_TOKEN;
const CNPJ = prestador.cnpj_prestador;

async function upsertNota(dados) {
  const chaveNfe = String(dados.chave_nfe ?? "").trim();
  if (!chaveNfe) return false;

  const nomeEmitente = dados.nome_emitente ?? null;
  const cnpjEmitente = dados.documento_emitente ?? null;
  const valorTotal = dados.valor_total ?? null;
  const manifestacaoFocus = dados.manifestacao_destinatario ?? null;

  await db.query(
    `
    INSERT INTO nfe_recebidas (
      chave_nfe, focus_id, nome_emitente, cnpj_emitente,
      valor_total, data_emissao, data_geracao, situacao, versao, manifestacao, payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (chave_nfe) DO UPDATE SET
      focus_id = COALESCE(EXCLUDED.focus_id, nfe_recebidas.focus_id),
      nome_emitente = COALESCE(EXCLUDED.nome_emitente, nfe_recebidas.nome_emitente),
      cnpj_emitente = COALESCE(EXCLUDED.cnpj_emitente, nfe_recebidas.cnpj_emitente),
      valor_total = COALESCE(EXCLUDED.valor_total, nfe_recebidas.valor_total),
      data_emissao = COALESCE(EXCLUDED.data_emissao, nfe_recebidas.data_emissao),
      data_geracao = COALESCE(EXCLUDED.data_geracao, nfe_recebidas.data_geracao),
      situacao = COALESCE(EXCLUDED.situacao, nfe_recebidas.situacao),
      versao = COALESCE(EXCLUDED.versao, nfe_recebidas.versao),
      manifestacao = COALESCE(nfe_recebidas.manifestacao, EXCLUDED.manifestacao),
      payload = EXCLUDED.payload,
      atualizado_em = NOW()
    `,
    [
      chaveNfe,
      dados.id ?? null,
      nomeEmitente,
      cnpjEmitente,
      valorTotal,
      dados.data_emissao ?? null,
      dados.data_geracao ?? null,
      dados.situacao ?? null,
      dados.versao != null ? String(dados.versao) : null,
      manifestacaoFocus,
      JSON.stringify(dados),
    ]
  );
  return true;
}

async function main() {
  if (!FOCUS_TOKEN) {
    console.error("FOCUS_TOKEN não configurado.");
    process.exit(1);
  }

  let versao = 0;
  let totalProcessadas = 0;
  let pagina = 0;

  while (true) {
    const resp = await axios.get("https://api.focusnfe.com.br/v2/nfes_recebidas", {
      params: { cnpj: CNPJ, versao },
      auth: { username: FOCUS_TOKEN, password: "" },
      validateStatus: () => true,
    });

    if (resp.status !== 200) {
      console.error("Erro na consulta Focus:", resp.status, JSON.stringify(resp.data));
      break;
    }

    const dados = Array.isArray(resp.data) ? resp.data : [];
    if (!dados.length) break;

    for (const item of dados) {
      await upsertNota(item);
      totalProcessadas++;
    }

    console.log(`Página ${pagina}: ${dados.length} registros processados (total acumulado: ${totalProcessadas})`);

    versao = Number(resp.headers["x-max-version"]) || versao;
    pagina++;
    if (dados.length < 100) break;
  }

  console.log(`\nImportação concluída. Total processado: ${totalProcessadas}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na importação:", err.message);
  process.exit(1);
});
