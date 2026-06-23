'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const recebimentos = require('../jobs/recebimentos');
const pagamentos = require('../jobs/pagamentos');
const saldos = require('../jobs/financeiro_saldos_local');
const monitoring = require('../monitoring');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

(async () => {
  await monitoring.garantirSchema();
  async function execute(name, fn) {
    const started = new Date();
    await monitoring.registrarInicio(name);
    try {
      const result = await fn();
      await monitoring.registrarSucesso(name, started, result);
      return result;
    } catch (error) {
      await monitoring.registrarErro(name, started, error);
      throw error;
    }
  }
  const cr = await execute('recebimentos', () => recebimentos.sincronizar());
  const cp = await execute('pagamentos', () => pagamentos.sincronizar());
  await execute('financeiro_saldos_local', () => saldos.sincronizar());
  console.log('[sincronizar-financeiro-agora]', { cr, cp });
})().catch((error) => {
  console.error('[sincronizar-financeiro-agora] erro:', error);
  process.exitCode = 1;
}).finally(async () => {
  await oracle.closePool();
  await pg.pool.end();
});
