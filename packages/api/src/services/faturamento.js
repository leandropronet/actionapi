'use strict';
const db = require('../db/postgres');

async function listar({ dataInicio, dataFim, filialId, clienteId, page = 1, pageSize = 100 }) {
  const conditions = [];
  const params = [];

  if (dataInicio) { params.push(dataInicio); conditions.push(`data_emissao >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conditions.push(`data_emissao <= $${params.length}`); }
  if (filialId)   { params.push(filialId);   conditions.push(`filial_id = $${params.length}`); }
  if (clienteId)  {
    params.push(clienteId);
    conditions.push(`_dados->>'${process.env.ORACLE_CAMPO_CLIENTE_FAT || 'COD_CLIENTE'}' = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, filial_id, data_emissao, data_alteracao, _dados, _sync_at
       FROM raw.faturamento ${where}
       ORDER BY data_emissao DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.faturamento ${where}`, params),
  ]);

  return {
    data: dataRes.rows,
    total: countRes.rows[0].total,
    page,
    pageSize,
    syncedAt: dataRes.rows[0]?._sync_at || null,
  };
}

async function resumo({ agrupamento = 'mes', filialId, dataInicio, dataFim }) {
  const conditions = [];
  const params = [];

  if (filialId)   { params.push(filialId);   conditions.push(`filial_id = $${params.length}`); }
  if (dataInicio) { params.push(dataInicio); conditions.push(`data_emissao >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conditions.push(`data_emissao <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const groupBy = agrupamento === 'dia'      ? `DATE_TRUNC('day', data_emissao)`
               : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', data_emissao)`
               : agrupamento === 'ano'       ? `DATE_TRUNC('year', data_emissao)`
               :                              `DATE_TRUNC('month', data_emissao)`;

  const res = await db.query(
    `SELECT
       ${groupBy} AS periodo,
       filial_id,
       COUNT(*) AS quantidade_nf,
       SUM((_dados->>'VALOR_TOTAL')::NUMERIC) AS valor_total
     FROM raw.faturamento
     ${where}
     GROUP BY periodo, filial_id
     ORDER BY periodo DESC`,
    params
  );

  return { data: res.rows };
}

module.exports = { listar, resumo };
