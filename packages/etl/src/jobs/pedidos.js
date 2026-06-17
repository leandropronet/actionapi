'use strict';
/**
 * jobs/pedidos.js
 *
 * ETL incremental de Pedidos de Venda (PEDIDO + IPEDIDO).
 *
 * Tabelas Oracle:
 *   PEDIDO   — cabeçalho do pedido; PK composta: PEDI_PED + SERI_PED
 *   IPEDIDO  — itens do pedido; FK: PEDI_PED + SERI_PED
 *
 * Tabelas PostgreSQL:
 *   raw.pedidos       — id = "{PEDI_PED}_{SERI_PED}"
 *   raw.pedidos_itens — id = "{PEDI_PED}_{SERI_PED}_{ITEM_IPE}"
 *
 * Campos relevantes:
 *   SITU_PED: 0=Não Liberado, 1=Liberado, 5=Confirmado, 9=Cancelado (status financeiro)
 *   ORIG_PED: null=ERP direto, S=CRM SiAGRI, M=Mobile (salvo em coluna origem)
 *   STAT_PED: sempre NULL nesta base — status comercial deve ser derivado via saldo
 *
 * Status comercial (calculado em /pedidos/:id/saldo):
 *   compara qtde em IPEDIDO vs qtde faturada em INOTA (link via PEDI_PED+SERI_PED)
 */
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
    origem:         row.ORIG_PED ? String(row.ORIG_PED).trim() : null,
    data_alteracao: row[cfg.campoDataAlter] || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.pedidos', cabecalhos);

  // Sincroniza itens dos pedidos alterados — Oracle limita IN a 1000, pagina em lotes
  const pedidoIds = rows.map((r) => r[cfg.campoPedidoId]).filter(Boolean);
  for (let i = 0; i < pedidoIds.length; i += 1000) {
    const chunk = pedidoIds.slice(i, i + 1000);
    const placeholders = chunk.map((_, j) => `:id${j}`).join(', ');
    const bindIds = Object.fromEntries(chunk.map((id, j) => [`id${j}`, id]));
    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE ${cfg.campoItemPedidoId} IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id:         `${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemSerie]}_${row[cfg.campoItemSeq]}`,
      pedido_id:  `${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemSerie]}`,
      produto_id: row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
      _dados:     JSON.stringify(row),
      _source:    'siagri',
    }));
    if (itens.length) await upsertRaw('raw.pedidos_itens', itens);
  }

  await atualizarSync('pedidos');
  console.log(`[pedidos] ${cabecalhos.length} pedidos sincronizados`);
}

module.exports = { sincronizar };
