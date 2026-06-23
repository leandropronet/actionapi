'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const pg = require('../db/postgres');

function monitored() {
  const raw = process.env.ETL_HEALTHCHECK_JOBS
    || 'duplicatas:180,recebimentos:180,pagamentos:180,financeiro_saldos_local:180';
  return raw.split(',').map((item) => {
    const [jobName, minutes] = item.trim().split(':');
    return { jobName, minutes: Number(minutes) };
  }).filter((item) => item.jobName && Number.isFinite(item.minutes));
}

(async () => {
  await pg.query('SELECT 1');
  for (const item of monitored()) {
    const result = await pg.query(
      'SELECT last_success_at FROM etl_job_status WHERE job_name = $1',
      [item.jobName],
    );
    const value = result.rows[0]?.last_success_at;
    if (!value) throw new Error(`${item.jobName} ainda não teve execução bem-sucedida`);
    const ageMinutes = (Date.now() - new Date(value).getTime()) / 60000;
    if (ageMinutes > item.minutes) {
      throw new Error(`${item.jobName} atrasado há ${Math.floor(ageMinutes)} minutos`);
    }
  }
  console.log('ok');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pg.pool.end());
