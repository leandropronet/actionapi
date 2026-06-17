'use strict';
/**
 * etl/src/index.js — ETL Service
 *
 * Scheduler principal do ETL incremental.
 * Usa node-schedule (sintaxe cron Unix) para executar cada job no intervalo
 * configurado no .env (CRON_FATURAMENTO, CRON_PEDIDOS, etc.).
 *
 * Após cada job bem-sucedido, dispara analytics.atualizar() para manter
 * a camada analytics/ materializada.
 *
 * Para executar um job manualmente (sem aguardar o cron):
 *   node -e "require('./src/jobs/faturamento').sincronizar().then(console.log)"
 *
 * Para carga inicial (5 anos de histórico):
 *   node src/carga_inicial/index.js
 */
require('dotenv').config();
const schedule = require('node-schedule');
const oracle   = require('./db/oracle');
const analytics = require('./transforms/analytics');

const jobs = {
  estoque:       require('./jobs/estoque'),
  pedidos:       require('./jobs/pedidos'),
  faturamento:   require('./jobs/faturamento'),
  duplicatas:    require('./jobs/duplicatas'),
  financeiro:    require('./jobs/financeiro'),
  recebimentos:  require('./jobs/recebimentos'),
  pagamentos:    require('./jobs/pagamentos'),
  lotes:         require('./jobs/lotes'),
  saldo_lote:    require('./jobs/saldo_lote'),
  contabil:      require('./jobs/contabil'),
  dimensoes:     require('./jobs/dimensoes'),
};

const crons = {
  estoque:       process.env.CRON_ESTOQUE       || '*/10 * * * *',
  pedidos:       process.env.CRON_PEDIDOS       || '*/30 * * * *',
  faturamento:   process.env.CRON_FATURAMENTO   || '0 * * * *',
  duplicatas:    process.env.CRON_DUPLICATAS    || '0 * * * *',
  financeiro:    process.env.CRON_FINANCEIRO    || '0 * * * *',
  recebimentos:  process.env.CRON_RECEBIMENTOS  || '0 * * * *',
  pagamentos:    process.env.CRON_PAGAMENTOS    || '0 * * * *',
  lotes:         process.env.CRON_LOTES         || '0 6 * * *',
  saldo_lote:    process.env.CRON_SALDO_LOTE   || '30 6 * * *',
  contabil:      process.env.CRON_CONTABIL      || '0 1 * * *',
  dimensoes:     process.env.CRON_DIMENSOES     || '0 6 * * *',
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
