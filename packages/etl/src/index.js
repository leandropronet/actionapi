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
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const schedule = require('node-schedule');
const oracle   = require('./db/oracle');
const monitoring = require('./monitoring');
const analytics = require('./transforms/analytics');

const jobs = {
  estoque:       require('./jobs/estoque'),
  pedidos:       require('./jobs/pedidos'),
  pedidos_compra: require('./jobs/pedidos_compra'),
  faturamento:   require('./jobs/faturamento'),
  nfe_entrada:   require('./jobs/nfe_entrada'),
  conciliacao:   require('./jobs/conciliacao'),
  duplicatas:    require('./jobs/duplicatas'),
  duplicatas_saldo: require('./jobs/duplicatas_saldo'),
  financeiro:    require('./jobs/financeiro'),
  financeiro_indexadores: require('./jobs/financeiro_indexadores'),
  financeiro_saldos_local: require('./jobs/financeiro_saldos_local'),
  recebimentos:  require('./jobs/recebimentos'),
  pagamentos:    require('./jobs/pagamentos'),
  reconciliacao_financeira_recente: require('./jobs/reconciliacao_financeira_recente'),
  lotes:         require('./jobs/lotes'),
  saldo_lote:    require('./jobs/saldo_lote'),
  contabil:      require('./jobs/contabil'),
  dimensoes:     require('./jobs/dimensoes'),
  analytics:     { sincronizar: analytics.atualizar },
};

const crons = {
  estoque:       process.env.CRON_ESTOQUE       || '*/10 * * * *',
  pedidos:       process.env.CRON_PEDIDOS       || '*/30 * * * *',
  pedidos_compra: process.env.CRON_PEDIDOS_COMPRA || '37 * * * *',
  faturamento:   process.env.CRON_FATURAMENTO   || '3 * * * *',
  nfe_entrada:   process.env.CRON_NFE_ENTRADA   || '29 * * * *',
  conciliacao:   process.env.CRON_CONCILIACAO   || '43 * * * *',
  duplicatas:    process.env.CRON_DUPLICATAS    || '7 * * * *',
  duplicatas_saldo: process.env.CRON_DUPLICATAS_SALDO || '30 6 * * *',
  financeiro:    process.env.CRON_FINANCEIRO    || '11 * * * *',
  financeiro_indexadores: process.env.CRON_FINANCEIRO_INDEXADORES || '47 * * * *',
  financeiro_saldos_local: process.env.CRON_FINANCEIRO_SALDOS_LOCAL || '52 * * * *',
  recebimentos:  process.env.CRON_RECEBIMENTOS  || '17 * * * *',
  pagamentos:    process.env.CRON_PAGAMENTOS    || '23 * * * *',
  reconciliacao_financeira_recente:
    process.env.CRON_RECONCILIACAO_FINANCEIRA_RECENTE || '20 2 * * *',
  lotes:         process.env.CRON_LOTES         || '5 6 * * *',
  saldo_lote:    process.env.CRON_SALDO_LOTE   || '30 6 * * *',
  contabil:      process.env.CRON_CONTABIL      || '0 1 * * *',
  dimensoes:     process.env.CRON_DIMENSOES     || '15 6 * * *',
  analytics:     process.env.CRON_ANALYTICS     || '55 * * * *',
};

const runningJobs = new Set();

async function executarJob(nome, fn) {
  if (runningJobs.has(nome)) {
    console.warn(`[scheduler] job ${nome} ainda está em execução; ciclo ignorado`);
    return;
  }
  runningJobs.add(nome);
  const started = new Date();
  console.log(`[scheduler] iniciando job: ${nome}`);
  try {
    await monitoring.registrarInicio(nome);
    const result = await fn();
    await monitoring.registrarSucesso(nome, started, result);
    console.log(`[scheduler] job concluído: ${nome}`);
  } catch (err) {
    console.error(`[scheduler] erro no job ${nome}:`, err.message);
    try {
      await monitoring.registrarErro(nome, started, err);
    } catch (monitorError) {
      console.error('[scheduler] erro ao registrar monitoramento:', monitorError.message);
    }
  } finally {
    runningJobs.delete(nome);
  }
}

async function main() {
  console.log('[ETL Service] iniciando...');
  await monitoring.garantirSchema();

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

  const monitorCron = process.env.CRON_MONITOR_ETL || '*/10 * * * *';
  schedule.scheduleJob(monitorCron, () => {
    monitoring.verificarAtrasos().catch((error) => {
      console.error('[monitoring] erro ao verificar atrasos:', error.message);
    });
  });
  console.log(`[scheduler] monitoramento agendado: ${monitorCron}`);

  if (String(process.env.ETL_RUN_ON_START || 'true').toLowerCase() === 'true') {
    (async () => {
      for (const nome of ['duplicatas', 'recebimentos', 'pagamentos', 'financeiro_saldos_local']) {
        await executarJob(nome, jobs[nome].sincronizar);
      }
    })().catch((error) => console.error('[scheduler] falha na carga inicial:', error.message));
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
