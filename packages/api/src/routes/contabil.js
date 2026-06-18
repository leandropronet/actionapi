'use strict';
/**
 * routes/contabil.js
 *
 * GET /api/v1/contabil              — partidas contábeis com filtros
 * GET /api/v1/contabil/saldo-contas — débito/crédito/saldo por conta e competência
 * GET /api/v1/contabil/resumo       — totais mensais (lançamentos, partidas, D/C) por competência
 * GET /api/v1/contabil/balancete    — D/C/saldo por grupo (Ativo, Passivo, Custos...) em intervalo de datas
 *
 * Filtros de /contabil:
 *   filialId, competencia (AAAA-MM), conta (CODI_CPC), planoContas (CODI_PLC),
 *   tipo (F=Fiscal, S=Societário), page, pageSize (máx 1000)
 *
 * Filtros de /contabil/saldo-contas:
 *   competencia (obrigatória), filialId
 *
 * Filtros de /contabil/resumo:
 *   filialId, anoInicio (AAAA), anoFim (AAAA)
 *
 * Filtros de /contabil/balancete:
 *   dataInicio (AAAA-MM-DD, obrigatória), dataFim (AAAA-MM-DD, obrigatória), filialId
 */
const svc = require('../services/contabil');

module.exports = async function (fastify) {
  // Sub-recursos ANTES de qualquer /:param para evitar conflito de rota
  // GET /api/v1/contabil/saldo-contas
  fastify.get('/contabil/saldo-contas', async (req, reply) => {
    const { filialId, competencia } = req.query;
    if (!competencia) {
      return reply.code(400).send({ error: 'competencia é obrigatória (AAAA-MM)', code: 'MISSING_PARAMS' });
    }
    return svc.saldoContas({ filialId, competencia });
  });

  // GET /api/v1/contabil/resumo
  fastify.get('/contabil/resumo', async (req) => {
    const { filialId, anoInicio, anoFim } = req.query;
    return svc.resumo({ filialId, anoInicio, anoFim });
  });

  // GET /api/v1/contabil/balancete
  fastify.get('/contabil/balancete', async (req, reply) => {
    const { dataInicio, dataFim, filialId } = req.query;
    if (!dataInicio || !dataFim) {
      return reply.code(400).send({ error: 'dataInicio e dataFim sao obrigatorios (AAAA-MM-DD)', code: 'MISSING_PARAMS' });
    }
    return svc.balancete({ dataInicio, dataFim, filialId });
  });

  // GET /api/v1/contabil
  fastify.get('/contabil', async (req) => {
    const { filialId, competencia, conta, planoContas, tipo, page, pageSize } = req.query;
    return svc.listar({
      filialId, competencia, conta, planoContas, tipo,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });
};
