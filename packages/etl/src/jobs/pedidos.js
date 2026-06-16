'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').pedidos;

async function sincronizar() {
  const ultimoSync = await lerUltimoSync('pedidos');
  console.log(`[pedidos] sync incremental desde ${ultimoSync.toISOString()}`);

  const sql = `
    SELECT *
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${cfg.campoDataAlter} > :ultimoSync
    ORDER BY ${cfg.campoDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[pedidos] sem registros novos');
    return;
  }

  const cabecalhos = rows.map((row) => ({
    // PK composta: número do pedido + série
    id:             `${row[cfg.campoPedidoId]}_${row[cfg.campoPedidoSerie]}`,
    filial_id:      String(row[cfg.campoFilial] ?? ''),
    cliente_id:     row[cfg.campoCliente] ? String(row[cfg.campoCliente]) : null,
    data_pedido:    row[cfg.campoDataPedido] || null,
    data_alteracao: row[cfg.campoDataAlter] || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.pedidos', cabecalhos);

  // Sincroniza itens dos pedidos alterados
  const pedidoIds = rows.map((r) => r[cfg.campoPedidoId]).filter(Boolean);
  if (pedidoIds.length) {
    const placeholders = pedidoIds.map((_, i) => `:id${i}`).join(', ');
    const bindIds = Object.fromEntries(pedidoIds.map((id, i) => [`id${i}`, id]));
    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE ${cfg.campoItemPedidoId} IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id:        `${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemSerie]}_${row[cfg.campoItemSeq]}`,
      pedido_id: `${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemSerie]}`,
      produto_id: row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
      _dados:    JSON.stringify(row),
      _source:   'siagri',
    }));
    if (itens.length) await upsertRaw('raw.pedidos_itens', itens);
  }

  await atualizarSync('pedidos');
  console.log(`[pedidos] ${cabecalhos.length} pedidos sincronizados`);
}

module.exports = { sincronizar };
