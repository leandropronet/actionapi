'use strict';
/**
 * jobs/faturamento.js
 *
 * ETL incremental de Notas Fiscais (NOTA + INOTA + TIPOOPER).
 *
 * Tabelas Oracle:
 *   NOTA    — cabeçalho da NF (NPRE_NOT = PK interna, NOTA_NOT = número visível)
 *   INOTA   — itens da NF (FK: NPRE_NOT; contém PEDI_PED/SERI_PED → link ao pedido)
 *   TIPOOPER — operação fiscal (traz TRAN_TOP: 1=Entrada, 2=Saída, 3=Transferência)
 *
 * Tabelas PostgreSQL:
 *   raw.faturamento       — um registro por NF, com pedido_id quando gerada por pedido
 *   raw.faturamento_itens — itens com pedido_id (backfillado de _dados.PEDI_PED)
 *
 * Para relatórios de vendas: filtrar tran_top = '2' (saídas).
 * O link NF → Pedido fica em: faturamento_itens.pedido_id = pedidos.id
 * pedido_id = "{CODI_EMP}_{PEDI_PED}_{SERI_PED}" — mesma filial da NF, que é
 * sempre a mesma do pedido de origem (PEDI_PED+SERI_PED não é único entre
 * filiais — ver nota em jobs/pedidos.js).
 *
 * Nota: NFs no SiAGRI nunca são excluídas — apenas canceladas (SITU_NOT=9),
 *   desfeitas ou devolvidas. Por isso, não há reconciliação para este módulo.
 */
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').faturamento;
const cfgOp = require('../oracle-config').operacoes;

async function sincronizar() {
  const ultimoSync = await lerUltimoSync('faturamento');
  console.log(`[faturamento] sync incremental desde ${ultimoSync.toISOString()}`);

  // JOIN com TIPOOPER para trazer TRAN_TOP (1=Entrada, 2=Saída, 3=Transferência)
  // e TIPO_TOP (E=Entrada, S=Saída) — essencial para filtrar vendas vs devoluções
  const sql = `
    SELECT
      N.${cfg.campoId}          AS NPRE_NOT,
      N.${cfg.campoFilial}      AS CODI_EMP,
      N.${cfg.campoCliente}     AS CODI_TRA,
      N.${cfg.campoVendedor}    AS COD1_PES,
      N.${cfg.campoDataEmissao} AS DEMI_NOT,
      N.${cfg.campoDataSaida}   AS DSAI_NOT,
      N.${cfg.campoNumeroNF}    AS NOTA_NOT,
      N.${cfg.campoSerie}       AS SERI_NOT,
      N.${cfg.campoTotal}       AS TOTA_NOT,
      N.${cfg.campoStatus}      AS SITU_NOT,
      N.${cfg.campoOperacao}    AS CODI_TOP,
      N.${cfg.campoDataAlter}   AS DUMANUT,
      N.PEDI_PED                AS PEDI_PED,
      N.SERI_PED                AS SERI_PED,
      T.${cfgOp.campoTran}      AS TRAN_TOP,
      T.${cfgOp.campoTipo}      AS TIPO_TOP,
      T.${cfgOp.campoTemplate}  AS CODI_TPL,
      T.${cfgOp.campoDesc}      AS DESC_TOP
    FROM ${cfg.schema}.${cfg.tabela} N
    LEFT JOIN ${cfgOp.schema}.${cfgOp.tabela} T
      ON T.${cfgOp.campoId} = N.${cfg.campoOperacao}
    WHERE N.${cfg.campoDataAlter} > :ultimoSync
    ORDER BY N.${cfg.campoDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[faturamento] sem registros novos');
    return;
  }

  const registros = rows.map((row) => ({
    id:             String(row.NPRE_NOT),
    filial_id:      String(row.CODI_EMP ?? ''),
    data_emissao:   row.DEMI_NOT || null,
    operacao_id:    row.CODI_TOP ? String(row.CODI_TOP) : null,
    // TRAN_TOP: 1=Entrada, 2=Saída (vendas), 3=Transferência
    tran_top:       row.TRAN_TOP ? String(row.TRAN_TOP).trim() : null,
    // TIPO_TOP: S=Saída (venda), E=Entrada (devolução de venda)
    tipo_top:       row.TIPO_TOP ? String(row.TIPO_TOP).trim() : null,
    pedido_id:      row.PEDI_PED && row.SERI_PED ? `${row.CODI_EMP}_${row.PEDI_PED}_${row.SERI_PED}` : null,
    data_alteracao: row.DUMANUT || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.faturamento', registros);

  // Sincroniza itens das NFs alteradas — Oracle limita IN a 1000, pagina em lotes
  // INOTA não tem CODI_EMP — usa a filial do cabeçalho (mesma NF) para montar pedido_id.
  const filialPorNf = new Map(rows.map((r) => [String(r.NPRE_NOT), r.CODI_EMP]));
  const ids = rows.map((r) => r.NPRE_NOT).filter(Boolean);
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const placeholders = chunk.map((_, j) => `:id${j}`).join(', ');
    const bindIds = Object.fromEntries(chunk.map((id, j) => [`id${j}`, id]));
    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE ${cfg.campoItemNfId} IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => {
      const filial = filialPorNf.get(String(row[cfg.campoItemNfId]));
      return {
        id:         `${row[cfg.campoItemNfId]}_${row[cfg.campoItemSeq]}`,
        nf_id:      String(row[cfg.campoItemNfId]),
        produto_id: row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
        pedido_id:  row.PEDI_PED && row.SERI_PED ? `${filial}_${row.PEDI_PED}_${row.SERI_PED}` : null,
        _dados:     JSON.stringify(row),
        _source:    'siagri',
      };
    });
    if (itens.length) await upsertRaw('raw.faturamento_itens', itens);
  }

  await atualizarSync('faturamento');
  console.log(`[faturamento] ${registros.length} NFs sincronizadas`);
}

module.exports = { sincronizar };
