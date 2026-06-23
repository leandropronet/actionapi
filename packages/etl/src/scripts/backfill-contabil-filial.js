'use strict';
/**
 * Corrige filial_id em raw.contabil usando LANCONTAB.CODI_EMP em vez de
 * CABLANCTB.CODI_EMP (vazio em ~98% dos lançamentos — ver STATUS.md).
 * Faz apenas UPDATE de filial_id, sem reprocessar as demais colunas.
 * O Oracle é acessado exclusivamente com SELECT.
 *
 * Uso:
 *   node src/scripts/backfill-contabil-filial.js
 */
const oracle = require('../db/oracle');
const pg = require('../db/postgres');
const cfg = require('../oracle-config').contabil;

const LOTE = 5000;

async function main() {
  let cursor = 0;
  let totalLidos = 0;
  let totalAtualizados = 0;

  for (;;) {
    const result = await oracle.query(`
      SELECT ${cfg.campoLancId} AS SEQU_LCT, ${cfg.campoLancCabId} AS SEQU_CLC,
             ${cfg.campoLancFilial} AS CODI_EMP
      FROM ${cfg.schema}.${cfg.tabelaLanc}
      WHERE ${cfg.campoLancFilial} IS NOT NULL AND ${cfg.campoLancId} > :cursor
      ORDER BY ${cfg.campoLancId}
      FETCH FIRST :lote ROWS ONLY
    `, { cursor, lote: LOTE });

    const rows = result.rows || [];
    if (!rows.length) break;

    const ids = rows.map((r) => `${r.SEQU_CLC}_${r.SEQU_LCT}`);
    const filiais = rows.map((r) => String(r.CODI_EMP));

    const res = await pg.query(`
      UPDATE raw.contabil AS c
      SET filial_id = v.filial_id
      FROM (SELECT * FROM UNNEST($1::TEXT[], $2::TEXT[]) AS t(id, filial_id)) v
      WHERE c.id = v.id AND (c.filial_id IS NULL OR c.filial_id = '') AND c.filial_id IS DISTINCT FROM v.filial_id
    `, [ids, filiais]);

    totalLidos += rows.length;
    totalAtualizados += res.rowCount;
    cursor = rows[rows.length - 1].SEQU_LCT;
    console.log(`[backfill-contabil-filial] lidos ${totalLidos} / atualizados ${totalAtualizados}`);
  }

  console.log(`[backfill-contabil-filial] concluído — ${totalAtualizados} partidas corrigidas`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await oracle.closePool();
    await pg.pool.end();
  });
