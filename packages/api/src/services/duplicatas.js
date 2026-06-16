'use strict';
const db = require('../db/postgres');

async function listar({ filialId, status, vencimentoAte, vencimentoDe, nfId, page = 1, pageSize = 100 }) {
  const conditions = [];
  const params = [];

  if (filialId)     { params.push(filialId);     conditions.push(`filial_id = $${params.length}`); }
  if (nfId)         { params.push(nfId);         conditions.push(`nf_id = $${params.length}`); }
  if (vencimentoDe) { params.push(vencimentoDe); conditions.push(`data_vencimento >= $${params.length}`); }
  if (vencimentoAte){ params.push(vencimentoAte);conditions.push(`data_vencimento <= $${params.length}`); }
  if (status) {
    params.push(status);
    conditions.push(`_dados->>'STATUS' = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, filial_id, nf_id, data_emissao, data_vencimento, _dados, _sync_at
       FROM raw.duplicatas ${where}
       ORDER BY data_vencimento ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.duplicatas ${where}`, params),
  ]);

  return {
    data: dataRes.rows,
    total: countRes.rows[0].total,
    page,
    pageSize,
  };
}

module.exports = { listar };
