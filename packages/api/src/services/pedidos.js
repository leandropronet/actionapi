'use strict';
const db = require('../db/postgres');

const SELECT_PED = `
  p.id,
  p.filial_id,
  p.cliente_id,
  p.data_pedido,
  p._dados->>'PEDI_PED'           AS numero_pedido,
  p._dados->>'SERI_PED'           AS serie,
  p._dados->>'COD1_PES'           AS vendedor_id,
  p._dados->>'SITU_PED'           AS status,
  (p._dados->>'TOTA_PED')::NUMERIC AS valor_total,
  p._sync_at
`;

function buildProdutoExists(conds, params, { grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId }) {
  if (!grupoId && !subgrupoId && !produtoId && !principioAtivoId && !principioAtivoRecId) return;

  const innerConds = ['pi2.pedido_id = p.id'];
  if (produtoId) { params.push(produtoId); innerConds.push(`pi2.produto_id = $${params.length}`); }

  const needProdJoin = grupoId || subgrupoId || principioAtivoId;
  if (needProdJoin) {
    innerConds.push('pr2.id = pi2.produto_id');
    if (grupoId)          { params.push(grupoId);          innerConds.push(`pr2._dados->>'CODI_GPR' = $${params.length}`); }
    if (subgrupoId)       { params.push(subgrupoId);       innerConds.push(`pr2._dados->>'CODI_SBG' = $${params.length}`); }
    if (principioAtivoId) { params.push(principioAtivoId); innerConds.push(`pr2._dados->>'CODI_PRI' = $${params.length}`); }
  }

  if (principioAtivoRecId) {
    params.push(principioAtivoRecId);
    innerConds.push(`EXISTS (
      SELECT 1 FROM raw.produto_principio_ativo_rec ppar
      WHERE ppar.produto_id = pi2.produto_id AND ppar.principio_id = $${params.length}
    )`);
  }

  const baseJoin = needProdJoin
    ? 'raw.pedidos_itens pi2 JOIN raw.produtos pr2 ON pr2.id = pi2.produto_id'
    : 'raw.pedidos_itens pi2';

  conds.push(`EXISTS (SELECT 1 FROM ${baseJoin} WHERE ${innerConds.join(' AND ')})`);
}

