'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').faturamento;

async function sincronizar() {
  const ultimoSync = await lerUltimoSync('faturamento');
  console.log(`[faturamento] sync incremental desde ${ultimoSync.toISOString()}`);

  const sql = `
    SELECT *
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${cfg.campoDataAlter} > :ultimoSync
    ORDER BY ${cfg.campoDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[faturamento] sem registros novos');
    return;
  }

  const registros = rows.map((row) => ({
    id:             String(row[cfg.campoId]),
    filial_id:      String(row[cfg.campoFilial] ?? ''),
    data_emissao:   row[cfg.campoDataEmissao] || null,
    data_alteracao: row[cfg.campoDataAlter] || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.faturamento', registros);

  // Sincroniza itens das NFs alteradas
  const ids = rows.map((r) => r[cfg.campoId]).filter(Boolean);
  if (ids.length) {
    const placeholders = ids.map((_, i) => `:id${i}`).join(', ');
    const bindIds = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE ${cfg.campoItemNfId} IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id:      `${row[cfg.campoItemNfId]}_${row[cfg.campoItemSeq]}`,
      nf_id:   String(row[cfg.campoItemNfId]),
      _dados:  JSON.stringify(row),
      _source: 'siagri',
    }));
    if (itens.length) await upsertRaw('raw.faturamento_itens', itens);
  }

  await atualizarSync('faturamento');
  console.log(`[faturamento] ${registros.length} NFs sincronizadas`);
}

module.exports = { sincronizar };
