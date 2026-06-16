'use strict';
const svc = require('../services/faturamento');

module.exports = async function (fastify) {
  fastify.get('/faturamento', async (req) => {
    const { dataInicio, dataFim, filialId, clienteId, page, pageSize } = req.query;
    return svc.listar({ dataInicio, dataFim, filialId, clienteId,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 100, 500) });
  });

  fastify.get('/faturamento/resumo', async (req) => {
    const { agrupamento, filialId, dataInicio, dataFim } = req.query;
    return svc.resumo({ agrupamento, filialId, dataInicio, dataFim });
  });
};
