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

async function query(sql, binds = {}) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    return await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
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
