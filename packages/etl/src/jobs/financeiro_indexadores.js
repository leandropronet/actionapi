'use strict';
/**
 * Replica as tabelas auxiliares usadas pelas funções oficiais de saldo:
 * VALOR_ABERTO_RECEBER_DATA e VALOR_ABERTO_PAGAR_DATA.
 *
 * O volume é pequeno e a carga é feita como snapshot completo. O Oracle é
 * acessado exclusivamente com SELECT.
 */
const oracle = require('../db/oracle');
const pg = require('../db/postgres');
const { upsertRawBatch, atualizarSync } = require('../upsert');
const schema = require('../oracle-config').duplicatas.schema;

function dataId(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function substituirTabela(tabela, rows) {
  await pg.query(`TRUNCATE TABLE ${tabela}`);
  if (rows.length) await upsertRawBatch(tabela, rows);
}

async function sincronizar() {
  console.log('[financeiro_indexadores] carregando indexadores e regras auxiliares...');

  const indexadoresRes = await oracle.query(`
      SELECT CODI_IND, DESC_IND, ABRE_IND, TIPO_IND, SITU_IND, DUMANUT
      FROM ${schema}.INDEXADOR
      ORDER BY CODI_IND
    `);
  const valoresRes = await oracle.query(`
      SELECT CODI_EMP, CODI_IND, DATA_VLR, VLOR_VLR, DUMANUT
      FROM ${schema}.INDVALOR
      ORDER BY CODI_EMP, CODI_IND, DATA_VLR
    `);
  const parametrosRes = await oracle.query(`
      SELECT CODI_EMP, DBBA_PRF, VLRD_PRF, DUMANUT
      FROM ${schema}.PARAMGERFINANC
      ORDER BY CODI_EMP
    `);
  const receberAgruRes = await oracle.query(`
      SELECT RAG.CTRL_RAG, RAG.CTRL_REC, RAG.CTRL_CBR, RAG.VLOR_RAG,
             C.DATA_CBR, RAG.DUMANUT
      FROM ${schema}.RECEBERAGRU RAG
      JOIN ${schema}.CABREC C ON C.CTRL_CBR = RAG.CTRL_CBR
    `);
  const pagarAgruRes = await oracle.query(`
      SELECT PA.CTRL_CPG, PA.CTRL_PAG, PA.VLOR_PAA, PA.DUMANUT,
             C.CODI_EMP, C.CODI_IND, C.DATA_VLR, C.DMOV_CPG
      FROM ${schema}.PAGARAGRU PA
      JOIN ${schema}.CABPAGAR C ON C.CTRL_CPG = PA.CTRL_CPG
    `);
  const exclusoesRes = await oracle.query(`
      SELECT 'RENEGOCIADA' AS MOTIVO, P.CTRL_PAG, R.DATA_RCP AS DATA_REFERENCIA
      FROM ${schema}.RCPPAGAR P
      JOIN ${schema}.RCPCABPAGAR C
        ON C.CTRL_RCP = P.CTRL_RCP AND C.CTRL_CPG = P.CTRL_CPG
      JOIN ${schema}.RENEGOCIARCPG R ON R.CTRL_RCP = C.CTRL_RCP
      WHERE P.TIPO_RCP = 'R' AND R.DATA_RCP <= TRUNC(SYSDATE)
      UNION ALL
      SELECT 'PREVIDENCIA_VINCULADA', V.CTPR_PAG, C.DMOV_CPG
      FROM ${schema}.PAGARVINCPREV V
      JOIN ${schema}.PAGAR P ON P.CTRL_PAG = V.CTRL_PAG
      JOIN ${schema}.CABPAGAR C ON C.CTRL_CPG = P.CTRL_CPG
      WHERE C.DMOV_CPG <= TRUNC(SYSDATE)
    `);

  const indexadores = (indexadoresRes.rows || []).map((row) => ({
    id: String(row.CODI_IND),
    descricao: row.DESC_IND ? String(row.DESC_IND).trim() : null,
    abreviatura: row.ABRE_IND ? String(row.ABRE_IND).trim() : null,
    tipo: row.TIPO_IND ? String(row.TIPO_IND).trim() : null,
    status: row.SITU_IND ? String(row.SITU_IND).trim() : null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  const valores = (valoresRes.rows || []).map((row) => ({
    id: `${row.CODI_EMP}_${row.CODI_IND}_${dataId(row.DATA_VLR)}`,
    filial_id: String(row.CODI_EMP),
    indexador_id: String(row.CODI_IND),
    data_valor: row.DATA_VLR,
    valor: row.VLOR_VLR,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  const parametros = (parametrosRes.rows || []).map((row) => ({
    id: String(row.CODI_EMP),
    data_base_baixa: row.DBBA_PRF || null,
    valor_diferenca: row.VLRD_PRF ?? null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  const receberAgrupamentos = (receberAgruRes.rows || []).map((row) => ({
    id: String(row.CTRL_RAG),
    parcela_id: String(row.CTRL_REC),
    titulo_agrupador_id: row.CTRL_CBR != null ? String(row.CTRL_CBR) : null,
    valor: row.VLOR_RAG ?? 0,
    data_titulo_agrupador: row.DATA_CBR || null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  const pagarAgrupamentos = (pagarAgruRes.rows || []).map((row) => ({
    id: `${row.CTRL_CPG}_${row.CTRL_PAG}`,
    parcela_id: String(row.CTRL_PAG),
    titulo_agrupador_id: row.CTRL_CPG != null ? String(row.CTRL_CPG) : null,
    valor: row.VLOR_PAA ?? 0,
    indexador_id: row.CODI_IND != null ? String(row.CODI_IND) : null,
    indexador_filial_id: row.CODI_EMP != null ? String(row.CODI_EMP) : null,
    data_indexador: row.DATA_VLR || null,
    data_titulo_agrupador: row.DMOV_CPG || null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  const exclusoes = (exclusoesRes.rows || []).map((row) => ({
    id: `${row.MOTIVO}_${row.CTRL_PAG}`,
    parcela_id: String(row.CTRL_PAG),
    motivo: row.MOTIVO,
    data_referencia: row.DATA_REFERENCIA || null,
    _source: 'siagri',
  }));

  await substituirTabela('raw.indexadores', indexadores);
  await substituirTabela('raw.indexador_valores', valores);
  await substituirTabela('raw.param_ger_financ', parametros);
  await substituirTabela('raw.receber_agrupamentos', receberAgrupamentos);
  await substituirTabela('raw.pagar_agrupamentos', pagarAgrupamentos);
  await substituirTabela('raw.pagar_saldo_exclusoes', exclusoes);
  await atualizarSync('financeiro_indexadores');

  console.log(
    `[financeiro_indexadores] ${indexadores.length} indexadores, `
    + `${valores.length} cotações, ${receberAgrupamentos.length} agrupamentos CR, `
    + `${pagarAgrupamentos.length} agrupamentos CP`,
  );
}

module.exports = { sincronizar };
