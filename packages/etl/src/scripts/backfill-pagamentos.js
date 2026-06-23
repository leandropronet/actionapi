'use strict';
/**
 * Recarrega o histórico de baixas de Contas a Pagar (CPGBAIXA).
 *
 * Uso:
 *   node src/scripts/backfill-pagamentos.js [AAAA-MM-DD]
 *
 * O acesso ao Oracle é exclusivamente por SELECT. A escrita ocorre somente
 * no PostgreSQL da ActionAPI.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const pagamentos = require('../jobs/pagamentos');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

const dataInicio = process.argv[2] || '2007-01-01';

(async () => {
  try {
    await pagamentos.sincronizar({ dataInicio });
    console.log(`[backfill-pagamentos] concluído desde ${dataInicio}`);
  } finally {
    await oracle.closePool();
    await pg.pool.end();
  }
})().catch((error) => {
  console.error('[backfill-pagamentos] erro:', error);
  process.exitCode = 1;
});
