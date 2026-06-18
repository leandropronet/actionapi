'use strict';
/**
 * routes/financeiro.js
 *
 * GET /api/v1/financeiro            — parcelas CP ou CR com filtros de vencimento
 * GET /api/v1/financeiro/fluxo-caixa — saldo diário (receber − pagar) por período
 *
 * Filtros de /financeiro:
 *   tipo (CP=Contas a Pagar, CR=Contas a Receber — omitir retorna ambos)
 *   filialId, vencimentoDe, vencimentoAte (AAAA-MM-DD)
 *   page, pageSize (padrão 100, máx 500)
 *
 * Filtros de /financeiro/fluxo-caixa:
 *   dataInicio, dataFim (obrigatórios, AAAA-MM-DD), filialId
 */
const svc = require('../services/financeiro');

module.exports = async function (fastify) {
  fastify.get('/financeiro', async (req) => {
    const { tipo, filialId, status, vencimentoDe, vencimentoAte, page, pageSize } = req.query;
    return svc.listar({ tipo, filialId, status, vencimentoDe, vencimentoAte,
      page: Number(page) || 1, pageSize: Math.min(Number(pageSize) || 100, 500) });
  });

  fastify.get('/financeiro/fluxo-caixa', async (req, reply) => {
    const { dataInicio, dataFim, filialId } = req.query;
    if (!dataInicio || !dataFim) {
      return reply.code(400).send({ error: 'dataInicio e dataFim são obrigatórios', code: 'MISSING_PARAMS' });
    }
    return svc.fluxoCaixa({ dataInicio, dataFim, filialId });
  });
};
