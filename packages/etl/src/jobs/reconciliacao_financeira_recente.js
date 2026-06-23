'use strict';
const recebimentos = require('./recebimentos');
const pagamentos = require('./pagamentos');
const saldos = require('./financeiro_saldos_local');

function dateInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function sincronizar() {
  const days = Number(process.env.ETL_RECONCILIATION_DAYS || 30);
  const timeZone = process.env.TZ || 'America/Sao_Paulo';
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const end = new Date(now.getTime() + 86400000);
  const dataInicio = dateInTimeZone(start, timeZone);
  const dataFim = dateInTimeZone(end, timeZone);

  console.log(
    `[reconciliacao_financeira_recente] relendo baixas de ${dataInicio} a ${dataFim}`,
  );
  const cr = await recebimentos.sincronizar({ dataInicio, dataFim });
  const cp = await pagamentos.sincronizar({ dataInicio, dataFim });
  await saldos.sincronizar();
  return {
    dataInicio,
    dataFim,
    recebimentos: cr?.registros || 0,
    pagamentos: cp?.registros || 0,
  };
}

module.exports = { sincronizar };
