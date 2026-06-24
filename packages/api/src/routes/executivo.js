'use strict';
const svc = require('../services/executivo');

function requirePeriod(req, reply) {
  if (!req.query.dataInicio || !req.query.dataFim) {
    reply.code(400).send({
      error: 'dataInicio e dataFim são obrigatórios (AAAA-MM-DD)',
      code: 'MISSING_PARAMS',
    });
    return false;
  }
  return true;
}

module.exports = async function (fastify) {
  fastify.get('/executivo/faturamento', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.faturamentoDetalhes(req.query);
  });

  fastify.get('/executivo/faturamento/resumo', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.faturamentoResumo(req.query);
  });

  fastify.get('/executivo/recebimentos', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.movimentosDetalhes('recebimentos', req.query);
  });

  fastify.get('/executivo/recebimentos/resumo', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.movimentosResumo('recebimentos', req.query);
  });

  fastify.get('/executivo/pagamentos', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.movimentosDetalhes('pagamentos', req.query);
  });

  fastify.get('/executivo/pagamentos/resumo', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.movimentosResumo('pagamentos', req.query);
  });

  fastify.get('/executivo/contabilidade/resumo', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.contabilidadeResumo(req.query);
  });

  fastify.get('/executivo/contabilidade/sintetico', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.contabilidadeSintetico(req.query);
  });

  fastify.get('/executivo/filiais', async () => svc.listarFiliais());

  fastify.get('/executivo/visao-360', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return svc.visao360(req.query);
  });
};
