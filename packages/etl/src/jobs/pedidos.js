'use strict';
/**
 * jobs/pedidos.js
 *
 * ETL incremental de Pedidos de Venda (PEDIDO + IPEDIDO).
 *
 * Tabelas Oracle:
 *   PEDIDO   — cabeçalho do pedido; PK real: CODI_EMP + PEDI_PED + SERI_PED
 *   IPEDIDO  — itens do pedido; PK real: CODI_EMP + PEDI_PED + SERI_PED + CODI_PSV
 *
 *   PEDI_PED+SERI_PED isoladamente NÃO é único — o mesmo número se repete em
 *   filiais diferentes (confirmado: até 4 filiais compartilhando o mesmo par).
 *   Por isso o id inclui CODI_EMP — sem ele, ~28% dos pedidos se perdiam por
 *   colisão de id no upsert (achado em 2026-06).
 *
 * Tabelas PostgreSQL:
 *   raw.pedidos       — id = "{CODI_EMP}_{PEDI_PED}_{SERI_PED}"
 *   raw.pedidos_itens — id = "{CODI_EMP}_{PEDI_PED}_{SERI_PED}_{CODI_PSV}"
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

async function sincronizar({ dataInicio, dataFim } = {}) {
  const ultimoSync = await lerUltimoSync('pedidos');
  const condicoes = [];
  const binds = {};
  if (dataInicio) {
    condicoes.push(`${cfg.campoDataPedido} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`);
    binds.dataInicio = dataInicio;
  }
  if (dataFim) {
    condicoes.push(`${cfg.campoDataPedido} < TO_DATE(:dataFim, 'YYYY-MM-DD')`);
    binds.dataFim = dataFim;
  }
  if (!condicoes.length) {
    condicoes.push(`${cfg.campoDataAlter} > :ultimoSync`);
    binds.ultimoSync = ultimoSync;
  }
  const where = condicoes.join(' AND ');
  console.log(`[pedidos] sync ${dataInicio ? `de ${dataInicio} a ${dataFim || 'hoje'}` : `incremental desde ${ultimoSync.toISOString()}`}`);

  const sql = `
    SELECT *
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${where}
    ORDER BY ${cfg.campoDataAlter}
  `;

  const result = await oracle.query(sql, binds);
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[pedidos] sem registros novos');
    return;
  }

  const cabecalhos = rows.map((row) => ({
    // PK real: filial + número do pedido + série (ver nota no topo do arquivo)
    id:             `${row[cfg.campoFilial]}_${row[cfg.campoPedidoId]}_${row[cfg.campoPedidoSerie]}`,
    filial_id:      String(row[cfg.campoFilial] ?? ''),
    cliente_id:     row[cfg.campoCliente] ? String(row[cfg.campoCliente]) : null,
    data_pedido:    row[cfg.campoDataPedido] || null,
    origem:         row.ORIG_PED ? String(row.ORIG_PED).trim() : null,
    data_alteracao: row[cfg.campoDataAlter] || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.pedidos', cabecalhos);

  // Sincroniza itens dos pedidos alterados — chave composta (filial + número
  // + série) evita buscar um superconjunto: o mesmo PEDI_PED+SERI_PED se
  // repete em filiais diferentes. Oracle limita IN a 1000, pagina em lotes.
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const placeholders = chunk.map((_, j) => `(:emp${j}, :ped${j}, :ser${j})`).join(', ');
    const bindIds = {};
    chunk.forEach((row, j) => {
      bindIds[`emp${j}`] = row[cfg.campoFilial];
      bindIds[`ped${j}`] = row[cfg.campoPedidoId];
      bindIds[`ser${j}`] = row[cfg.campoPedidoSerie];
    });
    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE (${cfg.campoItemFilial}, ${cfg.campoItemPedidoId}, ${cfg.campoItemSerie}) IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id:         `${row[cfg.campoItemFilial]}_${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemSerie]}_${row[cfg.campoItemSeq]}`,
      pedido_id:  `${row[cfg.campoItemFilial]}_${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemSerie]}`,
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
