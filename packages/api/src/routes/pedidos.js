'use strict';
const svc = require('../services/pedidos');

module.exports = async function (fastify) {
  // GET /api/v1/pedidos
  // Filtros: dataInicio, dataFim, filialId, clienteId, vendedorId,
  //          status (0=Não Liberado 1=Liberado 5=Confirmado 9=Cancelado),
  //          grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId
  fastify.get('/pedidos', async (req) => {
    const {
      dataInicio, dataFim, filialId, clienteId, vendedorId, status,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page, pageSize,
    } = req.query;

    return svc.listar({
      dataInicio, dataFim, filialId, clienteId, vendedorId, status,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  // GET /api/v1/pedidos/resumo
  // Filtros: agrupamento (dia/mes/trimestre/ano), filialId, dataInicio, dataFim, status
  // Retorna contagens por status (nao_liberados, liberados, confirmados, cancelados)
  fastify.get('/pedidos/resumo', async (req) => {
    const { agrupamento, filialId, dataInicio, dataFim, status } = req.query;
    return svc.resumo({ agrupamento, filialId, dataInicio, dataFim, status });
  });

  // GET /api/v1/pedidos/itens
  // Nível de item — filtros por grupo, subgrupo, produto, princípio ativo
  fastify.get('/pedidos/itens', async (req) => {
    const {
      dataInicio, dataFim, filialId, clienteId, vendedorId, status,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page, pageSize,
    } = req.query;

    return svc.listarItens({
      dataInicio, dataFim, filialId, clienteId, vendedorId, status,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });

  // GET /api/v1/pedidos/:id
  // Pedido completo com itens (grupo, subgrupo, unidade, ambos os PAs)
  fastify.get('/pedidos/:id', async (req, reply) => {
    const pedido = await svc.buscarPorId(req.params.id);
    if (!pedido) return reply.code(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND' });
    return pedido;
  });
};
