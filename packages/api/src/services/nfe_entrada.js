'use strict';
/**
 * services/nfe_entrada.js
 *
 * NF-e de Entrada (raw.nfe_entrada + raw.nfe_entrada_itens).
 *
 * Fontes de dados:
 *   raw.nfe_entrada       — cabeçalhos (NFENTRA)
 *   raw.nfe_entrada_itens — itens com dados tributários completos (INFENTRA)
 *
 * Casos de uso:
 *   1. Devoluções de clientes → itens com operacao_id em param_oper_detalhe
 *      param_id='102' funcao='S' → subtrair do faturamento líquido
 *   2. Dashboard tributário → campos em _dados: TRIB_INF (CST), VICM_INF (ICMS),
 *      PIS_INF, COFI_INF (COFINS), TIPI_INF (IPI), VISS_INF (ISS),
 *      VRCS_INF (CSRF), CMED_INF (custo médio), DSAC_INF (desc/acrés)
 *
 * Cálculo do valor contábil por item usado no relatório SiAGRI:
 *   QUAN_INF * VLIQ_INF
 *
 * Funções exportadas:
 *   listar()       — lista paginada de NF-e de entrada
 *   buscarPorId()  — NF-e completa com itens e dados tributários
 *   listarItens()  — itens com filtros de produto/grupo/imposto
 *   resumo()       — totais por período incluindo breakdown tributário
 */
const db = require('../db/postgres');

const SELECT_NFE = `
  n.id,
  n.filial_id,
  n.data_emissao,
  n.data_recebimento,
  n.operacao_id,
  n._dados->>'CODI_TRA'  AS parceiro_id,
  n._dados->>'CODI_MDF'  AS modelo,
  n._dados->>'NUME_NFE'  AS numero_nfe,
  n._dados->>'SERI_NFE'  AS serie,
  n._dados->>'CHAV_NFE'  AS chave_nfe,
  n._dados->>'COD1_PES'  AS vendedor_id,
  n._dados->>'DESC_TOP'  AS operacao_desc,
  n._dados->>'TRAN_TOP'  AS tran_top,
  n._dados->>'TIPO_TOP'  AS tipo_top,
  (n._dados->>'TPRO_NFE')::NUMERIC AS valor_produtos,
  (n._dados->>'FRET_NFE')::NUMERIC AS frete,
  (n._dados->>'TIPI_NFE')::NUMERIC AS ipi,
  (n._dados->>'VICM_NFE')::NUMERIC AS icms,
  (n._dados->>'VISS_NFE')::NUMERIC AS iss,
  (n._dados->>'VRCS_NFE')::NUMERIC AS csrf,
  n._sync_at
`;

