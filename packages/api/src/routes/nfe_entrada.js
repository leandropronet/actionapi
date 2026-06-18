'use strict';
/**
 * routes/nfe_entrada.js
 *
 * GET /api/v1/entradas              — NF-e de entrada com filtros
 * GET /api/v1/entradas/resumo       — totais por período (cabeçalho)
 * GET /api/v1/entradas/itens        — itens com dados tributários completos
 * GET /api/v1/entradas/devolucoes   — devoluções de clientes (param=102 funcao=S)
 * GET /api/v1/entradas/:id          — NF-e completa com itens e impostos
 *
 * Filtros de data (dois conjuntos):
 *   dataInicio / dataFim       → filtra por data de EMISSÃO (DEMI_NFE)
 *   dataRecebDe / dataRecebAte → filtra por data de RECEBIMENTO (DREC_NFE)
 *
 * Filtros disponíveis:
 *   filialId, parceiroId, operacaoId, grupoId, produtoId
 *   paramId + funcao   → filtra itens mapeados em um parâmetro de operação
 *                         ex: paramId=102&funcao=S → devoluções de vendas
 *   agrupamento (dia|mes|trimestre|ano) — apenas em /resumo
 */
const svc = require('../services/nfe_entrada');

module.exports = async function (fastify) {
  fastify.get('/entradas', async (req) => {
    const {
      dataInicio, dataFim, dataRecebDe, dataRecebAte,
      filialId, parceiroId, operacaoId,
      page, pageSize,
    } = req.query;

    return svc.listar({
      dataInicio, dataFim, dataRecebDe, dataRecebAte,
      filialId, parceiroId, operacaoId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  fastify.get('/entradas/resumo', async (req) => {
    const { agrupamento, filialId, dataInicio, dataFim, dataRecebDe, dataRecebAte } = req.query;
    return svc.resumo({ agrupamento, filialId, dataInicio, dataFim, dataRecebDe, dataRecebAte });
  });

  fastify.get('/entradas/itens', async (req) => {
    const {
      dataInicio, dataFim, dataRecebDe, dataRecebAte,
      filialId, parceiroId, operacaoId, grupoId, produtoId,
      paramId, funcao,
      page, pageSize,
    } = req.query;

    return svc.listarItens({
      dataInicio, dataFim, dataRecebDe, dataRecebAte,
      filialId, parceiroId, operacaoId, grupoId, produtoId,
      paramId, funcao,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });

  // Atalho para devoluções de clientes (param=102, funcao=S) com totais
  fastify.get('/entradas/devolucoes', async (req) => {
    const { dataInicio, dataFim, filialId, paramId } = req.query;
    return svc.resumoDevolucoesParam({ paramId: paramId || '102', dataInicio, dataFim, filialId });
  });

  fastify.get('/entradas/:id', async (req, reply) => {
    const nfe = await svc.buscarPorId(req.params.id);
    if (!nfe) return reply.code(404).send({ error: 'NF-e de entrada não encontrada', code: 'NOT_FOUND' });
    return nfe;
  });
};
