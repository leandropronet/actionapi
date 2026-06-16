'use strict';
require('dotenv').config();
const oracledb = require('oracledb');

// oracledb v6+ usa thin mode por padrão (puro JS, sem Oracle Instant Client)
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool = null;

async function getPool() {
  if (pool) return pool;
  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASS,
    connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE}`,
    poolMin: 1,
    poolMax: Number(process.env.ORACLE_POOL_MAX) || 3,
    poolIncrement: 1,
    poolTimeout: 60,
  });
  console.log('[oracle] pool criado — thin mode');
  return pool;
}

function sanitizeRow(row) {
  const plain = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (v === null || v === undefined) {
      plain[key] = v;
    } else if (v instanceof Date) {
      plain[key] = v;
    } else if (Buffer.isBuffer(v)) {
      plain[key] = v.toString('hex');
    } else if (typeof v === 'object') {
      // Oracle-specific types (Lob, Interval, Timestamp internals) — serializa para string
      plain[key] = v.toString ? v.toString() : null;
    } else if (typeof v === 'string') {
      // Remove bytes nulos (\x00) — PostgreSQL JSONB rejeita null codepoints
      plain[key] = v.replace(/\x00/g, '');
    } else {
      plain[key] = v;
    }
  }
  return plain;
}

async function query(sql, binds = {}) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if (result.rows) result.rows = result.rows.map(sanitizeRow);
    return result;
  } finally {
    await conn.close();
  }
}

async function closePool() {
  if (pool) {
    await pool.close(0);
    pool = null;
  }
}

module.exports = { query, getPool, closePool };
