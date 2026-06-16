'use strict';
const svc = require('../services/financeiro');

module.exports = async function (fastify) {
  fastify.get('/financeiro', async (req) => {
    const { tipo, filialId, status, vencimentoDe, vencimentoAte, page, pageSize } = req.query;
    return svc.listar({ tipo, filialId, status, vencimentoDe, vencimentoAte,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 100, 500) });
  });

  fastify.get('/financeiro/fluxo-caixa', async (req, reply) => {
    const { dataInicio, dataFim, filialId } = req.query;
    if (!dataInicio || !dataFim) {
      return reply.code(400).send({ error: 'dataInicio e dataFim são obrigatórios', code: 'MISSING_PARAMS' });
    }
    return svc.fluxoCaixa({ dataInicio, dataFim, filialId });
  });
};
