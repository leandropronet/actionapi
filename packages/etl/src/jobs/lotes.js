'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').lotes;

// LOTE — lotes de produtos com data de validade (VALG_LOT)
// JOIN com ILOTE para trazer quantidade por filial/depósito em uma única passagem.
// Um lote pode ter N registros em ILOTE (um por filial que o recebeu).
async function sincronizar() {
  const ultimoSync = await lerUltimoSync('lotes');
  console.log(`[lotes] buscando alterações desde ${ultimoSync}`);

  // LOTE mestre — sincroniza por DUMANUT do LOTE
  const sqlLote = `
    SELECT
      ${cfg.campoProduto}    AS CODI_PSV,
      ${cfg.campoLote}       AS LOTE_LOT,
      ${cfg.campoTipo}       AS TPRO_LOT,
      ${cfg.campoStatus}     AS SITU_LOT,
      ${cfg.campoValidade}   AS VALG_LOT,
      ${cfg.campoFabricacao} AS DTFA_LOT,
      ${cfg.campoFornecedor} AS CODI_TRA,
      ${cfg.campoDataAlter}  AS DUMANUT
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${cfg.campoDataAlter} > :ultimoSync
  `;

  const resLote = await oracle.query(sqlLote, { ultimoSync });
  const rowsLote = resLote.rows || [];

  if (rowsLote.length) {
    const registros = rowsLote.map((row) => ({
      // PK composta: produto + lote
      id:           `${row.CODI_PSV}_${row.LOTE_LOT}`,
      produto_id:   String(row.CODI_PSV ?? ''),
      lote:         String(row.LOTE_LOT ?? ''),
      tipo:         row.TPRO_LOT ? String(row.TPRO_LOT).trim() : null,
      status:       row.SITU_LOT ? String(row.SITU_LOT).trim() : null,
      data_validade: row.VALG_LOT || null,
      data_fabricacao: row.DTFA_LOT || null,
      fornecedor_id: row.CODI_TRA ? String(row.CODI_TRA) : null,
      data_alteracao: row.DUMANUT || new Date(),
      _dados:        JSON.stringify(row),
      _source:       'siagri',
    }));

    await upsertRaw('raw.lotes', registros);
    console.log(`[lotes] ${registros.length} lotes sincronizados`);
  } else {
    console.log('[lotes] sem alterações no mestre');
  }

  // ILOTE por filial/depósito — sincroniza independente (tem DUMANUT próprio)
  const sqlIlote = `
    SELECT
      ${cfg.campoIloteProd}  AS CODI_PSV,
      ${cfg.campoIloteLote}  AS LOTE_LOT,
      ${cfg.campoIloteEmp}   AS CODI_EMP,
      ${cfg.campoIloteQtd}   AS QINI_ILO,
      ${cfg.campoIloteDepo}  AS CODI_DPT,
      ${cfg.campoIloteDt}    AS DINI_ILO,
      ${cfg.campoIloteAlter} AS DUMANUT
    FROM ${cfg.schema}.${cfg.tabelaFilial}
    WHERE ${cfg.campoIloteAlter} > :ultimoSync
  `;

  const resIlote = await oracle.query(sqlIlote, { ultimoSync });
  const rowsIlote = resIlote.rows || [];

  if (rowsIlote.length) {
    const registros = rowsIlote.map((row) => ({
      id:           `${row.CODI_PSV}_${row.LOTE_LOT}_${row.CODI_EMP}`,
      produto_id:   String(row.CODI_PSV ?? ''),
      lote:         String(row.LOTE_LOT ?? ''),
      filial_id:    String(row.CODI_EMP ?? ''),
      deposito_id:  row.CODI_DPT ? String(row.CODI_DPT) : null,
      qtd_inicial:  row.QINI_ILO ?? 0,
      data_entrada: row.DINI_ILO || null,
      data_alteracao: row.DUMANUT || new Date(),
      _dados:        JSON.stringify(row),
      _source:       'siagri',
    }));

    await upsertRaw('raw.lotes_filial', registros);
    console.log(`[lotes] ${registros.length} posições por filial sincronizadas`);
  } else {
    console.log('[lotes] sem alterações por filial');
  }

  await atualizarSync('lotes');
}

module.exports = { sincronizar };
