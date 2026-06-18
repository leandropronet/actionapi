'use strict';
/**
 * Endpoints planos para Power BI e Excel.
 *
 * Use format=csv para download direto ou JSON paginado para conectores Web.
 */
const bi = require('../services/bi');
const conciliacao = require('../services/conciliacao');

function requirePeriod(req, reply) {
  if (!req.query.dataInicio || !req.query.dataFim) {
    reply.code(400).send({
      error: 'dataInicio e dataFim são obrigatórios para datasets analíticos',
      code: 'MISSING_PARAMS',
    });
    return false;
  }
  return true;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendDataset(reply, result, format, filename) {
  if (format !== 'csv') return result;
  const rows = result.data || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const csv = [
    columns.map(csvEscape).join(';'),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(';')),
  ].join('\r\n');
  return reply
    .type('text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(`\uFEFF${csv}`);
}

function pageOptions(query) {
  return {
    page: Number(query.page) || 1,
    pageSize: Math.min(Number(query.pageSize) || 1000, 10000),
  };
}

module.exports = async function (fastify) {
  fastify.get('/bi/financeiro', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    const result = await bi.financeiro({ ...req.query, ...pageOptions(req.query) });
    return sendDataset(reply, result, req.query.format, 'financeiro.csv');
  });

  fastify.get('/bi/contabil', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    const result = await bi.contabil({ ...req.query, ...pageOptions(req.query) });
    return sendDataset(reply, result, req.query.format, 'contabil.csv');
  });

  fastify.get('/conciliacao/financeiro-contabil', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    const result = await conciliacao.listar({
      ...req.query,
      tolerancia: Number(req.query.tolerancia) || 0.01,
      ...pageOptions(req.query),
    });
    return sendDataset(reply, result, req.query.format, 'conciliacao-financeiro-contabil.csv');
  });

  fastify.get('/conciliacao/financeiro-contabil/divergencias', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    const result = await conciliacao.listar({
      ...req.query,
      somenteDivergencias: true,
      tolerancia: Number(req.query.tolerancia) || 0.01,
      ...pageOptions(req.query),
    });
    return sendDataset(reply, result, req.query.format, 'divergencias-financeiro-contabil.csv');
  });

  fastify.get('/conciliacao/financeiro-contabil/resumo', async (req, reply) => {
    if (!requirePeriod(req, reply)) return;
    return conciliacao.resumo({
      ...req.query,
      tolerancia: Number(req.query.tolerancia) || 0.01,
    });
  });
};
