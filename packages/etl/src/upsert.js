'use strict';
/**
 * upsert.js
 *
 * Funções de persistência incremental para todas as tabelas raw.*.
 * O ETL chama upsertRaw() após cada lote de dados Oracle — se o registro
 * já existir (mesmo id), é atualizado; se não existir, é inserido.
 *
 * O campo _sync_at é sempre atualizado para rastrear quando o dado chegou.
 * O controle de "onde parei" fica em etl_sync via atualizarSync/lerUltimoSync.
 */
const pg = require('./db/postgres');

// Faz UPSERT em lote em qualquer tabela raw.
// rows: array de objetos { id, filial_id, ..., _dados }
// table: 'raw.faturamento' por exemplo
// keyFields: campos que formam o ON CONFLICT (padrão: ['id'])
async function upsertRaw(table, rows, extraFields = {}) {
  if (!rows.length) return 0;

  for (const row of rows) {
    const fields = Object.keys(row);
    const values = Object.values(row);
    const placeholders = fields.map((_, i) => `$${i + 1}`);
    const updates = fields
      .filter((f) => f !== 'id')
      .map((f) => `${f} = EXCLUDED.${f}`);

    const sql = `
      INSERT INTO ${table} (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${updates.join(', ')},
        _sync_at = NOW()
    `;
    await pg.query(sql, values);
  }

  return rows.length;
}

// Atualiza o timestamp de último sync incremental
async function atualizarSync(dominio) {
  await pg.query(
    `UPDATE etl_sync SET ultimo_sync = NOW(), atualizado_em = NOW() WHERE dominio = $1`,
    [dominio]
  );
}

// Lê o timestamp de último sync incremental
async function lerUltimoSync(dominio) {
  const res = await pg.query(
    `SELECT ultimo_sync FROM etl_sync WHERE dominio = $1`,
    [dominio]
  );
  return res.rows[0]?.ultimo_sync || new Date('2020-01-01');
}

module.exports = { upsertRaw, atualizarSync, lerUltimoSync };
