'use strict';
/**
 * services/estoque.js
 *
 * Saldo de estoque por produto/filial/depósito (snapshot em tempo real).
 *
 * Fonte de dados: raw.estoque — sincronizado da view Oracle CCSALDO.
 * A view já consolida saldo por produto, filial e tipo de controle (CODI_CTR).
 *   CODI_CTR = 1 → Estoque Físico (posição atual disponível)
 *   CODI_CTR = 3 → Pedido de Venda não entregue (reservado)
 *
 * Para saldo por LOTE com data de validade, use raw.saldo_lote
 * (serviço: services/lotes.js, rota: GET /api/v1/lotes).
 *
 * Funções exportadas:
 *   listar() — posição de estoque com filtros de filial, produto e depósito
 */
const db = require('../db/postgres');

async function listar({ filialId, produtoId, depositoId, page = 1, pageSize = 200 }) {
  const conditions = [];
  const params = [];

  if (filialId)   { params.push(filialId);   conditions.push(`filial_id = $${params.length}`); }
  if (produtoId)  { params.push(produtoId);  conditions.push(`produto_id = $${params.length}`); }
  if (depositoId) { params.push(depositoId); conditions.push(`deposito_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, filial_id, produto_id, deposito_id, data_posicao, _dados, _sync_at
       FROM raw.estoque ${where}
       ORDER BY produto_id, filial_id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.estoque ${where}`, params),
  ]);

  return {
    data: dataRes.rows,
    total: countRes.rows[0].total,
    page,
    pageSize,
    syncedAt: dataRes.rows[0]?._sync_at || null,
  };
}

module.exports = { listar };
