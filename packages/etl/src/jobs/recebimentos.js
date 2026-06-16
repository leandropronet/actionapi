'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').recebimentos;

// CRCBAIXA — baixas (recebimentos efetivos) de contas a receber
// Cada linha representa um pagamento real de uma parcela (CTRL_REC → RECEBER).
// SITU_BAI: N=Normal, E=Estornada.
// Inclui adiantamentos e devoluções — filtrar por TIPO na camada de apresentação.
async function sincronizar() {
  const ultimoSync = await lerUltimoSync('recebimentos');
  console.log(`[recebimentos] buscando alterações desde ${ultimoSync}`);

  const sql = `
    SELECT
      ${cfg.campoId}        AS SEQU_BAI,
      ${cfg.campoParcelaId} AS CTRL_REC,
      ${cfg.campoFilial}    AS CODI_EMP,
      ${cfg.campoDtPag}     AS DPAG_BAI,
      ${cfg.campoValor}     AS VLOR_BAI,
      ${cfg.campoMulta}     AS MULT_BAI,
      ${cfg.campoJuros}     AS JURO_BAI,
      ${cfg.campoDesconto}  AS DESC_BAI,
      ${cfg.campoAcrescimo} AS ACRE_BAI,
      ${cfg.campoRecibo}    AS CODI_REC,
      ${cfg.campoStatus}    AS SITU_BAI,
      ${cfg.campoDataAlter} AS DUMANUT
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${cfg.campoDataAlter} > :ultimoSync
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[recebimentos] sem alterações');
    return;
  }

  const registros = rows.map((row) => ({
    id:            String(row.SEQU_BAI),
    parcela_id:    String(row.CTRL_REC ?? ''),
    filial_id:     String(row.CODI_EMP ?? ''),
    data_pagamento: row.DPAG_BAI || null,
    valor:         row.VLOR_BAI ?? 0,
    multa:         row.MULT_BAI ?? 0,
    juros:         row.JURO_BAI ?? 0,
    desconto:      row.DESC_BAI ?? 0,
    acrescimo:     row.ACRE_BAI ?? 0,
    recibo_id:     row.CODI_REC ? String(row.CODI_REC) : null,
    status:        row.SITU_BAI ? String(row.SITU_BAI).trim() : null,
    data_alteracao: row.DUMANUT || new Date(),
    _dados:        JSON.stringify(row),
    _source:       'siagri',
  }));

  await upsertRaw('raw.recebimentos', registros);
  await atualizarSync('recebimentos');
  console.log(`[recebimentos] ${registros.length} baixas sincronizadas`);
}

module.exports = { sincronizar };
