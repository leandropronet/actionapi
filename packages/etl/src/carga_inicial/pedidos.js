'use strict';
const oracle = require('../db/oracle');
const { upsertRaw } = require('../upsert');
const cfg = require('../oracle-config').pedidos;

async function carregarJanela(filialId, dataInicio, dataFim) {
  const sql = `
    SELECT *
    FROM ${cfg.tabela}
    WHERE ${cfg.campoFilial} = :filialId
      AND ${cfg.campoDataPedido} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
      AND ${cfg.campoDataPedido} <  TO_DATE(:dataFim,   'YYYY-MM-DD') + 1
    ORDER BY ${cfg.campoDataPedido}
  `;

  const result = await oracle.query(sql, { filialId, dataInicio, dataFim });
  const rows = result.rows || [];
  if (!rows.length) return 0;

  const cabecalhos = rows.map((row) => ({
    id:             String(row[cfg.campoId]),
    filial_id:      String(row[cfg.campoFilial] ?? filialId),
    cliente_id:     row[cfg.campoCliente] ? String(row[cfg.campoCliente]) : null,
    data_pedido:    row[cfg.campoDataPedido] || null,
    data_alteracao: row[cfg.campoDataAlter] || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.pedidos', cabecalhos);

  if (cfg.tabelaItens && !cfg.tabelaItens.startsWith('TODO')) {
    const ids = rows.map((r) => r[cfg.campoId]).filter(Boolean);
    const placeholders = ids.map((_, i) => `:id${i}`).join(', ');
    const bindIds = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));

    const sqlItens = `SELECT * FROM ${cfg.tabelaItens} WHERE ${cfg.campoItemPedidoId} IN (${placeholders})`;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id:        String(row['ID'] || `${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemProduto]}`),
      pedido_id: String(row[cfg.campoItemPedidoId]),
      produto_id:row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
      _dados:    JSON.stringify(row),
      _source:   'siagri',
    }));
    if (itens.length) await upsertRaw('raw.pedidos_itens', itens);
  }

  return cabecalhos.length;
}

module.exports = { carregarJanela };
