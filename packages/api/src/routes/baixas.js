'use strict';
/**
 * routes/baixas.js
 *
 * GET /api/v1/recebimentos         — baixas efetivas de CR (CRCBAIXA)
 * GET /api/v1/recebimentos/resumo  — totais por período
 * GET /api/v1/pagamentos           — baixas efetivas de CP (CPGBAIXA)
 * GET /api/v1/pagamentos/resumo    — totais por período
 *
 * Filtros de /recebimentos:
 *   filialId, clienteId, tipoDoc, status (N=Normal E=Estornada)
 *   dataDe, dataAte (AAAA-MM-DD — data de pagamento)
 *   page, pageSize (padrão 100, máx 500)
 *
 * Filtros de /pagamentos:
 *   filialId, status (N=Normal E=Estornada)
 *   dataDe, dataAte (AAAA-MM-DD — data de pagamento)
 *   page, pageSize (padrão 100, máx 500)
 *
 * Filtros de /resumo:
 *   agrupamento (dia|mes|trimestre|ano), filialId, dataDe, dataAte
 */
const svc = require('../services/baixas');

module.exports = async function (fastify) {
  fastify.get('/recebimentos', async (req) => {
    const { filialId, clienteId, tipoDoc, status, dataDe, dataAte, page, pageSize } = req.query;
    return svc.listarRecebimentos({
      filialId, clienteId, tipoDoc, status, dataDe, dataAte,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  fastify.get('/recebimentos/resumo', async (req) => {
    const { agrupamento, filialId, dataDe, dataAte } = req.query;
    return svc.resumoRecebimentos({ agrupamento, filialId, dataDe, dataAte });
  });

  fastify.get('/pagamentos', async (req) => {
    const { filialId, status, dataDe, dataAte, page, pageSize } = req.query;
    return svc.listarPagamentos({
      filialId, status, dataDe, dataAte,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  fastify.get('/pagamentos/resumo', async (req) => {
    const { agrupamento, filialId, dataDe, dataAte } = req.query;
    return svc.resumoPagamentos({ agrupamento, filialId, dataDe, dataAte });
  });
};