async function listar({
  dataInicio, dataFim, filialId, clienteId, vendedorId, status,
  grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
  page = 1, pageSize = 100,
}) {
  const conds = [];
  const params = [];

  if (dataInicio) { params.push(dataInicio); conds.push(`p.data_pedido >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conds.push(`p.data_pedido <= $${params.length}`); }
  if (filialId)   { params.push(filialId);   conds.push(`p.filial_id = $${params.length}`); }
  if (clienteId)  { params.push(clienteId);  conds.push(`p.cliente_id = $${params.length}`); }
  if (vendedorId) { params.push(vendedorId); conds.push(`p._dados->>'COD1_PES' = $${params.length}`); }
  if (status)     { params.push(status);     conds.push(`p._dados->>'SITU_PED' = $${params.length}`); }

  buildProdutoExists(conds, params, { grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId });

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT ${SELECT_PED}
       FROM raw.pedidos p
       ${where}
       ORDER BY p.data_pedido DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.pedidos p ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function buscarPorId(id) {
  const [pedRes, itensRes] = await Promise.all([
    db.query(`SELECT ${SELECT_PED} FROM raw.pedidos p WHERE p.id = $1`, [id]),
    db.query(
      `SELECT
         pi.id,
         pi.pedido_id,
         pi.produto_id,
         pi._dados->>'ITEM_IPE'            AS seq,
         (pi._dados->>'QTDE_IPE')::NUMERIC AS quantidade,
         (pi._dados->>'VLOR_IPE')::NUMERIC AS valor_unitario,
         pr.descricao                       AS produto_desc,
         pr._dados->>'UNID_PSV'             AS unidade,
         pr._dados->>'CODI_GPR'             AS grupo_id,
         g.descricao                        AS grupo_desc,
         pr._dados->>'CODI_SBG'             AS subgrupo_id,
         pr._dados->>'CODI_PRI'             AS principio_ativo_id,
         pa.descricao                       AS principio_ativo_desc,
         par.principio_id                   AS principio_ativo_rec_id,
         par2.descricao                     AS principio_ativo_rec_desc
       FROM raw.pedidos_itens pi
       LEFT JOIN raw.produtos                    pr   ON pr.id   = pi.produto_id
       LEFT JOIN raw.grupos                      g    ON g.id    = pr._dados->>'CODI_GPR'
       LEFT JOIN raw.principios_ativos           pa   ON pa.id   = pr._dados->>'CODI_PRI'
       LEFT JOIN raw.produto_principio_ativo_rec par  ON par.produto_id = pi.produto_id
       LEFT JOIN raw.principios_ativos_rec       par2 ON par2.id = par.principio_id
       WHERE pi.pedido_id = $1
       ORDER BY (pi._dados->>'ITEM_IPE')::INT NULLS LAST`,
      [id],
    ),
  ]);

  if (!pedRes.rows.length) return null;
  return { ...pedRes.rows[0], itens: itensRes.rows };
}

async function listarItens({
  dataInicio, dataFim, filialId, clienteId, vendedorId, status,
  grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
  page = 1, pageSize = 200,
}) {
  const conds = [];
  const params = [];

  if (dataInicio)       { params.push(dataInicio);       conds.push(`p.data_pedido >= $${params.length}`); }
  if (dataFim)          { params.push(dataFim);          conds.push(`p.data_pedido <= $${params.length}`); }
  if (filialId)         { params.push(filialId);         conds.push(`p.filial_id = $${params.length}`); }
  if (clienteId)        { params.push(clienteId);        conds.push(`p.cliente_id = $${params.length}`); }
  if (vendedorId)       { params.push(vendedorId);       conds.push(`p._dados->>'COD1_PES' = $${params.length}`); }
  if (status)           { params.push(status);           conds.push(`p._dados->>'SITU_PED' = $${params.length}`); }
  if (grupoId)          { params.push(grupoId);          conds.push(`pr._dados->>'CODI_GPR' = $${params.length}`); }
  if (subgrupoId)       { params.push(subgrupoId);       conds.push(`pr._dados->>'CODI_SBG' = $${params.length}`); }
  if (produtoId)        { params.push(produtoId);        conds.push(`pi.produto_id = $${params.length}`); }
  if (principioAtivoId) { params.push(principioAtivoId); conds.push(`pr._dados->>'CODI_PRI' = $${params.length}`); }
  if (principioAtivoRecId) {
    params.push(principioAtivoRecId);
    conds.push(`EXISTS (
      SELECT 1 FROM raw.produto_principio_ativo_rec ppar
      WHERE ppar.produto_id = pi.produto_id AND ppar.principio_id = $${params.length}
    )`);
  }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         pi.id,
         pi.pedido_id,
         pi.produto_id,
         pi._dados->>'ITEM_IPE'            AS seq,
         (pi._dados->>'QTDE_IPE')::NUMERIC AS quantidade,
         (pi._dados->>'VLOR_IPE')::NUMERIC AS valor_unitario,
         (pi._dados->>'QTDE_IPE')::NUMERIC
           * (pi._dados->>'VLOR_IPE')::NUMERIC AS valor_total,
         pr.descricao                       AS produto_desc,
         pr._dados->>'UNID_PSV'             AS unidade,
         pr._dados->>'CODI_GPR'             AS grupo_id,
         g.descricao                        AS grupo_desc,
         pr._dados->>'CODI_SBG'             AS subgrupo_id,
         pr._dados->>'CODI_PRI'             AS principio_ativo_id,
         pa.descricao                       AS principio_ativo_desc,
         par.principio_id                   AS principio_ativo_rec_id,
         par2.descricao                     AS principio_ativo_rec_desc,
         p.filial_id,
         p.cliente_id,
         p.data_pedido,
         p._dados->>'PEDI_PED'              AS numero_pedido,
         p._dados->>'SERI_PED'              AS serie,
         p._dados->>'COD1_PES'              AS vendedor_id,
         p._dados->>'SITU_PED'              AS status
       FROM raw.pedidos_itens pi
       JOIN raw.pedidos p ON p.id = pi.pedido_id
       LEFT JOIN raw.produtos                    pr   ON pr.id   = pi.produto_id
       LEFT JOIN raw.grupos                      g    ON g.id    = pr._dados->>'CODI_GPR'
       LEFT JOIN raw.principios_ativos           pa   ON pa.id   = pr._dados->>'CODI_PRI'
       LEFT JOIN raw.produto_principio_ativo_rec par  ON par.produto_id = pi.produto_id
       LEFT JOIN raw.principios_ativos_rec       par2 ON par2.id = par.principio_id
       ${where}
       ORDER BY p.data_pedido DESC, pi.pedido_id, (pi._dados->>'ITEM_IPE')::INT NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::INT AS total
       FROM raw.pedidos_itens pi
       JOIN raw.pedidos p ON p.id = pi.pedido_id
       LEFT JOIN raw.produtos pr ON pr.id = pi.produto_id
       ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function resumo({ agrupamento = 'mes', filialId, dataInicio, dataFim, status }) {
  const conds = [];
  const params = [];

  if (filialId)  { params.push(filialId);  conds.push(`filial_id = $${params.length}`); }
  if (dataInicio){ params.push(dataInicio); conds.push(`data_pedido >= $${params.length}`); }
  if (dataFim)   { params.push(dataFim);   conds.push(`data_pedido <= $${params.length}`); }
  if (status)    { params.push(status);    conds.push(`_dados->>'SITU_PED' = $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const trunc = agrupamento === 'dia'       ? `DATE_TRUNC('day',     data_pedido)`
              : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', data_pedido)`
              : agrupamento === 'ano'       ? `DATE_TRUNC('year',    data_pedido)`
              :                              `DATE_TRUNC('month',    data_pedido)`;

  const res = await db.query(
    `SELECT
       ${trunc}                                AS periodo,
       filial_id,
       COUNT(*)::INT                          AS quantidade,
       SUM((_dados->>'TOTA_PED')::NUMERIC)    AS valor_total,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '0')::INT AS nao_liberados,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '1')::INT AS liberados,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '5')::INT AS confirmados,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '9')::INT AS cancelados
     FROM raw.pedidos
     ${where}
     GROUP BY periodo, filial_id
     ORDER BY periodo DESC, filial_id`,
    params,
  );

  return { data: res.rows };
}

module.exports = { listar, buscarPorId, listarItens, resumo };
