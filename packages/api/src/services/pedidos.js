'use strict';
/**
 * services/pedidos.js
 *
 * Lógica de negócio para Pedidos de Venda.
 *
 * Fonte de dados: raw.pedidos + raw.pedidos_itens + raw.faturamento_itens
 *
 * Status financeiro (SITU_PED): 0=Não Lib | 1=Liberado | 5=Confirmado | 9=Cancelado
 * Status comercial: calculado em calcularSaldo() comparando IPEDIDO vs INOTA
 * Origem (ORIG_PED): null=ERP direto | S=CRM | M=Mobile
 *
 * Funções exportadas:
 *   listar()            — lista paginada com filtros (inclui origem)
 *   buscarPorId()       — pedido completo com itens e princípios ativos
 *   listarItens()       — itens de pedido com filtros por produto/grupo/PA
 *   resumo()            — totais por período + breakdown de status e origem
 *   buscarFaturamento() — NFs geradas a partir do pedido (via faturamento_itens.pedido_id)
 *   calcularSaldo()     — saldo por produto (qtde pedida - qtde faturada) + status comercial
 */
const db = require('../db/postgres');

const SELECT_PED = `
  p.id,
  p.filial_id,
  p.cliente_id,
  p.data_pedido,
  p.origem,
  p._dados->>'PEDI_PED'           AS numero_pedido,
  p._dados->>'SERI_PED'           AS serie,
  p._dados->>'COD1_PES'           AS vendedor_id,
  p._dados->>'SITU_PED'           AS status,
  (p._dados->>'TOTA_PED')::NUMERIC AS valor_total,
  p._sync_at
`;

function buildProdutoExists(conds, params, { grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId }) {
  if (!grupoId && !subgrupoId && !produtoId && !principioAtivoId && !principioAtivoRecId) return;

  const innerConds = ['pi2.pedido_id = p.id'];
  if (produtoId) { params.push(produtoId); innerConds.push(`pi2.produto_id = $${params.length}`); }

  const needProdJoin = grupoId || subgrupoId || principioAtivoId;
  if (needProdJoin) {
    innerConds.push('pr2.id = pi2.produto_id');
    if (grupoId)          { params.push(grupoId);          innerConds.push(`pr2._dados->>'CODI_GPR' = $${params.length}`); }
    if (subgrupoId)       { params.push(subgrupoId);       innerConds.push(`pr2._dados->>'CODI_SBG' = $${params.length}`); }
    if (principioAtivoId) { params.push(principioAtivoId); innerConds.push(`pr2._dados->>'CODI_PRI' = $${params.length}`); }
  }

  if (principioAtivoRecId) {
    params.push(principioAtivoRecId);
    innerConds.push(`EXISTS (
      SELECT 1 FROM raw.produto_principio_ativo_rec ppar
      WHERE ppar.produto_id = pi2.produto_id AND ppar.principio_id = $${params.length}
    )`);
  }

  const baseJoin = needProdJoin
    ? 'raw.pedidos_itens pi2 JOIN raw.produtos pr2 ON pr2.id = pi2.produto_id'
    : 'raw.pedidos_itens pi2';

  conds.push(`EXISTS (SELECT 1 FROM ${baseJoin} WHERE ${innerConds.join(' AND ')})`);
}

