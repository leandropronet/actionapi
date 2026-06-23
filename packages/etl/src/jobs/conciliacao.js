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

function mapContabilCabecalho(row) {
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
}

// Quando CABLANCTB não traz a filial (EDOC_CLC/CODI_EMP/CORI_EMP nulos — caso
// dos lançamentos de origem 'FC'), busca em LANCONTAB: lá o CODI_EMP está
// preenchido em 100% das partidas e é sempre único por SEQU_CLC (validado em
// 2026-06 contra os ~1.900 cabeçalhos órfãos existentes).
async function preencherFilialViaLancontab(rows) {
  const pendentes = rows.filter((r) => !r.filial_id);
  if (!pendentes.length) return;

  const LOTE = 1000;
  for (let i = 0; i < pendentes.length; i += LOTE) {
    const lote = pendentes.slice(i, i + LOTE);
    const binds = {};
    const placeholders = lote.map((row, idx) => {
      binds[`id${idx}`] = Number(row.id);
      return `:id${idx}`;
    });
    const res = await oracle.query(`
      SELECT SEQU_CLC, MIN(CODI_EMP) AS CODI_EMP
      FROM ${schema}.LANCONTAB
      WHERE SEQU_CLC IN (${placeholders.join(',')}) AND CODI_EMP IS NOT NULL
      GROUP BY SEQU_CLC
    `, binds);
    const filiais = new Map(res.rows.map((r) => [String(r.SEQU_CLC), String(r.CODI_EMP)]));
    for (const row of lote) {
      const filial = filiais.get(row.id);
      if (filial) row.filial_id = filial;
    }
  }
}

async function sincronizarContabilCabecalhos({ dataInicio } = {}) {
  const dominio = 'contabil_cabecalhos';
  const ultimoSync = await lerUltimoSync(dominio);
  const where = dataInicio
    ? `DATA_CLC >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`
    : 'DUMANUT > :ultimoSync';
  const binds = dataInicio ? { dataInicio } : { ultimoSync };
  const result = await oracle.query(`
    SELECT
      SEQU_CLC, CODI_EMP, CORI_EMP, DATA_CLC, VCON_CLC, ORIG_CLC,
      CTRL_CLC, CODI_TRA, SDOC_CLC, EDOC_CLC, TIPO_CLC,
      CTRL_PAG, CTRL_NFE, DUMANUT
    FROM ${schema}.CABLANCTB
    WHERE ${where}
    ORDER BY DUMANUT
  `, binds);

  const rows = (result.rows || []).map(mapContabilCabecalho);
  await preencherFilialViaLancontab(rows);

  await upsertRawBatch('raw.contabil_cabecalhos', rows);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${rows.length} cabeçalhos sincronizados`);
}

async function sincronizarTitulosCp({ dataInicio } = {}) {
  const dominio = 'financeiro_titulos_cp';
  const ultimoSync = await lerUltimoSync(dominio);
  const where = dataInicio
    ? `DMOV_CPG >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`
    : 'DUMANUT > :ultimoSync';
  const binds = dataInicio ? { dataInicio } : { ultimoSync };
  const result = await oracle.query(`
    SELECT
      CAB.CTRL_CPG, CAB.CODI_EMP, CAB.CODI_TDO, CAB.CODI_TRA, CAB.DOCU_CPG,
      CAB.DMOV_CPG, CAB.TOTA_CPG, CAB.TDRL_CPG, CAB.CTRL_LAN, CAB.DUMANUT,
      (SELECT MIN(NC.CTRL_NCP) FROM ${schema}.NOTACPG NC WHERE NC.CTRL_CPG = CAB.CTRL_CPG)
        AS NF_ENTRADA_ID
    FROM ${schema}.CABPAGAR CAB
    WHERE ${where}
    ORDER BY DUMANUT
  `, binds);

  const rows = (result.rows || []).map((row) => ({
    id: `CP_${row.CTRL_CPG}`,
    tipo: 'CP',
    titulo_id: String(row.CTRL_CPG),
    filial_id: row.CODI_EMP != null ? String(row.CODI_EMP) : null,
    parceiro_id: row.CODI_TRA != null ? String(row.CODI_TRA) : null,
    tipo_documento: row.CODI_TDO != null ? String(row.CODI_TDO) : null,
    numero_documento: row.DOCU_CPG ? String(row.DOCU_CPG).trim() : null,
    serie_documento: null,
    // Vínculo oficial com a NF de entrada — NOTACPG.CTRL_NCP é FK direta para
    // NFENTRA.CTRL_NFE (98,4% de integridade validada em 2026-06), bem mais
    // confiável que comparar DOCU_CPG com o número da NF (sujeito a erro de
    // digitação — confirmado com casos reais).
    nf_entrada_id: row.NF_ENTRADA_ID != null ? String(row.NF_ENTRADA_ID) : null,
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

async function sincronizarTitulosCr({ dataInicio } = {}) {
  const dominio = 'financeiro_titulos_cr';
  const ultimoSync = await lerUltimoSync(dominio);
  const where = dataInicio
    ? `DATA_CBR >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`
    : 'DUMANUT > :ultimoSync';
  const binds = dataInicio ? { dataInicio } : { ultimoSync };
  const result = await oracle.query(`
    SELECT
      CTRL_CBR, CODI_EMP, CODI_TDO, NUME_CBR, SERI_CBR, CODI_TRA,
      DATA_CBR, TOTA_CBR, SITU_CBR, CTRL_LAN, DUMANUT
    FROM ${schema}.CABREC
    WHERE ${where}
    ORDER BY DUMANUT
  `, binds);

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

/**
 * Sincroniza o vínculo oficial entre títulos a pagar, notas de entrada,
 * pedidos de compra e produtos.
 *
 * Cadeia Oracle (somente leitura):
 * CABPAGAR <- NOTACPG -> INFENTRA -> PEDCOM.
 *
 * A tabela CABPAGARPED existe no dicionário desta base, mas está vazia. O
 * vínculo efetivamente utilizado nos dados é NOTACPG.CTRL_NCP =
 * INFENTRA.CTRL_NFE, seguido de INFENTRA.EMPR_PEC + NUME_PEC.
 */
async function sincronizarVinculosPedidosCp({ dataInicio } = {}) {
  const dominio = 'financeiro_titulo_pedidos';
  const ultimoSync = await lerUltimoSync(dominio);
  const alteracao = `
    GREATEST(
      NVL(NC.DUMANUT, TIMESTAMP '1900-01-02 00:00:00'),
      NVL(I.DUMANUT, TIMESTAMP '1900-01-02 00:00:00')
    )
  `;
  const where = dataInicio
    ? `${alteracao} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`
    : `${alteracao} > :ultimoSync`;
  const binds = dataInicio ? { dataInicio } : { ultimoSync };

  const result = await oracle.query(`
    SELECT
      NC.CTRL_CPG,
      NC.CTRL_NCP,
      I.EMPR_PEC,
      I.NUME_PEC,
      I.CODI_PSV,
      PS.DESC_PSV,
      I.ITEM_INF,
      ${alteracao} AS DUMANUT
    FROM ${schema}.NOTACPG NC
    INNER JOIN ${schema}.INFENTRA I
      ON I.CTRL_NFE = NC.CTRL_NCP
    LEFT JOIN ${schema}.PRODSERV PS
      ON PS.CODI_PSV = I.CODI_PSV
    WHERE I.NUME_PEC IS NOT NULL
      AND ${where}
    ORDER BY DUMANUT, NC.CTRL_CPG, NC.CTRL_NCP, I.ITEM_INF
  `, binds);

  const rows = (result.rows || []).map((row) => ({
    id: `${row.CTRL_CPG}_${row.CTRL_NCP}_${row.ITEM_INF}`,
    titulo_id: String(row.CTRL_CPG),
    nf_entrada_id: String(row.CTRL_NCP),
    pedido_id: `${row.EMPR_PEC}_${row.NUME_PEC}`,
    filial_pedido_id: row.EMPR_PEC != null ? String(row.EMPR_PEC) : null,
    numero_pedido: row.NUME_PEC != null ? String(row.NUME_PEC) : null,
    produto_id: row.CODI_PSV != null ? String(row.CODI_PSV) : null,
    produto_descricao: row.DESC_PSV ? String(row.DESC_PSV).trim() : null,
    item_nf: row.ITEM_INF != null ? String(row.ITEM_INF) : null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  await upsertRawBatch('raw.financeiro_titulo_pedidos', rows);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${rows.length} itens vinculados sincronizados`);
}

