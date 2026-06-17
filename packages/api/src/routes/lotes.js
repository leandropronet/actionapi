'use strict';
/**
 * routes/lotes.js
 *
 * GET /api/v1/lotes          — lotes com saldo positivo (snapshot diário)
 * GET /api/v1/lotes/vencendo — vencendo nos próximos N dias (alerta de validade)
 * GET /api/v1/lotes/resumo   — totais por grupo e filial
 *
 * Filtros de /lotes:
 *   filialId, produtoId, grupoId
 *   vencendoEm (número de dias — mostra apenas lotes que vencem em até N dias)
 *   saldoMinimo (padrão 0 — inclui todos com saldo > 0)
 *   page, pageSize (padrão 200, máx 1000)
 *
 * Filtros de /lotes/vencendo:
 *   dias (padrão 30), filialId, grupoId
 *
 * Filtros de /lotes/resumo:
 *   filialId
 */
const svc = require('../services/lotes');

module.exports = async function (fastify) {
  // Sub-recursos registrados ANTES de /:id para evitar conflito de rota no Fastify
  // GET /api/v1/lotes/vencendo
  fastify.get('/lotes/vencendo', async (req) => {
    const { filialId, grupoId, dias } = req.query;
    return svc.vencendo({
      filialId,
      grupoId,
      dias: Number(dias) || 30,
    });
  });

  // GET /api/v1/lotes/resumo
  fastify.get('/lotes/resumo', async (req) => {
    const { filialId } = req.query;
    return svc.resumo({ filialId });
  });

  // GET /api/v1/lotes
  fastify.get('/lotes', async (req) => {
    const { filialId, produtoId, grupoId, vencendoEm, saldoMinimo, page, pageSize } = req.query;
    return svc.listar({
      filialId,
      produtoId,
      grupoId,
      vencendoEm,
      saldoMinimo,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });
};
