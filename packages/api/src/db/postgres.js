'use strict';
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ ...config.pg, max: 20, idleTimeoutMillis: 30000 });
pool.on('error', (err) => console.error('[postgres] erro no pool:', err.message));

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

module.exports = { query, pool };
