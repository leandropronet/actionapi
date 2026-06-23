'use strict';
/**
 * Recarrega e reconcilia as parcelas atuais de Contas a Pagar (PAGAR).
 *
 * Uso:
 *   node src/scripts/backfill-parcelas-cp.js [AAAA-MM-DD]
 *
 * O Oracle é consultado apenas com SELECT. A reconciliação remove somente
 * do PostgreSQL da ActionAPI registros que já não existem no PAGAR do ERP.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const financeiro = require('../jobs/financeiro');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

const dataInicio = process.argv[2] || '2007-01-01';

(async () => {
  try {
    await financeiro.sincronizarContasPagar({ dataInicio, reconciliar: true });
    console.log(`[backfill-parcelas-cp] concluído desde ${dataInicio}`);
  } finally {
    await oracle.closePool();
    await pg.pool.end();
  }
})().catch((error) => {
  console.error('[backfill-parcelas-cp] erro:', error);
  process.exitCode = 1;
});
