'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').pagamentos;

// CPGBAIXA — baixas (pagamentos efetivos) de contas a pagar
// Espelho de CRCBAIXA para o lado CP. CTRL_PAG → PAGAR.
// SITU_CPB: N=Normal, E=Estornada.
async function sincronizar() {
  const ultimoSync = await lerUltimoSync('pagamentos');
  console.log(`[pagamentos] buscando alterações desde ${ultimoSync}`);

  const sql = `
    SELECT
      ${cfg.campoId}        AS SEQU_CPB,
      ${cfg.campoParcelaId} AS CTRL_PAG,
      ${cfg.campoFilial}    AS CODI_EMP,
      ${cfg.campoDtPag}     AS DPAG_CPB,
      ${cfg.campoValor}     AS VLOR_CPB,
      ${cfg.campoMulta}     AS MULT_CPB,
      ${cfg.campoJuros}     AS JURO_CPB,
      ${cfg.campoDesconto}  AS DESC_CPB,
      ${cfg.campoAcrescimo} AS ACRE_CPB,
      ${cfg.campoStatus}    AS SITU_CPB,
      ${cfg.campoDataAlter} AS DUMANUT
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${cfg.campoDataAlter} > :ultimoSync
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[pagamentos] sem alterações');
    return;
  }

  const registros = rows.map((row) => ({
    id:            String(row.SEQU_CPB),
    parcela_id:    String(row.CTRL_PAG ?? ''),
    filial_id:     String(row.CODI_EMP ?? ''),
    data_pagamento: row.DPAG_CPB || null,
    valor:         row.VLOR_CPB ?? 0,
    multa:         row.MULT_CPB ?? 0,
    juros:         row.JURO_CPB ?? 0,
    desconto:      row.DESC_CPB ?? 0,
    acrescimo:     row.ACRE_CPB ?? 0,
    status:        row.SITU_CPB ? String(row.SITU_CPB).trim() : null,
    data_alteracao: row.DUMANUT || new Date(),
    _dados:        JSON.stringify(row),
    _source:       'siagri',
  }));

  await upsertRaw('raw.pagamentos', registros);
  await atualizarSync('pagamentos');
  console.log(`[pagamentos] ${registros.length} baixas sincronizadas`);
}

module.exports = { sincronizar };
