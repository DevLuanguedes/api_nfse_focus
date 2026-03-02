/**
 * Importa a planilha do cliente (portal) e gera o arquivo no formato "Automação 7.02",
 * pronto para enviar à API e emitir as NFs. Se faltar alíquota de ISS para algum município
 * (não estiver no banco), pede para cadastrar no terminal e salva na tabela municipio_aliquota_iss.
 *
 * Uso:
 *   node scripts/transformar_planilha_cliente.js <planilha_do_cliente.xlsx|xlsm> [saida.xlsx] [template.xlsm]
 */

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { transformarPlanilhaClienteParaAutomacao } = require("../services/planilhaClienteParaAutomacao");
const { salvarAliquotaMunicipio } = require("../services/aliquotasMunicipio");

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(texto, (resposta) => {
      rl.close();
      resolve((resposta || "").trim());
    });
  });
}

async function main() {
  const entradaPath = process.argv[2];
  const saidaPath = process.argv[3];
  const templatePath = process.argv[4];

  if (!entradaPath) {
    console.error("Uso: node scripts/transformar_planilha_cliente.js <planilha_do_cliente.xlsx|xlsm> [saida.xlsx] [template.xlsm]");
    process.exit(1);
  }

  const entradaAbs = path.resolve(entradaPath);
  if (!fs.existsSync(entradaAbs)) {
    console.error("Arquivo não encontrado:", entradaAbs);
    process.exit(1);
  }

  let saidaAbs;
  if (saidaPath) {
    saidaAbs = path.resolve(saidaPath);
  } else {
    const dir = path.dirname(entradaAbs);
    const base = path.basename(entradaAbs, path.extname(entradaAbs));
    saidaAbs = path.join(dir, `${base}_Automacao_7_02.xlsx`);
  }

  let templateAbs = templatePath ? path.resolve(templatePath) : null;
  if (!templateAbs) {
    const candidatos = [
      path.join(path.dirname(entradaAbs), "automacao_NFSE_7.02.xlsm"),
      path.join(process.env.USERPROFILE || "", "Downloads", "automacao_NFSE_7.02.xlsm"),
    ];
    for (const p of candidatos) {
      if (fs.existsSync(p)) {
        templateAbs = p;
        break;
      }
    }
  }
  if (templateAbs) console.log("Template:", templateAbs);

  try {
    const opcoes = { templatePath: templateAbs, retornarMunicipiosSemAliquota: true };
    let result = await transformarPlanilhaClienteParaAutomacao(entradaAbs, opcoes);

    if (result && typeof result === "object" && result.municipiosSemAliquota && result.municipiosSemAliquota.length > 0) {
      console.log("\n--- Municípios sem alíquota cadastrada no banco. Informe a alíquota ISS em % ---\n");
      for (const m of result.municipiosSemAliquota) {
        const label = [m.codigo, m.cidade, m.uf].filter(Boolean).join(" / ");
        let aliquota = await perguntar(`${label} — alíquota ISS (%): `);
        aliquota = aliquota.replace(",", ".");
        const num = Number(aliquota);
        if (Number.isFinite(num)) {
          await salvarAliquotaMunicipio(m.codigo, m.cidade, m.uf, num);
          console.log("  Cadastrado.");
        } else {
          console.log("  Valor inválido, ignorado.");
        }
      }
      console.log("\nRegenerando planilha com as alíquotas cadastradas...\n");
      result = await transformarPlanilhaClienteParaAutomacao(entradaAbs, { templatePath: templateAbs });
    }

    const buffer = result && typeof result === "object" && result.buffer !== undefined ? result.buffer : result;
    if (!buffer || !Buffer.isBuffer(buffer)) {
      console.error("Erro: não foi possível gerar a planilha.");
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(saidaAbs), { recursive: true });
    fs.writeFileSync(saidaAbs, buffer);
    console.log("Planilha transformada com sucesso.");
    console.log("Saída:", saidaAbs);
    console.log("Envie este arquivo na API (upload) para emitir as NFs.");
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
}

main();
