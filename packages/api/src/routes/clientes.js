'use strict';
/**
 * routes/clientes.js
 *
 * GET /api/v1/clientes              — lista paginada com busca
 * GET /api/v1/clientes/:id          — dados completos do cliente
 * GET /api/v1/clientes/:id/faturamento — NFs emitidas para este cliente
 * GET /api/v1/clientes/:id/pedidos     — pedidos de venda deste cliente
 * GET /api/v1/clientes/:id/propriedades — propriedades rurais vinculadas
 * GET /api/v1/clientes/:id/resumo      — totais agregados (faturamento + pedidos)
 */
const svc = require('../services/clientes');

module.exports = async function (fastify) {
  // GET /api/v1/clientes
  // Filtros: search (razão social ou fantasia), cgcCnpj (exato), status (A=Ativo I=Inativo)
  fastify.get('/clientes', async (req) => {
    const { search, cgcCnpj, status, page, pageSize } = req.query;
    return svc.listar({
      search, cgcCnpj, status,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  // Sub-recursos de cliente — devem vir ANTES de /:id para evitar conflito de rota
  // GET /api/v1/clientes/:id/faturamento
  // Filtros: dataInicio, dataFim, tranTop (1=Entrada, 2=Saída)
  fastify.get('/clientes/:id/faturamento', async (req, reply) => {
    const cliente = await svc.buscarPorId(req.params.id);
    if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND' });
    const { dataInicio, dataFim, tranTop, page, pageSize } = req.query;
    return svc.faturamento(req.params.id, {
      dataInicio, dataFim, tranTop,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  // GET /api/v1/clientes/:id/pedidos
  // Filtros: dataInicio, dataFim, status (0/1/5/9), origem (S=CRM)
  fastify.get('/clientes/:id/pedidos', async (req, reply) => {
    const cliente = await svc.buscarPorId(req.params.id);
    if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND' });
    const { dataInicio, dataFim, status, origem, page, pageSize } = req.query;
    return svc.pedidos(req.params.id, {
      dataInicio, dataFim, status, origem,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  // GET /api/v1/clientes/:id/propriedades
  // Retorna todas as propriedades rurais ativas do cliente com vendedores
  fastify.get('/clientes/:id/propriedades', async (req, reply) => {
    const cliente = await svc.buscarPorId(req.params.id);
    if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND' });
    return svc.propriedades(req.params.id);
  });

  // GET /api/v1/clientes/:id/resumo
  // Totais de faturamento e pedidos: valor total, datas, contagens
  fastify.get('/clientes/:id/resumo', async (req, reply) => {
    const cliente = await svc.buscarPorId(req.params.id);
    if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND' });
    return svc.resumo(req.params.id);
  });

  // GET /api/v1/clientes/:id
  fastify.get('/clientes/:id', async (req, reply) => {
    const cliente = await svc.buscarPorId(req.params.id);
    if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND' });
    return cliente;
  });
};
