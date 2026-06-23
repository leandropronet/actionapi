'use strict';
/**
 * Janela incremental segura para tabelas Oracle com DUMANUT.
 *
 * - usa o relógio do Oracle como limite superior consistente;
 * - relê uma sobreposição configurável (UPSERT torna isso idempotente);
 * - só avança o cursor após o job concluir;
 * - cargas históricas explícitas não alteram o cursor incremental.
 */
const oracle = require('./db/oracle');
const { lerUltimoSync, atualizarSync } = require('./upsert');

function overlapMinutes() {
  const parsed = Number(process.env.ETL_INCREMENTAL_OVERLAP_MINUTES || 2880);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2880;
}

async function abrirJanela(dominio) {
  const ultimoSync = await lerUltimoSync(dominio);
  const result = await oracle.query(
    'SELECT CAST(SYSTIMESTAMP AS TIMESTAMP) AS LIMITE_SUPERIOR FROM DUAL',
  );
  const limiteSuperior = result.rows?.[0]?.LIMITE_SUPERIOR;
  if (!(limiteSuperior instanceof Date)) {
    throw new Error(`[${dominio}] não foi possível obter o relógio do Oracle`);
  }
  const limiteInferior = new Date(
    ultimoSync.getTime() - overlapMinutes() * 60 * 1000,
  );
  return { ultimoSync, limiteInferior, limiteSuperior };
}

async function concluirJanela(dominio, janela) {
  await atualizarSync(dominio, janela.limiteSuperior);
}

module.exports = { abrirJanela, concluirJanela, overlapMinutes };
