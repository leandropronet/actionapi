'use strict';
const db = require('../db/postgres');

async function listar({ filialId, clienteId, status, dataInicio, dataFim, page = 1, pageSize = 100 }) {
  const conditions = [];
  const params = [];

  if (filialId)   { params.push(filialId);   conditions.push(`filial_id = $${params.length}`); }
  if (clienteId)  { params.push(clienteId);  conditions.push(`cliente_id = $${params.length}`); }
  if (dataInicio) { params.push(dataInicio); conditions.push(`data_pedido >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conditions.push(`data_pedido <= $${params.length}`); }
  if (status) {
    params.push(status);
    conditions.push(`_dados->>'STATUS' = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, filial_id, cliente_id, data_pedido, _dados, _sync_at
       FROM raw.pedidos ${where}
       ORDER BY data_pedido DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.pedidos ${where}`, params),
  ]);

  return {
    data: dataRes.rows,
    total: countRes.rows[0].total,
    page,
    pageSize,
  };
}

async function buscarItens(pedidoId) {
  const res = await db.query(
    `SELECT id, pedido_id, produto_id, _dados FROM raw.pedidos_itens WHERE pedido_id = $1`,
    [pedidoId]
  );
  return res.rows;
}

module.exports = { listar, buscarItens };
