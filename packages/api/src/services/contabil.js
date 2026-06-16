'use strict';
const db = require('../db/postgres');

async function listar({ filialId, competencia, conta, centroCusto, page = 1, pageSize = 200 }) {
  const conditions = [];
  const params = [];

  if (filialId)    { params.push(filialId);    conditions.push(`filial_id = $${params.length}`); }
  if (competencia) { params.push(competencia); conditions.push(`competencia = $${params.length}`); }
  if (conta)       { params.push(conta);       conditions.push(`_dados->>'COD_CONTA' = $${params.length}`); }
  if (centroCusto) { params.push(centroCusto); conditions.push(`_dados->>'COD_CC' = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, filial_id, data_lancamento, competencia, _dados, _sync_at
       FROM raw.contabil ${where}
       ORDER BY data_lancamento DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.contabil ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function saldoContas({ filialId, competencia }) {
  const conditions = [];
  const params = [];

  if (filialId)    { params.push(filialId);    conditions.push(`filial_id = $${params.length}`); }
  if (competencia) { params.push(competencia); conditions.push(`competencia = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await db.query(
    `SELECT
       filial_id,
       competencia,
       _dados->>'COD_CONTA'  AS conta,
       _dados->>'COD_CC'     AS centro_custo,
       SUM((_dados->>'DEBITO')::NUMERIC)  AS total_debito,
       SUM((_dados->>'CREDITO')::NUMERIC) AS total_credito,
       SUM((_dados->>'CREDITO')::NUMERIC) - SUM((_dados->>'DEBITO')::NUMERIC) AS saldo
     FROM raw.contabil
     ${where}
     GROUP BY filial_id, competencia, conta, centro_custo
     ORDER BY competencia DESC, conta`,
    params
  );

  return { data: res.rows };
}

module.exports = { listar, saldoContas };
