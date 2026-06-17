'use strict';
const svc = require('../services/faturamento');

module.exports = async function (fastify) {
  // GET /api/v1/faturamento
  // Filtros: dataInicio, dataFim, filialId, clienteId, vendedorId,
  //          status, tranTop, operacaoId, grupoId, subgrupoId, produtoId
  fastify.get('/faturamento', async (req) => {
    const {
      dataInicio, dataFim, filialId, clienteId, vendedorId,
      status, tranTop, operacaoId, grupoId, subgrupoId, produtoId, principioAtivoId,
      page, pageSize,
    } = req.query;

    return svc.listar({
      dataInicio, dataFim, filialId, clienteId, vendedorId,
      status, tranTop, operacaoId, grupoId, subgrupoId, produtoId, principioAtivoId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  // GET /api/v1/faturamento/resumo
  // Filtros: agrupamento (dia/mes/trimestre/ano), filialId, dataInicio, dataFim, tranTop
  fastify.get('/faturamento/resumo', async (req) => {
    const { agrupamento, filialId, dataInicio, dataFim, tranTop } = req.query;
    return svc.resumo({ agrupamento, filialId, dataInicio, dataFim, tranTop });
  });

  // GET /api/v1/faturamento/itens
  // Nível de item — ideal para filtrar por grupo, subgrupo, produto específico.
  // Filtros: dataInicio, dataFim, filialId, clienteId, vendedorId, tranTop,
  //          grupoId, subgrupoId, produtoId
  fastify.get('/faturamento/itens', async (req) => {
    const {
      dataInicio, dataFim, filialId, clienteId, vendedorId, tranTop,
      grupoId, subgrupoId, produtoId, principioAtivoId,
      page, pageSize,
    } = req.query;

    return svc.listarItens({
      dataInicio, dataFim, filialId, clienteId, vendedorId, tranTop,
      grupoId, subgrupoId, produtoId, principioAtivoId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });

  // GET /api/v1/faturamento/:id
  // NF completa com itens (inclui grupo, subgrupo, unidade de cada item)
  fastify.get('/faturamento/:id', async (req, reply) => {
    const nf = await svc.buscarPorId(req.params.id);
    if (!nf) return reply.code(404).send({ error: 'NF não encontrada', code: 'NOT_FOUND' });
    return nf;
  });
};
