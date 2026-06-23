'use strict';
/**
 * jobs/duplicatas_saldo.js
 *
 * Snapshot diário do saldo em aberto de Contas a Receber, replicando
 * exatamente a query "Contas a Receber por Cliente - Data" do SiAGRI:
 * usa a função oficial VALOR_ABERTO_RECEBER_DATA(CTRL_REC, DT_CALC) — não
 * O equivalente local está em financeiro_saldos_local.js. Este snapshot
 * permanece como referência oficial para validar continuamente a reprodução.
 *
 * Filtro replicado da query original: RECEBER.SITU_REC='A' AND CABREC.SITU_CBR='A',
 * com sinal ajustado por natureza do documento (TIPDOC.TIPO_TDO):
 *   D (débito)  → mantém o sinal de VALOR_ABERTO_RECEBER_DATA
 *   C (crédito, ex.: adiantamento/devolução) → inverte o sinal
 * Só entra no resultado quando |saldo| > 0 e o sinal ajustado é coerente
 * com a natureza (D positivo / C negativo) — mesmo filtro do SELECT original.
 *
 * Validado em 2026-06-20 contra o relatório SiAGRI: R$ 157.092.758,96
 * (bate exato somando a moeda secundária SJ$ em valor de face).
 *
 * Estratégia: TRUNCATE + INSERT (snapshot point-in-time, como raw.saldo_lote).
 * O Oracle é acessado exclusivamente com SELECT.
 */
const oracle = require('../db/oracle');
const pg = require('../db/postgres');
const { upsertRawBatch, atualizarSync } = require('../upsert');

async function sincronizar() {
  console.log('[duplicatas_saldo] calculando saldo em aberto via VALOR_ABERTO_RECEBER_DATA()...');

  const sql = `
    SELECT
      R.CTRL_REC, C.CTRL_CBR, C.CODI_EMP, C.CODI_TRA,
      C.CODI_TDO, TD.TIPO_TDO, C.NUME_CBR, C.SERI_CBR, R.NPAR_REC,
      C.DATA_CBR, R.VENC_REC, R.VLOR_REC,
      VA.VALOR AS SALDO_FUNCAO,
      CASE WHEN TD.TIPO_TDO = 'C' THEN -1 * VA.VALOR ELSE VA.VALOR END AS SALDO_AJUSTADO,
      TRUNC(SYSDATE) - TRUNC(R.VENC_REC) AS DIAS_ATRASO
    FROM SULGOIANO.RECEBER R
    JOIN SULGOIANO.CABREC C ON C.CTRL_CBR = R.CTRL_CBR
    LEFT JOIN SULGOIANO.TIPDOC TD ON TD.CODI_TDO = C.CODI_TDO
    CROSS JOIN TABLE(VALOR_ABERTO_RECEBER_DATA(R.CTRL_REC, TRUNC(SYSDATE))) VA
    WHERE R.SITU_REC = 'A' AND C.SITU_CBR = 'A'
  `;

  const result = await oracle.query(sql, {});
  const rows = result.rows || [];

  const hoje = new Date().toISOString().slice(0, 10);
  const registros = rows
    .filter((row) => {
      const saldoFunc = row.SALDO_FUNCAO ?? 0;
      const saldoAdj = row.SALDO_AJUSTADO ?? 0;
      const nat = row.TIPO_TDO;
      return Math.abs(saldoFunc) > 0 && ((nat === 'D' && saldoAdj > 0) || (nat === 'C' && saldoAdj < 0));
    })
    .map((row) => ({
      id:                      String(row.CTRL_REC),
      nf_id:                   row.CTRL_CBR != null ? String(row.CTRL_CBR) : null,
      filial_id:               row.CODI_EMP != null ? String(row.CODI_EMP) : null,
      cliente_id:              row.CODI_TRA != null ? String(row.CODI_TRA) : null,
      tipo_documento:          row.CODI_TDO != null ? String(row.CODI_TDO) : null,
      natureza_tipo_documento: row.TIPO_TDO ? String(row.TIPO_TDO).trim() : null,
      numero_documento:        row.NUME_CBR != null ? String(row.NUME_CBR) : null,
      serie_documento:         row.SERI_CBR ? String(row.SERI_CBR).trim() : null,
      parcela_nr:              row.NPAR_REC != null ? String(row.NPAR_REC) : null,
      data_emissao:            row.DATA_CBR || null,
      data_vencimento:         row.VENC_REC || null,
      valor_parcela:           row.VLOR_REC ?? null,
      saldo_funcao:            row.SALDO_FUNCAO ?? null,
      saldo_ajustado:          row.SALDO_AJUSTADO ?? null,
      dias_atraso:             row.DIAS_ATRASO ?? null,
      data_calculo:            hoje,
      _source:                 'siagri',
    }));

  await pg.query('TRUNCATE TABLE raw.duplicatas_saldo');
  if (registros.length) await upsertRawBatch('raw.duplicatas_saldo', registros);
  await atualizarSync('duplicatas_saldo');
  console.log(`[duplicatas_saldo] ${registros.length} parcelas com saldo em aberto`);
}

module.exports = { sincronizar };
