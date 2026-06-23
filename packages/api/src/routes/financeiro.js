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
const contasPagar = require('../services/contas_pagar');
const contasReceber = require('../services/contas_receber');

function booleanQuery(value, defaultValue) {
  if (value === undefined) return defaultValue;
  return !['false', '0', 'nao', 'não'].includes(String(value).toLowerCase());
}

module.exports = async function (fastify) {
  fastify.get('/financeiro/contas-receber', async (req) => {
    const { page, pageSize, ...filters } = req.query;
    return contasReceber.listar({ ...filters, page, pageSize });
  });

  fastify.get('/financeiro/contas-receber/resumo', async (req) => {
    return contasReceber.resumo(req.query);
  });

  fastify.get('/financeiro/contas-pagar', async (req) => {
    const { page, pageSize, somenteEmAberto, incluirPagasDeAbertos, ...filters } = req.query;
    return contasPagar.listar({
      ...filters,
      somenteEmAberto: booleanQuery(somenteEmAberto, true),
      incluirPagasDeAbertos: booleanQuery(incluirPagasDeAbertos, false),
      page,
      pageSize,
    });
  });

  fastify.get('/financeiro/contas-pagar/resumo', async (req) => {
    const { somenteEmAberto, ...filters } = req.query;
    return contasPagar.resumo({
      ...filters,
      somenteEmAberto: booleanQuery(somenteEmAberto, true),
    });
  });

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