async function listar({
  dataInicio, dataFim, filialId, clienteId, vendedorId, status, origem,
  grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
  page = 1, pageSize = 100,
}) {
  const conds = [];
  const params = [];

  if (dataInicio) { params.push(dataInicio); conds.push(`p.data_pedido >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conds.push(`p.data_pedido <= $${params.length}`); }
  if (filialId)   { params.push(filialId);   conds.push(`p.filial_id = $${params.length}`); }
  if (clienteId)  { params.push(clienteId);  conds.push(`p.cliente_id = $${params.length}`); }
  if (vendedorId) { params.push(vendedorId); conds.push(`p._dados->>'COD1_PES' = $${params.length}`); }
  if (status)     { params.push(status);     conds.push(`p._dados->>'SITU_PED' = $${params.length}`); }
  if (origem)     { params.push(origem);     conds.push(`p.origem = $${params.length}`); }

  buildProdutoExists(conds, params, { grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId });

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT ${SELECT_PED}
       FROM raw.pedidos p
       ${where}
       ORDER BY p.data_pedido DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.pedidos p ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function buscarPorId(id) {
  const [pedRes, itensRes] = await Promise.all([
    db.query(`SELECT ${SELECT_PED} FROM raw.pedidos p WHERE p.id = $1`, [id]),
    db.query(
      `SELECT
         pi.id,
         pi.pedido_id,
         pi.produto_id,
         pi._dados->>'ITEM_IPE'            AS seq,
         (pi._dados->>'QTDE_IPE')::NUMERIC AS quantidade,
         (pi._dados->>'VLOR_IPE')::NUMERIC AS valor_unitario,
         (pi._dados->>'QTDE_IPE')::NUMERIC
           * (pi._dados->>'VLOR_IPE')::NUMERIC AS valor_total,
         pr.descricao                       AS produto_desc,
         pr._dados->>'UNID_PSV'             AS unidade,
         pr._dados->>'CODI_GPR'             AS grupo_id,
         g.descricao                        AS grupo_desc,
         pr._dados->>'CODI_SBG'             AS subgrupo_id,
         pr._dados->>'CODI_PRI'             AS principio_ativo_id,
         pa.descricao                       AS principio_ativo_desc,
         par.principio_id                   AS principio_ativo_rec_id,
         par2.descricao                     AS principio_ativo_rec_desc
       FROM raw.pedidos_itens pi
       LEFT JOIN raw.produtos                    pr   ON pr.id   = pi.produto_id
       LEFT JOIN raw.grupos                      g    ON g.id    = pr._dados->>'CODI_GPR'
       LEFT JOIN raw.principios_ativos           pa   ON pa.id   = pr._dados->>'CODI_PRI'
       LEFT JOIN raw.produto_principio_ativo_rec par  ON par.produto_id = pi.produto_id
       LEFT JOIN raw.principios_ativos_rec       par2 ON par2.id = par.principio_id
       WHERE pi.pedido_id = $1
       ORDER BY (pi._dados->>'ITEM_IPE')::INT NULLS LAST`,
      [id],
    ),
  ]);

  if (!pedRes.rows.length) return null;
  return { ...pedRes.rows[0], itens: itensRes.rows };
}

async function listarItens({
  dataInicio, dataFim, filialId, clienteId, vendedorId, status, origem,
  grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
  page = 1, pageSize = 200,
}) {
  const conds = [];
  const params = [];

  if (dataInicio)       { params.push(dataInicio);       conds.push(`p.data_pedido >= $${params.length}`); }
  if (dataFim)          { params.push(dataFim);          conds.push(`p.data_pedido <= $${params.length}`); }
  if (filialId)         { params.push(filialId);         conds.push(`p.filial_id = $${params.length}`); }
  if (clienteId)        { params.push(clienteId);        conds.push(`p.cliente_id = $${params.length}`); }
  if (vendedorId)       { params.push(vendedorId);       conds.push(`p._dados->>'COD1_PES' = $${params.length}`); }
  if (status)           { params.push(status);           conds.push(`p._dados->>'SITU_PED' = $${params.length}`); }
  if (origem)           { params.push(origem);           conds.push(`p.origem = $${params.length}`); }
  if (grupoId)          { params.push(grupoId);          conds.push(`pr._dados->>'CODI_GPR' = $${params.length}`); }
  if (subgrupoId)       { params.push(subgrupoId);       conds.push(`pr._dados->>'CODI_SBG' = $${params.length}`); }
  if (produtoId)        { params.push(produtoId);        conds.push(`pi.produto_id = $${params.length}`); }
  if (principioAtivoId) { params.push(principioAtivoId); conds.push(`pr._dados->>'CODI_PRI' = $${params.length}`); }
  if (principioAtivoRecId) {
    params.push(principioAtivoRecId);
    conds.push(`EXISTS (
      SELECT 1 FROM raw.produto_principio_ativo_rec ppar
      WHERE ppar.produto_id = pi.produto_id AND ppar.principio_id = $${params.length}
    )`);
  }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         pi.id,
         pi.pedido_id,
         pi.produto_id,
         pi._dados->>'ITEM_IPE'            AS seq,
         (pi._dados->>'QTDE_IPE')::NUMERIC AS quantidade,
         (pi._dados->>'VLOR_IPE')::NUMERIC AS valor_unitario,
         (pi._dados->>'QTDE_IPE')::NUMERIC
           * (pi._dados->>'VLOR_IPE')::NUMERIC AS valor_total,
         pr.descricao                       AS produto_desc,
         pr._dados->>'UNID_PSV'             AS unidade,
         pr._dados->>'CODI_GPR'             AS grupo_id,
         g.descricao                        AS grupo_desc,
         pr._dados->>'CODI_SBG'             AS subgrupo_id,
         pr._dados->>'CODI_PRI'             AS principio_ativo_id,
         pa.descricao                       AS principio_ativo_desc,
         par.principio_id                   AS principio_ativo_rec_id,
         par2.descricao                     AS principio_ativo_rec_desc,
         p.filial_id,
         p.cliente_id,
         p.data_pedido,
         p.origem,
         p._dados->>'PEDI_PED'              AS numero_pedido,
         p._dados->>'SERI_PED'              AS serie,
         p._dados->>'COD1_PES'              AS vendedor_id,
         p._dados->>'SITU_PED'              AS status
       FROM raw.pedidos_itens pi
       JOIN raw.pedidos p ON p.id = pi.pedido_id
       LEFT JOIN raw.produtos                    pr   ON pr.id   = pi.produto_id
       LEFT JOIN raw.grupos                      g    ON g.id    = pr._dados->>'CODI_GPR'
       LEFT JOIN raw.principios_ativos           pa   ON pa.id   = pr._dados->>'CODI_PRI'
       LEFT JOIN raw.produto_principio_ativo_rec par  ON par.produto_id = pi.produto_id
       LEFT JOIN raw.principios_ativos_rec       par2 ON par2.id = par.principio_id
       ${where}
       ORDER BY p.data_pedido DESC, pi.pedido_id, (pi._dados->>'ITEM_IPE')::INT NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::INT AS total
       FROM raw.pedidos_itens pi
       JOIN raw.pedidos p ON p.id = pi.pedido_id
       LEFT JOIN raw.produtos pr ON pr.id = pi.produto_id
       ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function resumo({ agrupamento = 'mes', filialId, dataInicio, dataFim, status, origem }) {
  const conds = [];
  const params = [];

  if (filialId)  { params.push(filialId);  conds.push(`filial_id = $${params.length}`); }
  if (dataInicio){ params.push(dataInicio); conds.push(`data_pedido >= $${params.length}`); }
  if (dataFim)   { params.push(dataFim);   conds.push(`data_pedido <= $${params.length}`); }
  if (status)    { params.push(status);    conds.push(`_dados->>'SITU_PED' = $${params.length}`); }
  if (origem)    { params.push(origem);    conds.push(`origem = $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const trunc = agrupamento === 'dia'       ? `DATE_TRUNC('day',     data_pedido)`
              : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', data_pedido)`
              : agrupamento === 'ano'       ? `DATE_TRUNC('year',    data_pedido)`
              :                              `DATE_TRUNC('month',    data_pedido)`;

  const res = await db.query(
    `SELECT
       ${trunc}                                AS periodo,
       filial_id,
       COUNT(*)::INT                          AS quantidade,
       SUM((_dados->>'TOTA_PED')::NUMERIC)    AS valor_total,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '0')::INT AS nao_liberados,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '1')::INT AS liberados,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '5')::INT AS confirmados,
       COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '9')::INT AS cancelados,
       COUNT(*) FILTER (WHERE origem = 'S')::INT              AS do_crm,
       COUNT(*) FILTER (WHERE origem IS NULL)::INT            AS do_erp
     FROM raw.pedidos
     ${where}
     GROUP BY periodo, filial_id
     ORDER BY periodo DESC, filial_id`,
    params,
  );

  return { data: res.rows };
}

// NFs geradas a partir de um pedido específico
async function buscarFaturamento(pedidoId) {
  const res = await db.query(
    `SELECT DISTINCT
       f.id,
       f.filial_id,
       f.data_emissao,
       f.tran_top,
       f.tipo_top,
       f.operacao_id,
       f._dados->>'NOTA_NOT'            AS numero_nf,
       f._dados->>'SERI_NOT'            AS serie,
       f._dados->>'CODI_TRA'            AS cliente_id,
       f._dados->>'COD1_PES'            AS vendedor_id,
       f._dados->>'DSAI_NOT'            AS data_saida,
       f._dados->>'SITU_NOT'            AS status,
       f._dados->>'DESC_TOP'            AS operacao_desc,
       (f._dados->>'TOTA_NOT')::NUMERIC AS valor_total,
       f._sync_at
     FROM raw.faturamento f
     WHERE f.id IN (
       SELECT DISTINCT nf_id
       FROM raw.faturamento_itens
       WHERE pedido_id = $1
     )
     ORDER BY f.data_emissao, f.id`,
    [pedidoId],
  );
  return { data: res.rows };
}

// Saldo do pedido: compara itens pedidos (IPEDIDO) vs itens faturados (INOTA)
// Deriva status comercial: ABERTO / FATURADO_PARCIALMENTE / FATURADO_INTEGRAL
async function calcularSaldo(pedidoId) {
  const [pedRes, saldoRes] = await Promise.all([
    db.query(
      `SELECT id, _dados->>'PEDI_PED' AS numero_pedido, _dados->>'SITU_PED' AS status,
              origem, (p._dados->>'TOTA_PED')::NUMERIC AS valor_total_pedido
       FROM raw.pedidos p WHERE id = $1`,
      [pedidoId],
    ),
    db.query(
      `WITH itens_pedido AS (
         SELECT
           pi.produto_id,
           SUM((pi._dados->>'QTDE_IPE')::NUMERIC)                              AS qtde_pedida,
           AVG((pi._dados->>'VLOR_IPE')::NUMERIC)                              AS valor_unitario,
           SUM((pi._dados->>'QTDE_IPE')::NUMERIC * (pi._dados->>'VLOR_IPE')::NUMERIC) AS valor_pedido
         FROM raw.pedidos_itens pi
         WHERE pi.pedido_id = $1
         GROUP BY pi.produto_id
       ),
       itens_faturados AS (
         SELECT
           fi.produto_id,
           SUM((fi._dados->>'QTDE_INO')::NUMERIC)                              AS qtde_faturada,
           SUM((fi._dados->>'QTDE_INO')::NUMERIC * (fi._dados->>'VLOR_INO')::NUMERIC) AS valor_faturado
         FROM raw.faturamento_itens fi
         WHERE fi.pedido_id = $1
         GROUP BY fi.produto_id
       )
       SELECT
         ip.produto_id,
         pr.descricao                    AS produto_desc,
         pr._dados->>'UNID_PSV'          AS unidade,
         pr._dados->>'CODI_GPR'          AS grupo_id,
         g.descricao                     AS grupo_desc,
         pr._dados->>'CODI_SBG'          AS subgrupo_id,
         ip.qtde_pedida,
         COALESCE(ifa.qtde_faturada, 0)  AS qtde_faturada,
         ip.qtde_pedida - COALESCE(ifa.qtde_faturada, 0) AS qtde_saldo,
         ip.valor_unitario,
         ip.valor_pedido,
         COALESCE(ifa.valor_faturado, 0) AS valor_faturado,
         ip.valor_pedido - COALESCE(ifa.valor_faturado, 0) AS valor_saldo
       FROM itens_pedido ip
       LEFT JOIN itens_faturados ifa ON ifa.produto_id = ip.produto_id
       LEFT JOIN raw.produtos pr ON pr.id = ip.produto_id
       LEFT JOIN raw.grupos   g  ON g.id  = pr._dados->>'CODI_GPR'
       ORDER BY pr.descricao`,
      [pedidoId],
    ),
  ]);

  if (!pedRes.rows.length) return null;

  const itens = saldoRes.rows;
  const totalFaturado = itens.reduce((s, i) => s + Number(i.valor_faturado ?? 0), 0);
  const totalSaldo    = itens.reduce((s, i) => s + Number(i.valor_saldo ?? 0), 0);

  const tudoFaturado = itens.every((i) => Number(i.qtde_saldo) <= 0);
  const nadaFaturado = itens.every((i) => Number(i.qtde_faturada) === 0);
  const statusComercial = tudoFaturado ? 'FATURADO_INTEGRAL'
                        : nadaFaturado ? 'ABERTO'
                        : 'FATURADO_PARCIALMENTE';

  const itensComStatus = itens.map((i) => ({
    ...i,
    status_item: Number(i.qtde_saldo) <= 0    ? 'FATURADO_INTEGRAL'
               : Number(i.qtde_faturada) === 0 ? 'ABERTO'
               : 'FATURADO_PARCIALMENTE',
  }));

  return {
    ...pedRes.rows[0],
    status_comercial: statusComercial,
    valor_total_faturado: totalFaturado,
    valor_saldo: totalSaldo,
    itens: itensComStatus,
  };
}

module.exports = { listar, buscarPorId, listarItens, resumo, buscarFaturamento, calcularSaldo };
