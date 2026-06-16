'use strict';
const svc = require('../services/duplicatas');

module.exports = async function (fastify) {
  fastify.get('/duplicatas', async (req) => {
    const { filialId, status, vencimentoDe, vencimentoAte, nfId, page, pageSize } = req.query;
    return svc.listar({ filialId, status, vencimentoDe, vencimentoAte, nfId,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 100, 500) });
  });
};
