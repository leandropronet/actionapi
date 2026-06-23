'use strict';
const oracle = require('../db/oracle');
const pg = require('../db/postgres');
const { upsertRaw, upsertRawBatch, atualizarSync, lerUltimoSync } = require('../upsert');
const { abrirJanela, concluirJanela } = require('../incremental');
const cfgCp  = require('../oracle-config').financeiro_cp;
const cfgCr  = require('../oracle-config').financeiro_cr;
const cfgFin = require('../oracle-config').contratofin;

// Sincroniza CP (CABPAGAR + PAGAR) ou CR (CABREC + RECEBER)
async function sincronizarTipo(cfg, dominio, tabela, { dataInicio, reconciliar = false } = {}) {
  const incremental = !dataInicio;
  const janela = incremental ? await abrirJanela(dominio) : null;
  const where = dataInicio
    ? `PAR.${cfg.campoParcelaVenc} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`
    : `(
        (
          CAB.${cfg.campoCabDataAlter} > :limiteInferior
          AND CAB.${cfg.campoCabDataAlter} <= :limiteSuperior
        )
        OR (
          PAR.${cfg.campoParcelaDataAlter} > :limiteInferior
          AND PAR.${cfg.campoParcelaDataAlter} <= :limiteSuperior
        )
      )`;
  const binds = dataInicio
    ? { dataInicio }
    : {
      limiteInferior: janela.limiteInferior,
      limiteSuperior: janela.limiteSuperior,
    };
  console.log(
    `[${dominio}] ${dataInicio
      ? `carga histórica desde ${dataInicio}`
      : `janela ${janela.limiteInferior.toISOString()} a ${janela.limiteSuperior.toISOString()}`}`,
  );

  const sql = `
    SELECT
      CAB.${cfg.campoCabId}      AS CAB_ID,
      CAB.${cfg.campoCabFilial}  AS CODI_EMP,
      CAB.${cfg.campoCabData}    AS DATA_DOC,
      CAB.${cfg.campoCabTotal}   AS TOTA_DOC,
      ${cfg.campoCabFornecedor ? `CAB.${cfg.campoCabFornecedor}` : 'NULL'} AS CODI_TRA,
      ${cfg.campoCabTipoDocumento ? `CAB.${cfg.campoCabTipoDocumento}` : 'NULL'} AS CODI_TDO,
      ${cfg.campoCabIndexador ? `CAB.${cfg.campoCabIndexador}` : 'NULL'} AS CODI_IND,
      ${cfg.campoCabDataIndexador ? `CAB.${cfg.campoCabDataIndexador}` : 'NULL'} AS DATA_VLR,
      PAR.${cfg.campoParcelaId}  AS PAR_ID,
      PAR.${cfg.campoParcelaNr}  AS NPAR,
      PAR.${cfg.campoParcelaVenc}  AS VENC,
      PAR.${cfg.campoParcelaValor} AS VLOR,
      PAR.${cfg.campoFlagAssina}   AS FLAG_ASSINA,
      ${cfg.campoHistorico ? `PAR.${cfg.campoHistorico}` : 'NULL'} AS HISTORICO,
      GREATEST(
        NVL(CAB.${cfg.campoCabDataAlter}, DATE '2000-01-01'),
        NVL(PAR.${cfg.campoParcelaDataAlter}, DATE '2000-01-01')
      ) AS DT_ALTER
    FROM ${cfg.schema}.${cfg.tabelaCab} CAB
    JOIN ${cfg.schema}.${cfg.tabelaParcela} PAR
      ON PAR.${cfg.campoParcelaCabId} = CAB.${cfg.campoCabId}
    WHERE ${where}
    ORDER BY DT_ALTER
  `;

  const result = await oracle.query(sql, binds);
  const rows = result.rows || [];

  if (!rows.length) {
    console.log(`[${dominio}] sem registros novos`);
    if (incremental) await concluirJanela(dominio, janela);
    return { registros: 0 };
  }

  const registros = rows.map((row) => {
    const registro = {
      id:              String(row.PAR_ID),
      filial_id:       String(row.CODI_EMP ?? ''),
      data_emissao:    row.DATA_DOC || null,
      data_vencimento: row.VENC || null,
      data_alteracao:  row.DT_ALTER || null,
      _dados:          JSON.stringify(row),
      _source:         'siagri',
    };
    if (tabela === 'raw.financeiro_cp') {
      registro.parceiro_id = row.CODI_TRA != null ? String(row.CODI_TRA) : null;
      registro.tipo_documento = row.CODI_TDO != null ? String(row.CODI_TDO) : null;
      registro.indexador_id = row.CODI_IND != null ? String(row.CODI_IND) : null;
      registro.data_indexador = row.DATA_VLR || null;
    }
    return registro;
  });

  await upsertRawBatch(tabela, registros);

  if (reconciliar && dataInicio) {
    const ids = registros.map((row) => row.id);
    const removidos = await pg.query(
      `DELETE FROM ${tabela}
       WHERE data_vencimento >= $1
         AND NOT (id = ANY($2::TEXT[]))`,
      [dataInicio, ids],
    );
    console.log(`[${dominio}] ${removidos.rowCount} registros obsoletos removidos`);
  }

  if (incremental) await concluirJanela(dominio, janela);
  console.log(`[${dominio}] ${registros.length} parcelas sincronizadas`);
  return { registros: registros.length };
}

async function sincronizarContasPagar(options) {
  return sincronizarTipo(cfgCp, 'financeiro_cp', 'raw.financeiro_cp', options);
}

async function sincronizarContasReceber(options) {
  return sincronizarTipo(cfgCr, 'financeiro_cr', 'raw.financeiro_cr', options);
}

async function sincronizar() {
  await sincronizarContasPagar();
  await sincronizarContasReceber();

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

module.exports = { sincronizar, sincronizarContasPagar, sincronizarContasReceber };
