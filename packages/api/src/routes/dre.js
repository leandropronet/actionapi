'use strict';
/**
 * routes/dre.js
 *
 * GET /api/v1/dre           — DRE por período (dataInicio e dataFim obrigatórios)
 * GET /api/v1/dre/estrutura — hierarquia das linhas sem valores
 *
 * Filtros de /dre:
 *   dataInicio, dataFim (obrigatórios, AAAA-MM-DD)
 *   filialId (opcional — atenção: filial_id em raw.contabil usa CABLANCTB.CODI_EMP,
 *             que está vazio em ~98% dos lançamentos — ver STATUS.md pendências)
 *
 * Retorno de /dre:
 *   { dataInicio, dataFim, linhas: [{ idre_id, descricao, nivel, posicao_pai, tipo, grupo, valor }] }
 *
 * Linhas com tipo='C' (Cálculo) têm valor=0 — devem ser calculadas pelo consumidor
 * somando/subtraindo as linhas filhas conforme hierarquia posicao_pai.
 */
const svc = require('../services/dre');

module.exports = async function (fastify) {
  fastify.get('/dre', async (req, reply) => {
    const { dataInicio, dataFim, filialId } = req.query;
    if (!dataInicio || !dataFim) {
      return reply.code(400).send({ error: 'dataInicio e dataFim são obrigatórios', code: 'MISSING_PARAMS' });
    }
    return svc.calcular({ dataInicio, dataFim, filialId });
  });

  fastify.get('/dre/estrutura', async () => {
    return svc.estrutura();
  });
};
