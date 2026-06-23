'use strict';
/**
 * jobs/pedidos_compra.js
 *
 * ETL incremental de Pedidos de Compra (PEDCOM + IPEDCOM + PARCPEDCOM).
 *
 * Tabelas Oracle:
 *   PEDCOM     — cabeçalho do pedido de compra; PK composta: CODI_EMP + NUME_PEC
 *   IPEDCOM    — itens; PK composta: CODI_EMP + NUME_PEC + CODI_PSV
 *   PARCPEDCOM — parcelas previstas de pagamento; PK: CTRL_PPC
 *
 * Tabelas PostgreSQL:
 *   raw.pedidos_compra          — id = "{CODI_EMP}_{NUME_PEC}"
 *   raw.pedidos_compra_itens    — id = "{CODI_EMP}_{NUME_PEC}_{CODI_PSV}"
 *   raw.pedidos_compra_parcelas — id = CTRL_PPC
 *
 * Saldo em aberto do item (não vem pronto do Oracle):
 *   qtd_pedida (QTDP_IPC) - qtd_recebida (QTDR_IPC) — calculado nas queries da API.
 *
 * Vínculo com Contas a Pagar: NÃO confirmado neste ETL. PEDCOM.NPRE_NOT é
 * capturado em _dados para investigação futura, mas a API não tenta cruzar
 * automaticamente com raw.financeiro_titulos — comparar com relatórios do
 * SiAGRI antes de assumir esse vínculo em produção.
 *
 * Incremental por DUMANUT (Data/Hora Última Manutenção).
 */
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').pedidosCompra;

async function sincronizar() {
  const ultimoSync = await lerUltimoSync('pedidos_compra');
  console.log(`[pedidos_compra] sync incremental desde ${ultimoSync.toISOString()}`);

  const sql = `
    SELECT *
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${cfg.campoDataAlter} > :ultimoSync
    ORDER BY ${cfg.campoDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[pedidos_compra] sem registros novos');
    return;
  }

  const cabecalhos = rows.map((row) => ({
    // PK composta: filial + número do pedido
    id:                `${row[cfg.campoFilial]}_${row[cfg.campoPedidoId]}`,
    filial_id:         String(row[cfg.campoFilial] ?? ''),
    numero:            row[cfg.campoPedidoId] != null ? String(row[cfg.campoPedidoId]) : null,
    fornecedor_id:     row[cfg.campoFornecedor] ? String(row[cfg.campoFornecedor]) : null,
    operacao_id:       row[cfg.campoOperacao] ? String(row[cfg.campoOperacao]) : null,
    data_pedido:       row[cfg.campoDataPedido] || null,
    data_previsao:     row[cfg.campoDataPrevisao] || null,
    data_cancelamento: row[cfg.campoDataCancel] || null,
    status:            row[cfg.campoStatus] ? String(row[cfg.campoStatus]).trim() : null,
    valor_total:       row[cfg.campoTotal] ?? null,
    data_alteracao:    row[cfg.campoDataAlter] || null,
    _dados:            JSON.stringify(row),
    _source:           'siagri',
  }));

  await upsertRaw('raw.pedidos_compra', cabecalhos);

  // Sincroniza itens e parcelas dos pedidos alterados — Oracle limita IN a 1000
  const filiais = rows.map((r) => r[cfg.campoFilial]);
  const numeros = rows.map((r) => r[cfg.campoPedidoId]);
  for (let i = 0; i < rows.length; i += 1000) {
    const chunkFiliais = filiais.slice(i, i + 1000);
    const chunkNumeros = numeros.slice(i, i + 1000);
    const placeholders = chunkNumeros.map((_, j) => `(:emp${j}, :ped${j})`).join(', ');
    const bindIds = {};
    chunkFiliais.forEach((emp, j) => { bindIds[`emp${j}`] = emp; });
    chunkNumeros.forEach((ped, j) => { bindIds[`ped${j}`] = ped; });

    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE (${cfg.campoItemFilial}, ${cfg.campoItemPedidoId}) IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id:             `${row[cfg.campoItemFilial]}_${row[cfg.campoItemPedidoId]}_${row[cfg.campoItemProduto]}`,
      pedido_id:      `${row[cfg.campoItemFilial]}_${row[cfg.campoItemPedidoId]}`,
      produto_id:     row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
      qtd_pedida:     row[cfg.campoItemQtdPedida] ?? null,
      qtd_recebida:   row[cfg.campoItemQtdReceb] ?? null,
      valor_unitario: row[cfg.campoItemValorUnit] ?? null,
      valor_liquido:  row[cfg.campoItemValorLiq] ?? null,
      data_alteracao: row[cfg.campoItemDataAlter] || null,
      _dados:         JSON.stringify(row),
      _source:        'siagri',
    }));
    if (itens.length) await upsertRaw('raw.pedidos_compra_itens', itens);

    const sqlParcelas = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaParcelas}
      WHERE (${cfg.campoParcelaFilial}, ${cfg.campoParcelaPedidoId}) IN (${placeholders})
    `;
    const resultParcelas = await oracle.query(sqlParcelas, bindIds);
    const parcelas = (resultParcelas.rows || []).map((row) => ({
      id:             String(row[cfg.campoParcelaId]),
      pedido_id:      `${row[cfg.campoParcelaFilial]}_${row[cfg.campoParcelaPedidoId]}`,
      data_vencimento: row[cfg.campoParcelaVenc] || null,
      valor:          row[cfg.campoParcelaValor] ?? null,
      data_alteracao: row[cfg.campoParcelaDataAlter] || null,
      _dados:         JSON.stringify(row),
      _source:        'siagri',
    }));
    if (parcelas.length) await upsertRaw('raw.pedidos_compra_parcelas', parcelas);
  }

  await atualizarSync('pedidos_compra');
  console.log(`[pedidos_compra] ${cabecalhos.length} pedidos de compra sincronizados`);
}

module.exports = { sincronizar };
