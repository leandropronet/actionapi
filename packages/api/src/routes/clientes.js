'use strict';
const svc = require('../services/clientes');

module.exports = async function (fastify) {
  fastify.get('/clientes', async (req) => {
    const { search, page, pageSize } = req.query;
    return svc.listar({ search, page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 100, 500) });
  });

  fastify.get('/clientes/:id', async (req, reply) => {
    const cliente = await svc.buscar(req.params.id);
    if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND' });
    return cliente;
  });

  fastify.get('/clientes/:id/historico-compras', async (req) => {
    const { dataInicio, dataFim, page, pageSize } = req.query;
    return svc.historicoCompras(req.params.id, {
      dataInicio, dataFim,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });
};