async function listar({
  dataInicio, dataFim, dataRecebDe, dataRecebAte,
  filialId, parceiroId, operacaoId, status,
  page = 1, pageSize = 100,
}) {
  const conds  = [];
  const params = [];

  if (dataInicio)   { params.push(dataInicio);   conds.push(`n.data_emissao >= $${params.length}`); }
  if (dataFim)      { params.push(dataFim);       conds.push(`n.data_emissao <= $${params.length}`); }
  if (dataRecebDe)  { params.push(dataRecebDe);  conds.push(`n.data_recebimento >= $${params.length}`); }
  if (dataRecebAte) { params.push(dataRecebAte); conds.push(`n.data_recebimento <= $${params.length}`); }
  if (filialId)     { params.push(filialId);     conds.push(`n.filial_id = $${params.length}`); }
  if (parceiroId)   { params.push(parceiroId);   conds.push(`n._dados->>'CODI_TRA' = $${params.length}`); }
  if (operacaoId)   { params.push(operacaoId);   conds.push(`n.operacao_id = $${params.length}`); }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT ${SELECT_NFE}
       FROM raw.nfe_entrada n
       ${where}
       ORDER BY n.data_emissao DESC, n.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.nfe_entrada n ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function buscarPorId(id) {
  const [nfeRes, itensRes] = await Promise.all([
    db.query(`SELECT ${SELECT_NFE} FROM raw.nfe_entrada n WHERE n.id = $1`, [id]),
    db.query(
      `SELECT
         i.id,
         i.nfe_entrada_id,
         i.produto_id,
         i.operacao_id,
         i.data_recebimento,
         i._dados->>'ITEM_INF'            AS seq,
         (i._dados->>'QUAN_INF')::NUMERIC  AS quantidade,
         (i._dados->>'VLOR_INF')::NUMERIC  AS valor_unitario,
         (i._dados->>'VLIQ_INF')::NUMERIC  AS valor_unitario_liq,
         (i._dados->>'DSAC_INF')::NUMERIC  AS desconto_unitario,
         (i._dados->>'CMED_INF')::NUMERIC  AS custo_medio,
         ROUND(
           COALESCE((i._dados->>'QUAN_INF')::NUMERIC, 0)
           * COALESCE((i._dados->>'VLIQ_INF')::NUMERIC, 0),
           4
         )                                 AS vlcontabil,
         i._dados->>'TRIB_INF'             AS cst_icms,
         (i._dados->>'BICM_INF')::NUMERIC  AS base_icms,
         (i._dados->>'VICM_INF')::NUMERIC  AS icms,
         (i._dados->>'VDIC_INF')::NUMERIC  AS icms_disp,
         (i._dados->>'BPIS_INF')::NUMERIC  AS base_pis,
         (i._dados->>'APIS_INF')::NUMERIC  AS aliq_pis,
         (i._dados->>'PIS_INF')::NUMERIC   AS pis,
         i._dados->>'CSTP_INF'             AS cst_pis,
         (i._dados->>'BCOF_INF')::NUMERIC  AS base_cofins,
         (i._dados->>'ACOF_INF')::NUMERIC  AS aliq_cofins,
         (i._dados->>'COFI_INF')::NUMERIC  AS cofins,
         i._dados->>'CSTC_INF'             AS cst_cofins,
         (i._dados->>'TIPI_INF')::NUMERIC  AS ipi,
         i._dados->>'CSTI_INF'             AS cst_ipi,
         (i._dados->>'BISS_INF')::NUMERIC  AS base_iss,
         (i._dados->>'AISS_INF')::NUMERIC  AS aliq_iss,
         (i._dados->>'VISS_INF')::NUMERIC  AS iss,
         (i._dados->>'VRCS_INF')::NUMERIC  AS csrf,
         (i._dados->>'VLIR_INF')::NUMERIC  AS irrf_retido,
         (i._dados->>'VLIN_INF')::NUMERIC  AS inss_retido,
         i._dados->>'CCFO_CFO'             AS cfop,
         p.descricao                        AS produto_desc,
         p._dados->>'UNID_PSV'              AS unidade,
         p._dados->>'CODI_GPR'              AS grupo_id,
         g.descricao                        AS grupo_desc
       FROM raw.nfe_entrada_itens i
       LEFT JOIN raw.produtos p ON p.id = i.produto_id
       LEFT JOIN raw.grupos g   ON g.id = p._dados->>'CODI_GPR'
       WHERE i.nfe_entrada_id = $1
       ORDER BY (i._dados->>'ITEM_INF')::INT NULLS LAST`,
      [id],
    ),
  ]);

  if (!nfeRes.rows.length) return null;
  return { ...nfeRes.rows[0], itens: itensRes.rows };
}

async function listarItens({
  dataInicio, dataFim, dataRecebDe, dataRecebAte,
  filialId, parceiroId, operacaoId, grupoId, produtoId, paramId, funcao,
  page = 1, pageSize = 200,
}) {
  const conds  = [];
  const params = [];

  if (dataInicio)   { params.push(dataInicio);   conds.push(`n.data_emissao >= $${params.length}`); }
  if (dataFim)      { params.push(dataFim);       conds.push(`n.data_emissao <= $${params.length}`); }
  if (dataRecebDe)  { params.push(dataRecebDe);  conds.push(`n.data_recebimento >= $${params.length}`); }
  if (dataRecebAte) { params.push(dataRecebAte); conds.push(`n.data_recebimento <= $${params.length}`); }
  if (filialId)     { params.push(filialId);     conds.push(`n.filial_id = $${params.length}`); }
  if (parceiroId)   { params.push(parceiroId);   conds.push(`n._dados->>'CODI_TRA' = $${params.length}`); }
  if (operacaoId)   { params.push(operacaoId);   conds.push(`i.operacao_id = $${params.length}`); }
  if (grupoId)      { params.push(grupoId);      conds.push(`p._dados->>'CODI_GPR' = $${params.length}`); }
  if (produtoId)    { params.push(produtoId);    conds.push(`i.produto_id = $${params.length}`); }

  // Filtro por param/funcao (ex: paramId=102, funcao=S → devoluções de vendas)
  if (paramId) {
    params.push(paramId);
    const pIdx = params.length;
    if (funcao) {
      params.push(funcao);
      conds.push(`EXISTS (
        SELECT 1 FROM raw.param_oper_detalhe pod2
        WHERE pod2.operacao_id = i.operacao_id
          AND pod2.param_id = $${pIdx}
          AND pod2.funcao = $${params.length}
      )`);
    } else {
      conds.push(`EXISTS (
        SELECT 1 FROM raw.param_oper_detalhe pod2
        WHERE pod2.operacao_id = i.operacao_id AND pod2.param_id = $${pIdx}
      )`);
    }
  }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         i.id, i.nfe_entrada_id, i.produto_id, i.operacao_id, i.data_recebimento,
         n.filial_id, n.data_emissao, n._dados->>'CODI_TRA' AS parceiro_id,
         n._dados->>'CHAV_NFE' AS chave_nfe,
         i._dados->>'ITEM_INF'            AS seq,
         i._dados->>'CCFO_CFO'            AS cfop,
         (i._dados->>'QUAN_INF')::NUMERIC  AS quantidade,
         (i._dados->>'VLOR_INF')::NUMERIC  AS valor_unitario,
         (i._dados->>'DSAC_INF')::NUMERIC  AS desconto_unitario,
         (i._dados->>'CMED_INF')::NUMERIC  AS custo_medio,
         ROUND(
           COALESCE((i._dados->>'QUAN_INF')::NUMERIC, 0)
           * COALESCE((i._dados->>'VLIQ_INF')::NUMERIC, 0),
           4
         )                                 AS vlcontabil,
         i._dados->>'TRIB_INF'             AS cst_icms,
         (i._dados->>'VICM_INF')::NUMERIC  AS icms,
         (i._dados->>'PIS_INF')::NUMERIC   AS pis,
         (i._dados->>'COFI_INF')::NUMERIC  AS cofins,
         (i._dados->>'TIPI_INF')::NUMERIC  AS ipi,
         (i._dados->>'VISS_INF')::NUMERIC  AS iss,
         (i._dados->>'VRCS_INF')::NUMERIC  AS csrf,
         p.descricao AS produto_desc,
         p._dados->>'UNID_PSV' AS unidade,
         p._dados->>'CODI_GPR' AS grupo_id,
         g.descricao AS grupo_desc,
         pod.funcao AS funcao_param
       FROM raw.nfe_entrada_itens i
       JOIN raw.nfe_entrada n ON n.id = i.nfe_entrada_id
       LEFT JOIN raw.produtos p ON p.id = i.produto_id
       LEFT JOIN raw.grupos g   ON g.id = p._dados->>'CODI_GPR'
       LEFT JOIN raw.param_oper_detalhe pod ON pod.operacao_id = i.operacao_id AND pod.param_id = '102'
       ${where}
       ORDER BY n.data_emissao DESC, i.nfe_entrada_id, (i._dados->>'ITEM_INF')::INT NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::INT AS total
       FROM raw.nfe_entrada_itens i
       JOIN raw.nfe_entrada n ON n.id = i.nfe_entrada_id
       LEFT JOIN raw.produtos p ON p.id = i.produto_id
       ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function resumo({ agrupamento = 'mes', filialId, dataInicio, dataFim, dataRecebDe, dataRecebAte, paramId }) {
  const conds  = [];
  const params = [];

  if (filialId)     { params.push(filialId);     conds.push(`filial_id = $${params.length}`); }
  if (dataInicio)   { params.push(dataInicio);   conds.push(`data_emissao >= $${params.length}`); }
  if (dataFim)      { params.push(dataFim);       conds.push(`data_emissao <= $${params.length}`); }
  if (dataRecebDe)  { params.push(dataRecebDe);  conds.push(`data_recebimento >= $${params.length}`); }
  if (dataRecebAte) { params.push(dataRecebAte); conds.push(`data_recebimento <= $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const dateCol = (dataRecebDe || dataRecebAte) ? 'data_recebimento' : 'data_emissao';
  const trunc = agrupamento === 'dia'       ? `DATE_TRUNC('day',     ${dateCol})`
              : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', ${dateCol})`
              : agrupamento === 'ano'       ? `DATE_TRUNC('year',    ${dateCol})`
              :                              `DATE_TRUNC('month',    ${dateCol})`;

  const res = await db.query(
    `SELECT
       ${trunc}                                          AS periodo,
       filial_id,
       COUNT(*)::INT                                    AS quantidade_nfe,
       SUM((_dados->>'TPRO_NFE')::NUMERIC)              AS valor_produtos,
       SUM((_dados->>'FRET_NFE')::NUMERIC)              AS frete,
       SUM((_dados->>'TIPI_NFE')::NUMERIC)              AS ipi,
       SUM((_dados->>'VICM_NFE')::NUMERIC)              AS icms,
       SUM((_dados->>'VISS_NFE')::NUMERIC)              AS iss,
       SUM((_dados->>'VRCS_NFE')::NUMERIC)              AS csrf
     FROM raw.nfe_entrada
     ${where}
     GROUP BY periodo, filial_id
     ORDER BY periodo DESC, filial_id`,
    params,
  );

  return { data: res.rows };
}

// Devoluções de clientes: itens em param=102 funcao='S' para cálculo do faturamento líquido
async function resumoDevolucoesParam({ paramId = '102', dataInicio, dataFim, filialId }) {
  const conds  = [`pod.param_id = $1`, `pod.funcao = 'S'`];
  const params = [paramId];

  if (dataInicio) { params.push(dataInicio); conds.push(`n.data_emissao >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conds.push(`n.data_emissao <= $${params.length}`); }
  if (filialId)   { params.push(filialId);   conds.push(`n.filial_id = $${params.length}`); }

  const where = `WHERE ${conds.join(' AND ')}`;

  const res = await db.query(
    `SELECT
       n.filial_id,
       pod.operacao_id,
       MAX(o.descricao)                  AS operacao_desc,
       COUNT(DISTINCT n.id)::INT         AS qtd_nfe,
       COUNT(i.id)::INT                  AS qtd_itens,
       SUM(
         COALESCE((i._dados->>'QUAN_INF')::NUMERIC, 0)
         * COALESCE((i._dados->>'VLIQ_INF')::NUMERIC, 0)
       )                                 AS vlcontabil
     FROM raw.nfe_entrada_itens i
     JOIN raw.nfe_entrada n ON n.id = i.nfe_entrada_id
     JOIN raw.param_oper_detalhe pod ON pod.operacao_id = i.operacao_id
     LEFT JOIN raw.operacoes o ON o.id = pod.operacao_id
     ${where}
     GROUP BY n.filial_id, pod.operacao_id
     ORDER BY vlcontabil DESC NULLS LAST`,
    params,
  );

  const totalVlcontabil = res.rows.reduce((s, r) => s + Number(r.vlcontabil || 0), 0);
  return { data: res.rows, total_vlcontabil: totalVlcontabil };
}

module.exports = { listar, buscarPorId, listarItens, resumo, resumoDevolucoesParam };
