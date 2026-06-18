'use strict';
/**
 * routes/faturamento.js
 *
 * GET /api/v1/faturamento         — NFs com filtros de cabeçalho
 * GET /api/v1/faturamento/resumo  — totais por período
 * GET /api/v1/faturamento/itens   — nível de item com filtros de produto/grupo
 * GET /api/v1/faturamento/:id     — NF completa com itens
 *
 * Filtros de data (dois conjuntos, use um por vez):
 *   dataInicio / dataFim     → filtra por data de EMISSÃO (DEMI_NOT)
 *   dataSaidaDe / dataSaidaAte → filtra por data de SAÍDA (DSAI_NOT)
 *   O relatório "Saídas Faturadas Analítico" usa dataInicio/dataFim.
 *
 * Outros filtros de /faturamento e /faturamento/itens:
 *   filialId, clienteId, vendedorId, status (0/5/9), tranTop (1/2/3),
 *   operacaoId, grupoId, subgrupoId, produtoId, principioAtivoId
 *   page, pageSize (padrão 100, máx 500 para NFs; padrão 200, máx 1000 para itens)
 *
 * Filtros de /faturamento/resumo:
 *   agrupamento (dia|mes|trimestre|ano), filialId, tranTop
 *   + os filtros de data acima (emissão ou saída)
 *   paramId (ex: 102) ativa o consolidado A−S de NOTA + NFENTRA
 *   status (padrão 5 no modo consolidado)
 */
const svc = require('../services/faturamento');

module.exports = async function (fastify) {
  fastify.get('/faturamento', async (req) => {
    const {
      dataInicio, dataFim, dataSaidaDe, dataSaidaAte,
      filialId, clienteId, vendedorId,
      status, tranTop, operacaoId, grupoId, subgrupoId, produtoId, principioAtivoId,
      page, pageSize,
    } = req.query;

    return svc.listar({
      dataInicio, dataFim, dataSaidaDe, dataSaidaAte,
      filialId, clienteId, vendedorId,
      status, tranTop, operacaoId, grupoId, subgrupoId, produtoId, principioAtivoId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  fastify.get('/faturamento/resumo', async (req) => {
    const {
      agrupamento, filialId, dataInicio, dataFim,
      dataSaidaDe, dataSaidaAte, tranTop, paramId, status,
    } = req.query;
    return svc.resumo({
      agrupamento, filialId, dataInicio, dataFim,
      dataSaidaDe, dataSaidaAte, tranTop, paramId, status,
    });
  });

  fastify.get('/faturamento/itens', async (req) => {
    const {
      dataInicio, dataFim, dataSaidaDe, dataSaidaAte,
      filialId, clienteId, vendedorId, tranTop,
      grupoId, subgrupoId, produtoId, principioAtivoId,
      page, pageSize,
    } = req.query;

    return svc.listarItens({
      dataInicio, dataFim, dataSaidaDe, dataSaidaAte,
      filialId, clienteId, vendedorId, tranTop,
      grupoId, subgrupoId, produtoId, principioAtivoId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });

  fastify.get('/faturamento/:id', async (req, reply) => {
    const nf = await svc.buscarPorId(req.params.id);
    if (!nf) return reply.code(404).send({ error: 'NF não encontrada', code: 'NOT_FOUND' });
    return nf;
  });
};
