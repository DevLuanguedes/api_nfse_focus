/**
 * Apaga todas as alíquotas ISS com updated_at anterior a HOJE.
 * Mantém apenas as alíquotas atualizadas hoje (02/02 ou a data em que rodar).
 *
 * Uso: node scripts/apagar_aliquotas_ate_ontem.js
 */

require('dotenv').config();
const db = require('../db');

async function main() {
  const d = new Date();
  const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // YYYY-MM-DD (data local)

  console.log('Data de hoje (mantém apenas registros de hoje):', hoje);
  console.log('');

  try {
    // Quantos serão apagados (updated_at antes de hoje) - usa data do servidor
    const countAntes = await db.query(
      `SELECT COUNT(*) AS total FROM municipio_aliquota_iss WHERE (updated_at::date) < $1::date`,
      [hoje]
    );
    const totalApagar = parseInt(countAntes.rows[0].total, 10);

    if (totalApagar === 0) {
      console.log('Nenhum registro com updated_at antes de hoje. Nada a apagar.');
      process.exit(0);
      return;
    }

    console.log('Registros a apagar (updated_at antes de hoje):', totalApagar);

    // Quantos ficam (updated_at hoje)
    const countHoje = await db.query(
      `SELECT COUNT(*) AS total FROM municipio_aliquota_iss WHERE (updated_at::date) = $1::date`,
      [hoje]
    );
    const totalFicam = parseInt(countHoje.rows[0].total, 10);
    console.log('Registros que permanecem (updated_at hoje):', totalFicam);
    console.log('');

    // Apaga
    await db.query(
      `DELETE FROM municipio_aliquota_iss WHERE (updated_at::date) < $1::date`,
      [hoje]
    );

    console.log('Apagados:', totalApagar, 'registros.');
    console.log('Concluído.');
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
