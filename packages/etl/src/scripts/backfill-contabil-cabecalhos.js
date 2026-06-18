'use strict';
/**
 * Recarrega cabeçalhos contábeis por data de lançamento.
 * O Oracle é acessado exclusivamente com SELECT.
 *
 * Uso:
 *   node src/scripts/backfill-contabil-cabecalhos.js 2020-01-01
 */
const job = require('../jobs/conciliacao');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

async function main() {
  const dataInicio = process.argv[2] || '2020-01-01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
    throw new Error('dataInicio deve estar no formato AAAA-MM-DD.');
  }
  await job.sincronizarContabilCabecalhos({ dataInicio });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await oracle.closePool();
    await pg.pool.end();
  });
