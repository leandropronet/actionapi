'use strict';
/**
 * services/pedidos_compra.js
 *
 * Pedidos de Compra do SiAGRI (PEDCOM + IPEDCOM + PARCPEDCOM).
 *
 * Tabelas: raw.pedidos_compra | raw.pedidos_compra_itens | raw.pedidos_compra_parcelas
 *
 * status (STAT_PEC): P=Pendente, A=Aprovado, C=Cancelado — significado inferido
 *   por amostra Oracle (jun/2026), não confirmado em documentação do SiAGRI.
 *   Compare com o relatório de pedidos de compra do ERP antes de usar em produção.
 *
 * Saldo em aberto de um item = qtd_pedida - qtd_recebida. Pedidos cancelados
 * (status='C') são excluídos por padrão do saldo em aberto: ficam com
 * qtd_recebida=0 mesmo sem expectativa real de recebimento.
 *
 * Nome do fornecedor: raw.fornecedores (TRANSAC com FORN_TRA='S'), com
 * fallback para raw.clientes — um parceiro pode ser cliente e fornecedor.
 *
 * Vínculo com Contas a Pagar — PEDCOM → INFENTRA (EMPR_PEC+NUME_PEC =
 * recebimento do item, via _dados) → NFENTRA → CABPAGAR (via
 * raw.financeiro_titulos.nf_entrada_id, preenchido no ETL a partir de
 * NOTACPG.CTRL_NCP — FK real do Oracle para NFENTRA.CTRL_NFE, validada com
 * 98,4% de integridade em 2026-06). Cobre títulos originados de NF de
 * compra (~91% dos tipos "FORNECEDOR - COMPRA"/"USO-CONS-COMBUSTÍVEL").
 * Não cobre Adiantamento a Fornecedor (paga antes de existir NF) — nesses
 * casos o "número de pedido" no histórico não corresponde a nenhum
 * PEDCOM/SOLICOMPRA real nesta base; sem link estruturado encontrado ainda.
 *
 * Funções exportadas:
 *   listar()       — cabeçalhos de pedidos de compra com filtros
 *   itensAbertos() — itens com saldo pendente de recebimento
 *   resumo()       — valor em aberto agregado por filial e/ou fornecedor
 *   buscarPorId()  — pedido completo com itens, parcelas e títulos a pagar vinculados
 */
const db = require('../db/postgres');

const FORNECEDOR_NOME = `
  COALESCE(f.razao_social, cli.razao_social)
`;
const FORNECEDOR_JOIN = `
  LEFT JOIN raw.fornecedores f ON f.id = p.fornecedor_id
  LEFT JOIN raw.clientes cli ON cli.id = p.fornecedor_id
`;

