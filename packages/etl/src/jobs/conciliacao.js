'use strict';
/**
 * Cabeçalhos para conciliação e datasets de BI.
 *
 * Mantém uma linha por lançamento contábil e uma linha por título financeiro,
 * preservando as chaves de origem usadas para conciliar CP/CR com CABLANCTB.
 * O Oracle é acessado exclusivamente com SELECT.
 */
const oracle = require('../db/oracle');
const { upsertRawBatch, atualizarSync, lerUltimoSync } = require('../upsert');
const schema = require('../oracle-config').contabil.schema;

async function sincronizarContabilCabecalhos() {
  const dominio = 'contabil_cabecalhos';
  const ultimoSync = await lerUltimoSync(dominio);
  const result = await oracle.query(`
    SELECT
      SEQU_CLC, CODI_EMP, CORI_EMP, DATA_CLC, VCON_CLC, ORIG_CLC,
      CTRL_CLC, CODI_TRA, SDOC_CLC, EDOC_CLC, TIPO_CLC,
      CTRL_PAG, CTRL_NFE, DUMANUT
    FROM ${schema}.CABLANCTB
    WHERE DUMANUT > :ultimoSync
    ORDER BY DUMANUT
  `, { ultimoSync });

  const rows = (result.rows || []).map((row) => {
    const data = row.DATA_CLC;
    const filial = row.EDOC_CLC ?? row.CODI_EMP ?? row.CORI_EMP;
    const competencia = data instanceof Date
      ? `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
      : null;
    return {
      id: String(row.SEQU_CLC),
      filial_id: filial != null ? String(filial) : null,
      data_lancamento: data || null,
      competencia,
      origem: row.ORIG_CLC ? String(row.ORIG_CLC).trim() : null,
      documento: row.CTRL_CLC != null ? String(row.CTRL_CLC) : null,
      parceiro_id: row.CODI_TRA != null ? String(row.CODI_TRA) : null,
      serie_documento: row.SDOC_CLC ? String(row.SDOC_CLC).trim() : null,
      empresa_documento: row.EDOC_CLC != null ? String(row.EDOC_CLC) : null,
      valor: row.VCON_CLC ?? null,
      tipo: row.TIPO_CLC ? String(row.TIPO_CLC).trim() : null,
      data_alteracao: row.DUMANUT || null,
      _dados: JSON.stringify(row),
      _source: 'siagri',
    };
  });

  await upsertRawBatch('raw.contabil_cabecalhos', rows);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${rows.length} cabeçalhos sincronizados`);
}

async function sincronizarTitulosCp() {
  const dominio = 'financeiro_titulos_cp';
  const ultimoSync = await lerUltimoSync(dominio);
  const result = await oracle.query(`
    SELECT
      CTRL_CPG, CODI_EMP, CODI_TDO, CODI_TRA, DOCU_CPG,
      DMOV_CPG, TOTA_CPG, TDRL_CPG, CTRL_LAN, DUMANUT
    FROM ${schema}.CABPAGAR
    WHERE DUMANUT > :ultimoSync
    ORDER BY DUMANUT
  `, { ultimoSync });

  const rows = (result.rows || []).map((row) => ({
    id: `CP_${row.CTRL_CPG}`,
    tipo: 'CP',
    titulo_id: String(row.CTRL_CPG),
    filial_id: row.CODI_EMP != null ? String(row.CODI_EMP) : null,
    parceiro_id: row.CODI_TRA != null ? String(row.CODI_TRA) : null,
    tipo_documento: row.CODI_TDO != null ? String(row.CODI_TDO) : null,
    numero_documento: row.DOCU_CPG ? String(row.DOCU_CPG).trim() : null,
    serie_documento: null,
    data_emissao: row.DMOV_CPG || null,
    valor_total: row.TOTA_CPG ?? null,
    status: row.TDRL_CPG ? String(row.TDRL_CPG).trim() : null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  await upsertRawBatch('raw.financeiro_titulos', rows);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${rows.length} títulos sincronizados`);
}

async function sincronizarTitulosCr() {
  const dominio = 'financeiro_titulos_cr';
  const ultimoSync = await lerUltimoSync(dominio);
  const result = await oracle.query(`
    SELECT
      CTRL_CBR, CODI_EMP, CODI_TDO, NUME_CBR, SERI_CBR, CODI_TRA,
      DATA_CBR, TOTA_CBR, SITU_CBR, CTRL_LAN, DUMANUT
    FROM ${schema}.CABREC
    WHERE DUMANUT > :ultimoSync
    ORDER BY DUMANUT
  `, { ultimoSync });

  const rows = (result.rows || []).map((row) => ({
    id: `CR_${row.CTRL_CBR}`,
    tipo: 'CR',
    titulo_id: String(row.CTRL_CBR),
    filial_id: row.CODI_EMP != null ? String(row.CODI_EMP) : null,
    parceiro_id: row.CODI_TRA != null ? String(row.CODI_TRA) : null,
    tipo_documento: row.CODI_TDO != null ? String(row.CODI_TDO) : null,
    numero_documento: row.NUME_CBR != null ? String(row.NUME_CBR) : null,
    serie_documento: row.SERI_CBR ? String(row.SERI_CBR).trim() : null,
    data_emissao: row.DATA_CBR || null,
    valor_total: row.TOTA_CBR ?? null,
    status: row.SITU_CBR ? String(row.SITU_CBR).trim() : null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  await upsertRawBatch('raw.financeiro_titulos', rows);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${rows.length} títulos sincronizados`);
}

async function sincronizar() {
  await sincronizarContabilCabecalhos();
  await sincronizarTitulosCp();
  await sincronizarTitulosCr();
}

module.exports = { sincronizar };
