'use strict';
/**
 * routes/estoque.js
 *
 * GET /api/v1/estoque — posição de estoque por produto/filial/depósito
 *
 * Filtros:
 *   filialId, produtoId, depositoId
 *   page, pageSize (padrão 200, máx 1000)
 *
 * Para saldo por lote com validade, use GET /api/v1/lotes.
 */
const svc = require('../services/estoque');

module.exports = async function (fastify) {
  fastify.get('/estoque', async (req) => {
    const { filialId, produtoId, depositoId, page, pageSize } = req.query;
    return svc.listar({ filialId, produtoId, depositoId,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 200, 1000) });
  });
};
