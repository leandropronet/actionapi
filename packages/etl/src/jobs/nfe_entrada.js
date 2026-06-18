'use strict';
/**
 * jobs/nfe_entrada.js
 *
 * ETL incremental de NF-e de Entrada (NFENTRA + INFENTRA).
 *
 * Tabelas Oracle:
 *   NFENTRA  — cabeçalho da NF-e recebida (PK: CTRL_NFE)
 *   INFENTRA — itens da NF-e recebida (FK: CTRL_NFE; PK item: CTRL_NFE + ITEM_INF)
 *
 * Tabelas PostgreSQL:
 *   raw.nfe_entrada       — cabeçalho com filial, parceiro, datas, total
 *   raw.nfe_entrada_itens — itens com todos os campos tributários em _dados:
 *     TRIB_INF=CST, VICM_INF=ICMS, PIS_INF, COFI_INF=COFINS, TIPI_INF=IPI,
 *     VISS_INF=ISS, VRCS_INF=CSRF, CMED_INF=custo médio, DSAC_INF=desc/acrés.
 *
 * Uso:
 *   Devoluções de clientes: filtrar itens onde operacao_id está em
 *   raw.param_oper_detalhe (param_id='102', funcao='S').
 *
 * Incremental por DUMANUT (Data/Hora Última Manutenção).
 */
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').nfentra;
const cfgOp = require('../oracle-config').operacoes;

async function sincronizar() {
  const ultimoSync = await lerUltimoSync('nfe_entrada');
  console.log(`[nfe_entrada] sync incremental desde ${ultimoSync.toISOString()}`);

  // JOIN com TIPOOPER para trazer TRAN_TOP/TIPO_TOP do cabeçalho
  const sql = `
    SELECT
      N.${cfg.campoId}         AS CTRL_NFE,
      N.${cfg.campoFilial}     AS CODI_EMP,
      N.${cfg.campoParceiro}   AS CODI_TRA,
      N.${cfg.campoOperacao}   AS CODI_TOP,
      N.${cfg.campoModelo}     AS CODI_MDF,
      N.${cfg.campoNumero}     AS NUME_NFE,
      N.${cfg.campoSerie}      AS SERI_NFE,
      N.${cfg.campoDataEmissao} AS DEMI_NFE,
      N.${cfg.campoDataReceb}  AS DREC_NFE,
      N.${cfg.campoTotal}      AS TPRO_NFE,
      N.${cfg.campoChave}      AS CHAV_NFE,
      N.${cfg.campoVendedor}   AS COD1_PES,
      N.TOTA_NFE,
      N.FRET_NFE,
      N.FRE2_NFE,
      N.DSAC_NFE,
      N.BICM_NFE,
      N.VICM_NFE,
      N.TIPI_NFE,
      N.VRCS_NFE,
      N.VLIR_NFE,
      N.VISS_NFE,
      N.PROP_PRO,
      N.${cfg.campoDataAlter}  AS DUMANUT,
      T.${cfgOp.campoTran}     AS TRAN_TOP,
      T.${cfgOp.campoTipo}     AS TIPO_TOP,
      T.${cfgOp.campoDesc}     AS DESC_TOP,
      T.${cfgOp.campoTemplate} AS CODI_TPL
    FROM ${cfg.schema}.${cfg.tabela} N
    LEFT JOIN ${cfgOp.schema}.${cfgOp.tabela} T
      ON T.${cfgOp.campoId} = N.${cfg.campoOperacao}
    WHERE N.${cfg.campoDataAlter} > :ultimoSync
    ORDER BY N.${cfg.campoDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[nfe_entrada] sem registros novos');
    return;
  }

  const registros = rows.map((row) => ({
    id:               String(row.CTRL_NFE),
    filial_id:        String(row.CODI_EMP ?? ''),
    operacao_id:      row.CODI_TOP ? String(row.CODI_TOP) : null,
    data_emissao:     row.DEMI_NFE || null,
    data_recebimento: row.DREC_NFE || null,
    data_alteracao:   row.DUMANUT  || null,
    _dados:           JSON.stringify(row),
    _source:          'siagri',
  }));

  await upsertRaw('raw.nfe_entrada', registros);

  // Sincroniza itens das NF-e alteradas — Oracle limita IN a 1000
  const ids = rows.map((r) => r.CTRL_NFE).filter(Boolean);
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const placeholders = chunk.map((_, j) => `:id${j}`).join(', ');
    const bindIds = Object.fromEntries(chunk.map((id, j) => [`id${j}`, id]));

    // SELECT * para capturar todos os campos tributários em _dados
    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE ${cfg.campoItemNfeId} IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id:              `${row[cfg.campoItemNfeId]}_${row[cfg.campoItemSeq]}`,
      nfe_entrada_id:  String(row[cfg.campoItemNfeId]),
      produto_id:      row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
      operacao_id:     row[cfg.campoItemOperacao] ? String(row[cfg.campoItemOperacao]) : null,
      data_recebimento: row[cfg.campoItemDrec] || null,
      _dados:          JSON.stringify(row),
      _source:         'siagri',
    }));
    if (itens.length) await upsertRaw('raw.nfe_entrada_itens', itens);
  }

  await atualizarSync('nfe_entrada');
  console.log(`[nfe_entrada] ${registros.length} NF-e de entrada sincronizadas`);
}

module.exports = { sincronizar };
