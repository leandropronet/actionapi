'use strict';
const svc = require('../services/contabil');

module.exports = async function (fastify) {
  fastify.get('/contabil', async (req) => {
    const { filialId, competencia, conta, centroCusto, page, pageSize } = req.query;
    return svc.listar({ filialId, competencia, conta, centroCusto,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 200, 1000) });
  });

  fastify.get('/contabil/saldo-contas', async (req, reply) => {
    const { filialId, competencia } = req.query;
    if (!competencia) {
      return reply.code(400).send({ error: 'competencia é obrigatória (AAAA-MM)', code: 'MISSING_PARAMS' });
    }
    return svc.saldoContas({ filialId, competencia });
  });
};