async function listar({
  filialId, fornecedorId, status, dataInicio, dataFim, page = 1, pageSize = 100,
}) {
  const conds = [];
  const params = [];

  if (filialId)      { params.push(filialId);      conds.push(`filial_id = $${params.length}`); }
  if (fornecedorId)  { params.push(fornecedorId);  conds.push(`fornecedor_id = $${params.length}`); }
  if (status)        { params.push(status);        conds.push(`status = $${params.length}`); }
  if (dataInicio)    { params.push(dataInicio);    conds.push(`data_pedido >= $${params.length}`); }
  if (dataFim)       { params.push(dataFim);       conds.push(`data_pedido <= $${params.length}`); }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         p.id, p.filial_id, p.numero, p.fornecedor_id,
         ${FORNECEDOR_NOME} AS fornecedor_nome,
         p.operacao_id, p.data_pedido, p.data_previsao, p.data_cancelamento,
         p.status, p.valor_total, p._sync_at
       FROM raw.pedidos_compra p
       ${FORNECEDOR_JOIN}
       ${where}
       ORDER BY p.data_pedido DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.pedidos_compra ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function itensAbertos({
  filialId, fornecedorId, produtoId, incluirCancelados = false, page = 1, pageSize = 200,
}) {
  const conds = ['i.qtd_pedida > i.qtd_recebida'];
  const params = [];

  if (!incluirCancelados) conds.push(`p.status <> 'C'`);
  if (filialId)     { params.push(filialId);     conds.push(`p.filial_id = $${params.length}`); }
  if (fornecedorId) { params.push(fornecedorId); conds.push(`p.fornecedor_id = $${params.length}`); }
  if (produtoId)    { params.push(produtoId);    conds.push(`i.produto_id = $${params.length}`); }

  const where  = `WHERE ${conds.join(' AND ')}`;
  const offset = (page - 1) * pageSize;

  const base = `
    FROM raw.pedidos_compra_itens i
    JOIN raw.pedidos_compra p ON p.id = i.pedido_id
    ${FORNECEDOR_JOIN}
    ${where}
  `;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         i.id, i.pedido_id, p.filial_id, p.numero,
         p.fornecedor_id, ${FORNECEDOR_NOME} AS fornecedor_nome,
         i.produto_id,
         i.qtd_pedida, i.qtd_recebida,
         (i.qtd_pedida - i.qtd_recebida)                       AS qtd_saldo,
         i.valor_unitario,
         ((i.qtd_pedida - i.qtd_recebida) * i.valor_unitario)   AS valor_saldo,
         p.status, p.data_pedido, p.data_previsao
       ${base}
       ORDER BY valor_saldo DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total ${base}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function resumo({ filialId, fornecedorId, incluirCancelados = false }) {
  const conds = ['i.qtd_pedida > i.qtd_recebida'];
  const params = [];

  if (!incluirCancelados) conds.push(`p.status <> 'C'`);
  if (filialId)     { params.push(filialId);     conds.push(`p.filial_id = $${params.length}`); }
  if (fornecedorId) { params.push(fornecedorId); conds.push(`p.fornecedor_id = $${params.length}`); }

  const where = `WHERE ${conds.join(' AND ')}`;

  const res = await db.query(
    `SELECT
       p.filial_id,
       p.fornecedor_id,
       ${FORNECEDOR_NOME}                                           AS fornecedor_nome,
       COUNT(*)::INT                                                AS qtd_itens_abertos,
       COUNT(DISTINCT p.id)::INT                                    AS qtd_pedidos,
       SUM(i.qtd_pedida - i.qtd_recebida)                           AS qtd_saldo,
       SUM((i.qtd_pedida - i.qtd_recebida) * i.valor_unitario)      AS valor_saldo
     FROM raw.pedidos_compra_itens i
     JOIN raw.pedidos_compra p ON p.id = i.pedido_id
     ${FORNECEDOR_JOIN}
     ${where}
     GROUP BY p.filial_id, p.fornecedor_id, f.razao_social, cli.razao_social
     ORDER BY valor_saldo DESC`,
    params,
  );

  return { data: res.rows };
}

async function buscarPorId(id) {
  const [pedidoRes, itensRes, parcelasRes, titulosRes] = await Promise.all([
    db.query(
      `SELECT p.*, ${FORNECEDOR_NOME} AS fornecedor_nome
       FROM raw.pedidos_compra p
       ${FORNECEDOR_JOIN}
       WHERE p.id = $1`,
      [id],
    ),
    db.query(
      `SELECT id, produto_id, qtd_pedida, qtd_recebida,
              (qtd_pedida - qtd_recebida) AS qtd_saldo, valor_unitario, valor_liquido
       FROM raw.pedidos_compra_itens WHERE pedido_id = $1 ORDER BY produto_id`,
      [id],
    ),
    db.query(
      `SELECT id, data_vencimento, valor
       FROM raw.pedidos_compra_parcelas WHERE pedido_id = $1 ORDER BY data_vencimento`,
      [id],
    ),
    // NFs de entrada que receberam itens deste pedido + título a pagar gerado
    // por cada uma (quando existir). Vínculo via raw.financeiro_titulos.nf_entrada_id
    // — FK oficial do Oracle (NOTACPG.CTRL_NCP → NFENTRA.CTRL_NFE), não heurística.
    db.query(
      `SELECT DISTINCT
         n.id AS nf_entrada_id, n._dados->>'NUME_NFE' AS numero_nf, n.data_emissao,
         t.id AS titulo_id, t.valor_total, t.status, t.data_emissao AS data_emissao_titulo
       FROM raw.nfe_entrada_itens i
       JOIN raw.nfe_entrada n ON n.id = i.nfe_entrada_id
       LEFT JOIN raw.financeiro_titulos t
         ON t.tipo = 'CP' AND t.nf_entrada_id = n.id
       WHERE (i._dados->>'EMPR_PEC') || '_' || (i._dados->>'NUME_PEC') = $1
       ORDER BY n.data_emissao`,
      [id],
    ),
  ]);

  if (!pedidoRes.rows.length) return null;

  return {
    ...pedidoRes.rows[0],
    itens: itensRes.rows,
    parcelas: parcelasRes.rows,
    notas_entrada: titulosRes.rows,
  };
}

module.exports = { listar, itensAbertos, resumo, buscarPorId };
