'use strict';
/**
 * Compara os saldos locais com as funções oficiais do SiAGRI.
 *
 * Uso:
 *   node src/scripts/validar-saldos-financeiros.js
 *
 * Oracle é acessado exclusivamente com SELECT.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

const TOLERANCIA = 0.000001;

async function validar(nome, oracleSql, tipo) {
  console.log(`[validar-saldos] consultando ${nome}...`);
  const [oficialRes, localRes] = await Promise.all([
    oracle.query(oracleSql),
    pg.query(
      `SELECT parcela_id, saldo_unidade
       FROM raw.financeiro_saldos_local
       WHERE tipo = $1`,
      [tipo],
    ),
  ]);

  const local = new Map(
    localRes.rows.map((row) => [String(row.parcela_id), Number(row.saldo_unidade || 0)]),
  );
  let divergentes = 0;
  let diferencaAbsoluta = 0;
  let diferencaMaxima = 0;
  const exemplos = [];

  for (const row of oficialRes.rows) {
    const id = String(row.PARCELA_ID);
    const oficial = Number(row.SALDO || 0);
    const calculado = local.get(id);
    const diferenca = Math.abs(oficial - Number(calculado || 0));
    if (calculado === undefined || diferenca > TOLERANCIA) {
      divergentes += 1;
      diferencaAbsoluta += diferenca;
      diferencaMaxima = Math.max(diferencaMaxima, diferenca);
      if (exemplos.length < 10) exemplos.push({ id, oficial, calculado, diferenca });
    }
  }

  const resultado = {
    dominio: nome,
    parcelasOracle: oficialRes.rows.length,
    parcelasPostgres: localRes.rows.length,
    divergentes,
    diferencaAbsoluta,
    diferencaMaxima,
    exemplos,
  };
  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

(async () => {
  try {
    const cr = await validar(
      'Contas a Receber',
      `SELECT R.CTRL_REC AS PARCELA_ID, VA.VALOR AS SALDO
       FROM SULGOIANO.RECEBER R
       JOIN SULGOIANO.CABREC C ON C.CTRL_CBR = R.CTRL_CBR
       CROSS JOIN TABLE(
         SULGOIANO.VALOR_ABERTO_RECEBER_DATA(R.CTRL_REC, TRUNC(SYSDATE))
       ) VA
       WHERE R.SITU_REC = 'A' AND C.SITU_CBR = 'A'`,
      'CR',
    );

    const cp = await validar(
      'Contas a Pagar',
      `SELECT P.CTRL_PAG AS PARCELA_ID, VA.VALOR AS SALDO
       FROM SULGOIANO.PAGAR P
       CROSS JOIN TABLE(
         SULGOIANO.VALOR_ABERTO_PAGAR_DATA(P.CTRL_PAG, TRUNC(SYSDATE))
       ) VA`,
      'CP',
    );

    if (cr.divergentes || cp.divergentes) process.exitCode = 1;
  } finally {
    await oracle.closePool();
    await pg.pool.end();
  }
})().catch((error) => {
  console.error('[validar-saldos] erro:', error);
  process.exitCode = 1;
});
