'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').contabil;

// CABLANCTB (cabeçalho) + LANCONTAB (partidas D/C)
// Uma linha em raw.contabil = um lançamento contábil completo (agrupado por cabeçalho)
async function sincronizar() {
  const ultimoSync = await lerUltimoSync('contabil');
  console.log(`[contabil] sync incremental desde ${ultimoSync.toISOString()}`);

  const sql = `
    SELECT
      CAB.${cfg.campoCabId}     AS SEQU_CLC,
      CAB.${cfg.campoCabFilial} AS CODI_EMP,
      CAB.${cfg.campoCabData}   AS DATA_CLC,
      CAB.${cfg.campoCabValor}  AS VCON_CLC,
      CAB.${cfg.campoCabDoc}    AS CTRL_CLC,
      CAB.${cfg.campoCabTipo}   AS TIPO_CLC,
      LCT.${cfg.campoLancId}    AS SEQU_LCT,
      LCT.${cfg.campoLancConta} AS CODI_CPC,
      LCT.${cfg.campoLancPlano} AS CODI_PLC,
      LCT.${cfg.campoLancValor} AS VLOR_LCT,
      LCT.${cfg.campoLancTipo}  AS TIPO_LCT,
      LCT.${cfg.campoLancHist}  AS HIST_HIS,
      CAB.${cfg.campoCabDataAlter} AS DUMANUT
    FROM ${cfg.schema}.${cfg.tabelaCab} CAB
    JOIN ${cfg.schema}.${cfg.tabelaLanc} LCT
      ON LCT.${cfg.campoLancCabId} = CAB.${cfg.campoCabId}
    WHERE CAB.${cfg.campoCabDataAlter} > :ultimoSync
    ORDER BY CAB.${cfg.campoCabDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[contabil] sem registros novos');
    return;
  }

  const registros = rows.map((row) => {
    // Competência derivada da data do lançamento
    const dt = row.DATA_CLC;
    let competencia = null;
    if (dt instanceof Date) {
      competencia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }

    return {
      // PK = cabeçalho + partida (um lançamento pode ter várias partidas)
      id:              `${row.SEQU_CLC}_${row.SEQU_LCT}`,
      filial_id:       String(row.CODI_EMP ?? ''),
      data_lancamento: row.DATA_CLC || null,
      competencia,
      data_alteracao:  row.DUMANUT || null,
      _dados:          JSON.stringify(row),
      _source:         'siagri',
    };
  });

  await upsertRaw('raw.contabil', registros);
  await atualizarSync('contabil');
  console.log(`[contabil] ${registros.length} partidas sincronizadas`);
}

module.exports = { sincronizar };
