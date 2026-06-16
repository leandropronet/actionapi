'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').recebimentos;

const cfgDup = require('../oracle-config').duplicatas;

// CRCBAIXA — baixas (recebimentos efetivos) de contas a receber
// JOIN com RECEBER + CABREC para trazer CODI_TDO (tipo do documento).
// Necessário para separar duplicatas (101) de adiantamentos (103) e devoluções (106).
// SITU_BAI: N=Normal, E=Estornada.
async function sincronizar() {
  const ultimoSync = await lerUltimoSync('recebimentos');
  console.log(`[recebimentos] buscando alterações desde ${ultimoSync}`);

  // DUMANUT está em CRCBAIXA — controla o incremental pela baixa, não pelo cabeçalho
  const sql = `
    SELECT
      B.${cfg.campoId}        AS SEQU_BAI,
      B.${cfg.campoParcelaId} AS CTRL_REC,
      B.${cfg.campoFilial}    AS CODI_EMP,
      B.${cfg.campoDtPag}     AS DPAG_BAI,
      B.${cfg.campoValor}     AS VLOR_BAI,
      B.${cfg.campoMulta}     AS MULT_BAI,
      B.${cfg.campoJuros}     AS JURO_BAI,
      B.${cfg.campoDesconto}  AS DESC_BAI,
      B.${cfg.campoAcrescimo} AS ACRE_BAI,
      B.${cfg.campoRecibo}    AS CODI_REC,
      B.${cfg.campoStatus}    AS SITU_BAI,
      B.${cfg.campoDataAlter} AS DUMANUT,
      C.${cfgDup.campoCabCliente} AS CODI_TRA,
      C.CODI_TDO              AS CODI_TDO
    FROM ${cfg.schema}.${cfg.tabela} B
    JOIN ${cfgDup.schema}.${cfgDup.tabelaParcela} R
      ON R.${cfgDup.campoParcelaId} = B.${cfg.campoParcelaId}
    JOIN ${cfgDup.schema}.${cfgDup.tabelaCab} C
      ON C.${cfgDup.campoCabId} = R.${cfgDup.campoParcelaCabId}
    WHERE B.${cfg.campoDataAlter} > :ultimoSync
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
    cliente_id:    row.CODI_TRA ? String(row.CODI_TRA) : null,
    tipo_doc:      row.CODI_TDO ? String(row.CODI_TDO) : null,
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
