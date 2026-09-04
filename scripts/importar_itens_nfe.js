/**
 * Roda manualmente a importação de itens de NF-e pendentes (mesma lógica que já
 * roda sozinha em produção via services/importarItensNfe.js + agendamento no server.js).
 * Útil pra forçar uma passada imediata ou rodar localmente.
 *
 * Uso: fly ssh console -a api-sig-premcell -C "node scripts/importar_itens_nfe.js"
 */

require("dotenv").config();
const { importarItensPendentes } = require("../services/importarItensNfe");

async function main() {
  console.log("Buscando notas pendentes de importação de itens...");
  const resultado = await importarItensPendentes();
  console.log(
    `\nConcluído. Total: ${resultado.total} | Importadas: ${resultado.sucesso} | Sem itens no XML: ${resultado.semItens} | Erros: ${resultado.erros}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na importação de itens:", err.message);
  process.exit(1);
});
