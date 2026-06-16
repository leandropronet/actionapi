'use strict';
const db = require('../db/postgres');

async function listar({ search, page = 1, pageSize = 100 }) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(_dados->>'RAZAO_SOCIAL' ILIKE $${params.length} OR _dados->>'CPF_CNPJ' LIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, _dados, _sync_at FROM raw.clientes ${where}
       ORDER BY _dados->>'RAZAO_SOCIAL'
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.clientes ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function buscar(id) {
  const res = await db.query(`SELECT id, _dados, _sync_at FROM raw.clientes WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

async function historicoCompras(id, { dataInicio, dataFim, page = 1, pageSize = 100 }) {
  const conditions = [`_dados->>'COD_CLIENTE' = $1`];
  const params = [id];

  if (dataInicio) { params.push(dataInicio); conditions.push(`data_emissao >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conditions.push(`data_emissao <= $${params.length}`); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, filial_id, data_emissao, _dados FROM raw.faturamento ${where}
       ORDER BY data_emissao DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.faturamento ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

module.exports = { listar, buscar, historicoCompras };
