'use strict';
/**
 * routes/pedidos_compra.js
 *
 * GET /api/v1/pedidos-compra               — cabeçalhos com filtros
 * GET /api/v1/pedidos-compra/itens-abertos — itens com saldo pendente de recebimento
 * GET /api/v1/pedidos-compra/resumo        — valor em aberto agregado por filial/fornecedor
 * GET /api/v1/pedidos-compra/:id           — pedido completo (itens + parcelas)
 *
 * Filtros: filialId, fornecedorId, status (P=Pendente, A=Aprovado, C=Cancelado),
 *   dataInicio/dataFim (sobre data do pedido), produtoId (em /itens-abertos),
 *   incluirCancelados=true (inclui status=C no saldo em aberto, padrão: false)
 */
const svc = require('../services/pedidos_compra');

module.exports = async function (fastify) {
  fastify.get('/pedidos-compra/itens-abertos', async (req) => {
    const { filialId, fornecedorId, produtoId, incluirCancelados, page, pageSize } = req.query;
    return svc.itensAbertos({
      filialId, fornecedorId, produtoId,
      incluirCancelados: incluirCancelados === 'true',
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });

  fastify.get('/pedidos-compra/resumo', async (req) => {
    const { filialId, fornecedorId, incluirCancelados } = req.query;
    return svc.resumo({
      filialId, fornecedorId,
      incluirCancelados: incluirCancelados === 'true',
    });
  });

  fastify.get('/pedidos-compra', async (req) => {
    const { filialId, fornecedorId, status, dataInicio, dataFim, page, pageSize } = req.query;
    return svc.listar({
      filialId, fornecedorId, status, dataInicio, dataFim,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  fastify.get('/pedidos-compra/:id', async (req, reply) => {
    const pedido = await svc.buscarPorId(req.params.id);
    if (!pedido) return reply.code(404).send({ error: 'Pedido de compra não encontrado', code: 'NOT_FOUND' });
    return pedido;
  });
};
