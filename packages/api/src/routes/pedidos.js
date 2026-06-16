'use strict';
const svc = require('../services/pedidos');

module.exports = async function (fastify) {
  fastify.get('/pedidos', async (req) => {
    const { filialId, clienteId, status, dataInicio, dataFim, page, pageSize } = req.query;
    return svc.listar({ filialId, clienteId, status, dataInicio, dataFim,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 100, 500) });
  });

  fastify.get('/pedidos/:id/itens', async (req, reply) => {
    const itens = await svc.buscarItens(req.params.id);
    if (!itens.length) return reply.code(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND' });
    return { data: itens };
  });
};
