'use strict';
const oracle = require('../db/oracle');
const { upsertRawBatch } = require('../upsert');
const { abrirJanela, concluirJanela } = require('../incremental');
const cfg = require('../oracle-config').pagamentos;

// CPGBAIXA — baixas (pagamentos efetivos) de contas a pagar
// Espelho de CRCBAIXA para o lado CP. CTRL_PAG → PAGAR.
// SITU_CPB: N=Normal, E=Estornada.
async function sincronizar({ dataInicio, dataFim } = {}) {
  const incremental = !dataInicio && !dataFim;
  const janela = incremental ? await abrirJanela('pagamentos') : null;
  const condicoes = [];
  const binds = {};
  if (dataInicio) {
    condicoes.push(`${cfg.campoDtPag} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`);
    binds.dataInicio = dataInicio;
  }
  if (dataFim) {
    condicoes.push(`${cfg.campoDtPag} < TO_DATE(:dataFim, 'YYYY-MM-DD')`);
    binds.dataFim = dataFim;
  }
  if (incremental) {
    condicoes.push(
      `${cfg.campoDataAlter} > :limiteInferior
       AND ${cfg.campoDataAlter} <= :limiteSuperior`,
    );
    binds.limiteInferior = janela.limiteInferior;
    binds.limiteSuperior = janela.limiteSuperior;
  }
  const where = condicoes.join(' AND ');
  console.log(
    `[pagamentos] ${incremental
      ? `janela ${janela.limiteInferior.toISOString()} a ${janela.limiteSuperior.toISOString()}`
      : `reconciliação de ${dataInicio || 'início'} a ${dataFim || 'hoje'}`}`,
  );

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
      ${cfg.campoIndexador} AS CODI_IND,
      ${cfg.campoDataIndexador} AS DATA_VLR,
      ${cfg.campoValorComplementar} AS VVCA_CPB,
      ${cfg.campoStatus}    AS SITU_CPB,
      ${cfg.campoDataAlter} AS DUMANUT
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${where}
    ORDER BY ${cfg.campoDataAlter}, ${cfg.campoId}
  `;

  const result = await oracle.query(sql, binds);
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[pagamentos] sem alterações');
    if (incremental) await concluirJanela('pagamentos', janela);
    return { registros: 0 };
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
    indexador_id:  row.CODI_IND != null ? String(row.CODI_IND) : null,
    data_indexador: row.DATA_VLR || null,
    valor_complementar: row.VVCA_CPB ?? 0,
    status:        row.SITU_CPB ? String(row.SITU_CPB).trim() : null,
    data_alteracao: row.DUMANUT || new Date(),
    _dados:        JSON.stringify(row),
    _source:       'siagri',
  }));

  await upsertRawBatch('raw.pagamentos', registros);
  if (incremental) await concluirJanela('pagamentos', janela);
  console.log(`[pagamentos] ${registros.length} baixas sincronizadas`);
  return { registros: registros.length };
}

module.exports = { sincronizar };