/**
 * Sincroniza o cadastro TIPDOC para que a API exponha a descrição dos tipos
 * de documento sem manter códigos fixos no código-fonte.
 */
async function sincronizarTiposDocumento({ dataInicio } = {}) {
  const dominio = 'tipos_documento';
  const ultimoSync = await lerUltimoSync(dominio);
  const where = dataInicio
    ? `NVL(DUMANUT, TIMESTAMP '1900-01-02 00:00:00') >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`
    : `NVL(DUMANUT, TIMESTAMP '1900-01-02 00:00:00') > :ultimoSync`;
  const binds = dataInicio ? { dataInicio } : { ultimoSync };

  const result = await oracle.query(`
    SELECT CODI_TDO, DESC_TDO, TIPO_TDO, SITU_TDO, DUMANUT
    FROM ${schema}.TIPDOC
    WHERE ${where}
    ORDER BY DUMANUT, CODI_TDO
  `, binds);

  const rows = (result.rows || []).map((row) => ({
    id: String(row.CODI_TDO),
    descricao: row.DESC_TDO ? String(row.DESC_TDO).trim() : null,
    tipo: row.TIPO_TDO ? String(row.TIPO_TDO).trim() : null,
    status: row.SITU_TDO ? String(row.SITU_TDO).trim() : null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  await upsertRawBatch('raw.tipos_documento', rows);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${rows.length} tipos sincronizados`);
}

async function sincronizar() {
  await sincronizarContabilCabecalhos();
  await sincronizarTitulosCp();
  await sincronizarTitulosCr();
  await sincronizarVinculosPedidosCp();
  await sincronizarTiposDocumento();
}

module.exports = {
  sincronizar,
  sincronizarContabilCabecalhos,
  sincronizarTitulosCp,
  sincronizarTitulosCr,
  sincronizarVinculosPedidosCp,
  sincronizarTiposDocumento,
};
