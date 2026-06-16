'use strict';
const svc = require('../services/estoque');

module.exports = async function (fastify) {
  fastify.get('/estoque', async (req) => {
    const { filialId, produtoId, depositoId, page, pageSize } = req.query;
    return svc.listar({ filialId, produtoId, depositoId,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 200, 1000) });
  });
};
