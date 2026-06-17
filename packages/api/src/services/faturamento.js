'use strict';
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
  dataInicio, dataFim, filialId, clienteId, vendedorId,
  status, tranTop, operacaoId, grupoId, subgrupoId, produtoId, principioAtivoId,
  page = 1, pageSize = 100,
}) {
  const conds = [];
  const params = [];

  if (dataInicio)  { params.push(dataInicio);  conds.push(`f.data_emissao >= $${params.length}`); }
  if (dataFim)     { params.push(dataFim);     conds.push(`f.data_emissao <= $${params.length}`); }
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
  dataInicio, dataFim, filialId, clienteId, vendedorId, tranTop,
  grupoId, subgrupoId, produtoId, principioAtivoId,
  page = 1, pageSize = 200,
}) {
  const conds = [];
  const params = [];

  if (dataInicio)  { params.push(dataInicio);  conds.push(`f.data_emissao >= $${params.length}`); }
  if (dataFim)     { params.push(dataFim);     conds.push(`f.data_emissao <= $${params.length}`); }
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

async function resumo({ agrupamento = 'mes', filialId, dataInicio, dataFim, tranTop }) {
  const conds = [];
  const params = [];

  if (filialId)  { params.push(filialId);  conds.push(`filial_id = $${params.length}`); }
  if (dataInicio){ params.push(dataInicio); conds.push(`data_emissao >= $${params.length}`); }
  if (dataFim)   { params.push(dataFim);   conds.push(`data_emissao <= $${params.length}`); }
  if (tranTop)   { params.push(tranTop);   conds.push(`tran_top = $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const trunc = agrupamento === 'dia'       ? `DATE_TRUNC('day',     data_emissao)`
              : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', data_emissao)`
              : agrupamento === 'ano'       ? `DATE_TRUNC('year',    data_emissao)`
              :                              `DATE_TRUNC('month',    data_emissao)`;

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

module.exports = { listar, buscarPorId, listarItens, resumo };
