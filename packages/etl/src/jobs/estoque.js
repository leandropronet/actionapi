'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').estoque;

async function sincronizar() {
  const ultimoSync = await lerUltimoSync('estoque');
  console.log(`[estoque] sync incremental desde ${ultimoSync.toISOString()}`);

  const sql = `
    SELECT *
    FROM ${cfg.tabela}
    WHERE ${cfg.campoDataAlter} > :ultimoSync
    ORDER BY ${cfg.campoDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[estoque] sem registros novos');
    return;
  }

  const registros = rows.map((row) => ({
    id:             String(row[cfg.campoId]),
    filial_id:      String(row[cfg.campoFilial] ?? ''),
    produto_id:     row[cfg.campoProduto] ? String(row[cfg.campoProduto]) : null,
    deposito_id:    row[cfg.campoDeposito] ? String(row[cfg.campoDeposito]) : null,
    data_posicao:   new Date(),
    data_alteracao: row[cfg.campoDataAlter] || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.estoque', registros);
  await atualizarSync('estoque');
  console.log(`[estoque] ${registros.length} registros sincronizados`);
}

module.exports = { sincronizar };
