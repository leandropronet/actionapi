'use strict';
/**
 * Atualiza indexadores/cotações e recalcula os saldos locais de CR e CP.
 *
 * Pré-requisito de primeira implantação: executar os backfills de duplicatas,
 * recebimentos, parcelas CP e pagamentos após a migração 014.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const indexadores = require('../jobs/financeiro_indexadores');
const saldos = require('../jobs/financeiro_saldos_local');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

(async () => {
  try {
    await indexadores.sincronizar();
    await saldos.sincronizar();
  } finally {
    await oracle.closePool();
    await pg.pool.end();
  }
})().catch((error) => {
  console.error('[recalcular-saldos-financeiros] erro:', error);
  process.exitCode = 1;
});
