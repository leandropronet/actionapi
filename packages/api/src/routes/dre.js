'use strict';
/**
 * routes/dre.js
 *
 * GET /api/v1/dre            — linhas do DRE com o valor já calculado pelo SiAGRI
 * GET /api/v1/dre/estrutura  — hierarquia das linhas sem valores
 * GET /api/v1/dre/periodos   — fechamentos disponíveis (um CODI_DRE por período)
 *
 * Não aceita dataInicio/dataFim: o valor de cada linha vem de
 * IDRE.TOTA_IDR, um snapshot gravado pelo SiAGRI no momento do fechamento
 * daquele período — não é recalculado aqui (ver services/dre.js para o
 * porquê). Use dreId (de /dre/periodos) para escolher o fechamento; sem
 * dreId, usa o mais recente.
 */
const svc = require('../services/dre');

module.exports = async function (fastify) {
  fastify.get('/dre', async (req) => {
    return svc.calcular({ dreId: req.query.dreId });
  });

  fastify.get('/dre/estrutura', async (req) => {
    return svc.estrutura({ dreId: req.query.dreId });
  });

  fastify.get('/dre/periodos', async () => {
    return svc.listarPeriodos();
  });
};
