'use strict';
/**
 * services/faturamento.js
 *
 * Lógica de negócio para Notas Fiscais (NF-e).
 *
 * Fonte de dados: raw.faturamento (cabeçalho) + raw.faturamento_itens (itens)
 *
 * Filtros de produto (grupo/subgrupo/PA) usam buildProdutoExists():
 *   gera um EXISTS (SELECT 1 FROM raw.faturamento_itens fi2 JOIN raw.produtos p2 ...)
 *   para filtrar a lista de NFs sem expor os itens no payload da lista.
 *
 * Filtro de data: dois conjuntos disponíveis.
 *   dataInicio/dataFim  → filtram por DEMI_NOT (data de emissão)
 *   dataSaidaDe/dataSaidaAte → filtram por DSAI_NOT (data de saída)
 *   O consolidado do relatório "Saídas Faturadas Analítico" usa data de EMISSÃO
 *   e combina NOTA com devoluções registradas em NFENTRA.
 *   NFs com DSAI_NOT nulo são automaticamente excluídas do filtro de saída.
 *
 * Funções exportadas:
 *   listar()      — lista paginada de NFs com filtros
 *   buscarPorId() — NF completa com itens, grupos e princípios ativos
 *   listarItens() — itens de NF com filtros, útil para relatórios por produto
 *   resumo()      — totais por período (dia/mês/trimestre/ano)
 */
const db = require('../db/postgres');

const SELECT_NF = `
  f.id,
  f.filial_id,
  f.data_emissao,
  f.tran_top,
  f.tipo_top,
  f.operacao_id,
  f._dados->>'NOTA_NOT'           AS numero_nf,
  f._dados->>'SERI_NOT'           AS serie,
  f._dados->>'CODI_TRA'           AS cliente_id,
  f._dados->>'COD1_PES'           AS vendedor_id,
  f._dados->>'DSAI_NOT'           AS data_saida,
  f._dados->>'SITU_NOT'           AS status,
  f._dados->>'DESC_TOP'           AS operacao_desc,
  f._dados->>'CODI_TPL'           AS template_id,
  (f._dados->>'TOTA_NOT')::NUMERIC AS valor_total,
  f._sync_at
`;

// Subquery reutilizável para filtrar NFs que contêm itens de determinado produto/grupo
function buildProdutoExists(conds, params, { grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId }) {
  if (!grupoId && !subgrupoId && !produtoId && !principioAtivoId && !principioAtivoRecId) return;

  const innerConds = ['fi2.nf_id = f.id'];
  if (produtoId) { params.push(produtoId); innerConds.push(`fi2.produto_id = $${params.length}`); }

  const needProdJoin = grupoId || subgrupoId || principioAtivoId;
  if (needProdJoin) {
    innerConds.push('p2.id = fi2.produto_id');
    if (grupoId)          { params.push(grupoId);          innerConds.push(`p2._dados->>'CODI_GPR' = $${params.length}`); }
    if (subgrupoId)       { params.push(subgrupoId);       innerConds.push(`p2._dados->>'CODI_SBG' = $${params.length}`); }
    if (principioAtivoId) { params.push(principioAtivoId); innerConds.push(`p2._dados->>'CODI_PRI' = $${params.length}`); }
  }

  if (principioAtivoRecId) {
    params.push(principioAtivoRecId);
    innerConds.push(`EXISTS (
      SELECT 1 FROM raw.produto_principio_ativo_rec ppar
      WHERE ppar.produto_id = fi2.produto_id AND ppar.principio_id = $${params.length}
    )`);
  }

  const baseJoin = needProdJoin
    ? 'raw.faturamento_itens fi2 JOIN raw.produtos p2 ON p2.id = fi2.produto_id'
    : 'raw.faturamento_itens fi2';

  conds.push(`EXISTS (SELECT 1 FROM ${baseJoin} WHERE ${innerConds.join(' AND ')})`);
}

