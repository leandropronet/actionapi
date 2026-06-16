'use strict';
require('dotenv').config();
const schedule = require('node-schedule');
const oracle   = require('./db/oracle');
const analytics = require('./transforms/analytics');

const jobs = {
  estoque:     require('./jobs/estoque'),
  pedidos:     require('./jobs/pedidos'),
  faturamento: require('./jobs/faturamento'),
  duplicatas:  require('./jobs/duplicatas'),
  financeiro:  require('./jobs/financeiro'),
  contabil:    require('./jobs/contabil'),
  dimensoes:   require('./jobs/dimensoes'),
};

const crons = {
  estoque:     process.env.CRON_ESTOQUE     || '*/10 * * * *',
  pedidos:     process.env.CRON_PEDIDOS     || '*/30 * * * *',
  faturamento: process.env.CRON_FATURAMENTO || '0 * * * *',
  duplicatas:  process.env.CRON_DUPLICATAS  || '0 * * * *',
  financeiro:  process.env.CRON_FINANCEIRO  || '0 * * * *',
  contabil:    process.env.CRON_CONTABIL    || '0 1 * * *',
  dimensoes:   process.env.CRON_DIMENSOES   || '0 6 * * *',
};

async function executarJob(nome, fn) {
  console.log(`[scheduler] iniciando job: ${nome}`);
  try {
    await fn();
    await analytics.atualizar();
  } catch (err) {
    console.error(`[scheduler] erro no job ${nome}:`, err.message);
  }
}

async function main() {
  console.log('[ETL Service] iniciando...');

  // Verifica conexão Oracle ao subir
  try {
    await oracle.getPool();
    console.log('[ETL Service] Oracle: conectado');
  } catch (err) {
    console.error('[ETL Service] ERRO Oracle:', err.message);
    console.error('             Verifique as variáveis ORACLE_* no .env');
    // Não aborta — tenta reconectar nos próximos jobs
  }

  // Registra os jobs agendados
  for (const [nome, cron] of Object.entries(crons)) {
    schedule.scheduleJob(cron, () => executarJob(nome, jobs[nome].sincronizar));
    console.log(`[scheduler] ${nome} agendado: ${cron}`);
  }

  console.log('[ETL Service] rodando. Aguardando próxima execução...');
}

main().catch((err) => {
  console.error('[ETL Service] erro fatal:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('[ETL Service] encerrando...');
  await oracle.closePool();
  process.exit(0);
});
