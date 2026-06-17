'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfgCp  = require('../oracle-config').financeiro_cp;
const cfgCr  = require('../oracle-config').financeiro_cr;
const cfgFin = require('../oracle-config').contratofin;

// Sincroniza CP (CABPAGAR + PAGAR) ou CR (CABREC + RECEBER)
async function sincronizarTipo(cfg, dominio, tabela) {
  const ultimoSync = await lerUltimoSync(dominio);
  console.log(`[${dominio}] sync incremental desde ${ultimoSync.toISOString()}`);

  const sql = `
    SELECT
      CAB.${cfg.campoCabId}      AS CAB_ID,
      CAB.${cfg.campoCabFilial}  AS CODI_EMP,
      CAB.${cfg.campoCabData}    AS DATA_DOC,
      CAB.${cfg.campoCabTotal}   AS TOTA_DOC,
      PAR.${cfg.campoParcelaId}  AS PAR_ID,
      PAR.${cfg.campoParcelaNr}  AS NPAR,
      PAR.${cfg.campoParcelaVenc}  AS VENC,
      PAR.${cfg.campoParcelaValor} AS VLOR,
      PAR.${cfg.campoFlagAssina}   AS FLAG_ASSINA,
      GREATEST(
        NVL(CAB.${cfg.campoCabDataAlter}, DATE '2000-01-01'),
        NVL(PAR.${cfg.campoParcelaDataAlter}, DATE '2000-01-01')
      ) AS DT_ALTER
    FROM ${cfg.schema}.${cfg.tabelaCab} CAB
    JOIN ${cfg.schema}.${cfg.tabelaParcela} PAR
      ON PAR.${cfg.campoParcelaCabId} = CAB.${cfg.campoCabId}
    WHERE CAB.${cfg.campoCabDataAlter} > :ultimoSync
       OR PAR.${cfg.campoParcelaDataAlter} > :ultimoSync
    ORDER BY DT_ALTER
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log(`[${dominio}] sem registros novos`);
    return;
  }

  const registros = rows.map((row) => ({
    id:              String(row.PAR_ID),
    filial_id:       String(row.CODI_EMP ?? ''),
    data_emissao:    row.DATA_DOC || null,
    data_vencimento: row.VENC || null,
    data_alteracao:  row.DT_ALTER || null,
    _dados:          JSON.stringify(row),
    _source:         'siagri',
  }));

  await upsertRaw(tabela, registros);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${registros.length} parcelas sincronizadas`);
}

async function sincronizar() {
  await sincronizarTipo(cfgCp, 'financeiro_cp', 'raw.financeiro_cp');
  await sincronizarTipo(cfgCr, 'financeiro_cr', 'raw.financeiro_cr');

  // ── CONTRATOFIN: contratos de empréstimos e financiamentos ───────────────
  const ultimoSyncFin = await lerUltimoSync('contratofin');
  console.log(`[contratofin] sync incremental desde ${ultimoSyncFin.toISOString()}`);

  const sqlFin = `
    SELECT
      ${cfgFin.campoId}         AS CODI_CFE,
      ${cfgFin.campoFilial}     AS CODI_EMP,
      ${cfgFin.campoNumero}     AS NUME_CFE,
      ${cfgFin.campoDesc}       AS DESC_CFE,
      ${cfgFin.campoValor}      AS VLOR_CFE,
      ${cfgFin.campoDataDoc}    AS DTDO_CFE,
      ${cfgFin.campoVencimento} AS DTVC_CFE,
      ${cfgFin.campoTaxaJuros}  AS PCJU_CFE,
      ${cfgFin.campoAgente}     AS CODI_TRA,
      ${cfgFin.campoTipoFin}    AS CODI_TFI,
      ${cfgFin.campoDataAlter}  AS DUMANUT
    FROM ${cfgFin.schema}.${cfgFin.tabela}
    WHERE ${cfgFin.campoDataAlter} > :ultimoSync
    ORDER BY ${cfgFin.campoDataAlter}
  `;

  const resFin = await oracle.query(sqlFin, { ultimoSync: ultimoSyncFin });
  const rowsFin = resFin.rows || [];

  if (rowsFin.length) {
    const registrosFin = rowsFin.map((row) => ({
      id:              String(row.CODI_CFE),
      filial_id:       row.CODI_EMP ? String(row.CODI_EMP) : null,
      data_documento:  row.DTDO_CFE || null,
      data_vencimento: row.DTVC_CFE || null,
      data_alteracao:  row.DUMANUT  || null,
      _dados:          JSON.stringify(row),
      _source:         'siagri',
    }));
    await upsertRaw('raw.contratofin', registrosFin);
    await atualizarSync('contratofin');
    console.log(`[contratofin] ${registrosFin.length} contratos sincronizados`);
  } else {
    console.log('[contratofin] sem alterações');
  }
}

module.exports = { sincronizar };