async function listar({
  dataInicio, dataFim, dataSaidaDe, dataSaidaAte,
  filialId, clienteId, vendedorId,
  status, tranTop, operacaoId, grupoId, subgrupoId, produtoId, principioAtivoId,
  page = 1, pageSize = 100,
}) {
  const conds = [];
  const params = [];

  if (dataInicio)   { params.push(dataInicio);   conds.push(`f.data_emissao >= $${params.length}`); }
  if (dataFim)      { params.push(dataFim);      conds.push(`f.data_emissao <= $${params.length}`); }
  if (dataSaidaDe)  { params.push(dataSaidaDe);  conds.push(`(f._dados->>'DSAI_NOT')::DATE >= $${params.length}`); }
  if (dataSaidaAte) { params.push(dataSaidaAte); conds.push(`(f._dados->>'DSAI_NOT')::DATE <= $${params.length}`); }
  if (filialId)    { params.push(filialId);    conds.push(`f.filial_id = $${params.length}`); }
  if (tranTop)     { params.push(tranTop);     conds.push(`f.tran_top = $${params.length}`); }
  if (operacaoId)  { params.push(operacaoId);  conds.push(`f.operacao_id = $${params.length}`); }
  if (clienteId)   { params.push(clienteId);   conds.push(`f._dados->>'CODI_TRA' = $${params.length}`); }
  if (vendedorId)  { params.push(vendedorId);  conds.push(`f._dados->>'COD1_PES' = $${params.length}`); }
  if (status)      { params.push(status);      conds.push(`f._dados->>'SITU_NOT' = $${params.length}`); }

  buildProdutoExists(conds, params, { grupoId, subgrupoId, produtoId, principioAtivoId });

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT ${SELECT_NF}
       FROM raw.faturamento f
       ${where}
       ORDER BY f.data_emissao DESC, f.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.faturamento f ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function buscarPorId(id) {
  const [nfRes, itensRes] = await Promise.all([
    db.query(`SELECT ${SELECT_NF} FROM raw.faturamento f WHERE f.id = $1`, [id]),
    db.query(
      `SELECT
         fi.id,
         fi.nf_id,
         fi.produto_id,
         fi._dados->>'ITEM_INO'            AS seq,
         (fi._dados->>'QTDE_INO')::NUMERIC AS quantidade,
         (fi._dados->>'VLOR_INO')::NUMERIC AS valor_unitario,
         p.descricao                        AS produto_desc,
         p._dados->>'UNID_PSV'              AS unidade,
         p._dados->>'CODI_GPR'              AS grupo_id,
         g.descricao                        AS grupo_desc,
         p._dados->>'CODI_SBG'              AS subgrupo_id,
         p._dados->>'CODI_PRI'              AS principio_ativo_id,
         pa.descricao                       AS principio_ativo_desc,
         par.principio_id                   AS principio_ativo_rec_id,
         par2.descricao                     AS principio_ativo_rec_desc
       FROM raw.faturamento_itens fi
       LEFT JOIN raw.produtos                   p    ON p.id    = fi.produto_id
       LEFT JOIN raw.grupos                     g    ON g.id    = p._dados->>'CODI_GPR'
       LEFT JOIN raw.principios_ativos          pa   ON pa.id   = p._dados->>'CODI_PRI'
       LEFT JOIN raw.produto_principio_ativo_rec par  ON par.produto_id = fi.produto_id
       LEFT JOIN raw.principios_ativos_rec      par2 ON par2.id = par.principio_id
       WHERE fi.nf_id = $1
       ORDER BY (fi._dados->>'ITEM_INO')::INT NULLS LAST`,
      [id],
    ),
  ]);

  if (!nfRes.rows.length) return null;
  return { ...nfRes.rows[0], itens: itensRes.rows };
}

async function listarItens({
  dataInicio, dataFim, dataSaidaDe, dataSaidaAte,
  filialId, clienteId, vendedorId, tranTop,
  grupoId, subgrupoId, produtoId, principioAtivoId,
  page = 1, pageSize = 200,
}) {
  const conds = [];
  const params = [];

  if (dataInicio)   { params.push(dataInicio);   conds.push(`f.data_emissao >= $${params.length}`); }
  if (dataFim)      { params.push(dataFim);      conds.push(`f.data_emissao <= $${params.length}`); }
  if (dataSaidaDe)  { params.push(dataSaidaDe);  conds.push(`(f._dados->>'DSAI_NOT')::DATE >= $${params.length}`); }
  if (dataSaidaAte) { params.push(dataSaidaAte); conds.push(`(f._dados->>'DSAI_NOT')::DATE <= $${params.length}`); }
  if (filialId)    { params.push(filialId);    conds.push(`f.filial_id = $${params.length}`); }
  if (tranTop)     { params.push(tranTop);     conds.push(`f.tran_top = $${params.length}`); }
  if (clienteId)   { params.push(clienteId);   conds.push(`f._dados->>'CODI_TRA' = $${params.length}`); }
  if (vendedorId)  { params.push(vendedorId);  conds.push(`f._dados->>'COD1_PES' = $${params.length}`); }
  if (grupoId)          { params.push(grupoId);          conds.push(`p._dados->>'CODI_GPR' = $${params.length}`); }
  if (subgrupoId)       { params.push(subgrupoId);       conds.push(`p._dados->>'CODI_SBG' = $${params.length}`); }
  if (produtoId)        { params.push(produtoId);        conds.push(`fi.produto_id = $${params.length}`); }
  if (principioAtivoId) { params.push(principioAtivoId); conds.push(`p._dados->>'CODI_PRI' = $${params.length}`); }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         fi.id,
         fi.nf_id,
         fi.produto_id,
         fi._dados->>'ITEM_INO'            AS seq,
         (fi._dados->>'QTDE_INO')::NUMERIC AS quantidade,
         (fi._dados->>'VLOR_INO')::NUMERIC AS valor_unitario,
         (fi._dados->>'QTDE_INO')::NUMERIC
           * (fi._dados->>'VLOR_INO')::NUMERIC AS valor_total,
         p.descricao                        AS produto_desc,
         p._dados->>'UNID_PSV'              AS unidade,
         p._dados->>'CODI_GPR'              AS grupo_id,
         g.descricao                        AS grupo_desc,
         p._dados->>'CODI_SBG'              AS subgrupo_id,
         p._dados->>'CODI_PRI'              AS principio_ativo_id,
         pa.descricao                       AS principio_ativo_desc,
         par.principio_id                   AS principio_ativo_rec_id,
         par2.descricao                     AS principio_ativo_rec_desc,
         f.filial_id,
         f.data_emissao,
         f.tran_top,
         f._dados->>'NOTA_NOT'              AS numero_nf,
         f._dados->>'CODI_TRA'              AS cliente_id,
         f._dados->>'COD1_PES'              AS vendedor_id
       FROM raw.faturamento_itens fi
       JOIN raw.faturamento f ON f.id = fi.nf_id
       LEFT JOIN raw.produtos                   p    ON p.id    = fi.produto_id
       LEFT JOIN raw.grupos                     g    ON g.id    = p._dados->>'CODI_GPR'
       LEFT JOIN raw.principios_ativos          pa   ON pa.id   = p._dados->>'CODI_PRI'
       LEFT JOIN raw.produto_principio_ativo_rec par  ON par.produto_id = fi.produto_id
       LEFT JOIN raw.principios_ativos_rec      par2 ON par2.id = par.principio_id
       ${where}
       ORDER BY f.data_emissao DESC, fi.nf_id, (fi._dados->>'ITEM_INO')::INT NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::INT AS total
       FROM raw.faturamento_itens fi
       JOIN raw.faturamento f ON f.id = fi.nf_id
       LEFT JOIN raw.produtos p ON p.id = fi.produto_id
       ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

/**
 * Reproduz o consolidado de faturamento do SiAGRI para um parâmetro de operação.
 *
 * Combina as funções A/S de duas origens:
 *   - NOTA: valor de TOTA_NOT e quantidade dos itens de INOTA
 *   - NFENTRA: quantidade e valor líquido dos itens de INFENTRA
 *
 * As devoluções de NFENTRA usam QUAN_INF × VLIQ_INF. O período é filtrado
 * pela data de emissão em ambas as origens.
 */
async function resumoConsolidado({
  paramId,
  filialId,
  dataInicio,
  dataFim,
  status = '5',
}) {
  const notaConds = [`pod.param_id = $1`];
  const entradaConds = [`pod.param_id = $1`];
  const params = [paramId];

  if (filialId) {
    params.push(filialId);
    notaConds.push(`f.filial_id = $${params.length}`);
    entradaConds.push(`n.filial_id = $${params.length}`);
  }
  if (dataInicio) {
    params.push(dataInicio);
    notaConds.push(`f.data_emissao >= $${params.length}`);
    entradaConds.push(`n.data_emissao >= $${params.length}`);
  }
  if (dataFim) {
    params.push(dataFim);
    notaConds.push(`f.data_emissao <= $${params.length}`);
    entradaConds.push(`n.data_emissao <= $${params.length}`);
  }
  if (status) {
    params.push(status);
    notaConds.push(`f._dados->>'SITU_NOT' = $${params.length}`);
  }

  const res = await db.query(
    `WITH nota_valores AS (
       SELECT
         f.filial_id,
         pod.funcao,
         SUM((f._dados->>'TOTA_NOT')::NUMERIC) AS valor
       FROM raw.faturamento f
       JOIN raw.param_oper_detalhe pod
         ON pod.operacao_id = f.operacao_id
       WHERE ${notaConds.join(' AND ')}
       GROUP BY f.filial_id, pod.funcao
     ),
     nota_quantidades AS (
       SELECT
         f.filial_id,
         pod.funcao,
         SUM((fi._dados->>'QTDE_INO')::NUMERIC) AS quantidade
       FROM raw.faturamento f
       JOIN raw.faturamento_itens fi ON fi.nf_id = f.id
       JOIN raw.param_oper_detalhe pod
         ON pod.operacao_id = f.operacao_id
       WHERE ${notaConds.join(' AND ')}
       GROUP BY f.filial_id, pod.funcao
     ),
     nota AS (
       SELECT
         'NOTA'::TEXT AS origem,
         COALESCE(v.filial_id, q.filial_id) AS filial_id,
         COALESCE(v.funcao, q.funcao) AS funcao,
         COALESCE(q.quantidade, 0) AS quantidade,
         COALESCE(v.valor, 0) AS valor
       FROM nota_valores v
       FULL JOIN nota_quantidades q
         ON q.filial_id = v.filial_id
        AND q.funcao = v.funcao
     ),
     entrada AS (
       SELECT
         'NFENTRA'::TEXT AS origem,
         n.filial_id,
         pod.funcao,
         SUM(COALESCE((i._dados->>'QUAN_INF')::NUMERIC, 0)) AS quantidade,
         SUM(
           COALESCE((i._dados->>'QUAN_INF')::NUMERIC, 0)
           * COALESCE((i._dados->>'VLIQ_INF')::NUMERIC, 0)
         ) AS valor
       FROM raw.nfe_entrada n
       JOIN raw.nfe_entrada_itens i ON i.nfe_entrada_id = n.id
       JOIN raw.param_oper_detalhe pod
         ON pod.operacao_id = i.operacao_id
       WHERE ${entradaConds.join(' AND ')}
       GROUP BY n.filial_id, pod.funcao
     ),
     componentes AS (
       SELECT * FROM nota
       UNION ALL
       SELECT * FROM entrada
     )
     SELECT
       filial_id,
       SUM(CASE WHEN funcao = 'A' THEN quantidade ELSE -quantidade END) AS quantidade_liquida,
       SUM(CASE WHEN funcao = 'A' THEN valor ELSE -valor END) AS valor_liquido,
       JSONB_AGG(
         JSONB_BUILD_OBJECT(
           'origem', origem,
           'funcao', funcao,
           'quantidade', quantidade,
           'valor', valor
         )
         ORDER BY origem, funcao
       ) AS componentes
     FROM componentes
     GROUP BY filial_id
     ORDER BY filial_id`,
    params,
  );

  const quantidadeLiquida = res.rows.reduce(
    (total, row) => total + Number(row.quantidade_liquida || 0),
    0,
  );
  const valorLiquido = res.rows.reduce(
    (total, row) => total + Number(row.valor_liquido || 0),
    0,
  );

  return {
    param_id: paramId,
    data_inicio: dataInicio || null,
    data_fim: dataFim || null,
    status,
    quantidade_liquida: Number(quantidadeLiquida.toFixed(3)),
    valor_liquido: Number(valorLiquido.toFixed(2)),
    por_filial: res.rows,
  };
}

async function resumo({
  agrupamento = 'mes',
  filialId,
  dataInicio,
  dataFim,
  dataSaidaDe,
  dataSaidaAte,
  tranTop,
  paramId,
  status,
}) {
  if (paramId) {
    if (dataSaidaDe || dataSaidaAte) {
      const error = new Error(
        'O resumo consolidado por paramId usa dataInicio/dataFim (data de emissão).',
      );
      error.statusCode = 400;
      throw error;
    }
    return resumoConsolidado({ paramId, filialId, dataInicio, dataFim, status });
  }

  const conds = [];
  const params = [];

  if (filialId)    { params.push(filialId);    conds.push(`filial_id = $${params.length}`); }
  if (dataInicio)  { params.push(dataInicio);  conds.push(`data_emissao >= $${params.length}`); }
  if (dataFim)     { params.push(dataFim);     conds.push(`data_emissao <= $${params.length}`); }
  if (dataSaidaDe) { params.push(dataSaidaDe); conds.push(`(_dados->>'DSAI_NOT')::DATE >= $${params.length}`); }
  if (dataSaidaAte){ params.push(dataSaidaAte);conds.push(`(_dados->>'DSAI_NOT')::DATE <= $${params.length}`); }
  if (tranTop)     { params.push(tranTop);     conds.push(`tran_top = $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  // Se filtro por data_saida, o período usa data_saida; caso contrário data_emissao
  const dateCol = (dataSaidaDe || dataSaidaAte) ? `(_dados->>'DSAI_NOT')::DATE` : `data_emissao`;
  const trunc = agrupamento === 'dia'       ? `DATE_TRUNC('day',     ${dateCol})`
              : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', ${dateCol})`
              : agrupamento === 'ano'       ? `DATE_TRUNC('year',    ${dateCol})`
              :                              `DATE_TRUNC('month',    ${dateCol})`;

  const res = await db.query(
    `SELECT
       ${trunc}                                        AS periodo,
       filial_id,
       COUNT(*)::INT                                  AS quantidade_nf,
       SUM((_dados->>'TOTA_NOT')::NUMERIC)            AS valor_total,
       COUNT(*) FILTER (WHERE tran_top = '2')::INT    AS nfs_saida,
       COUNT(*) FILTER (WHERE tran_top = '1')::INT    AS nfs_entrada
     FROM raw.faturamento
     ${where}
     GROUP BY periodo, filial_id
     ORDER BY periodo DESC, filial_id`,
    params,
  );

  return { data: res.rows };
}

module.exports = { listar, buscarPorId, listarItens, resumo, resumoConsolidado };
