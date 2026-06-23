'use strict';
/**
 * routes/duplicatas.js
 *
 * GET /api/v1/duplicatas              — parcelas (cru, sem cálculo de saldo)
 * GET /api/v1/duplicatas/saldo        — saldo em aberto por parcela (snapshot diário)
 * GET /api/v1/duplicatas/saldo/resumo — saldo em aberto agregado por cliente
 *
 * Saldo em aberto = `raw.duplicatas_saldo`, calculado via VALOR_ABERTO_RECEBER_DATA
 * do Oracle (não é VLOR_REC - baixas) — ver services/duplicatas.js.
 */
const svc = require('../services/duplicatas');

module.exports = async function (fastify) {
  // Sub-recursos ANTES de qualquer rota genérica
  fastify.get('/duplicatas/saldo/resumo', async (req) => {
    const { filialId, clienteId } = req.query;
    return svc.resumoSaldoPorCliente({ filialId, clienteId });
  });

  fastify.get('/duplicatas/saldo', async (req) => {
    const { filialId, clienteId, vencimentoDe, vencimentoAte, page, pageSize } = req.query;
    return svc.listarSaldo({
      filialId, clienteId, vencimentoDe, vencimentoAte,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });

  // Filtros: filialId, clienteId, nfId, vencimentoDe, vencimentoAte
  //          status (A=Aberto, B=Baixado, C=Cancelado)
  fastify.get('/duplicatas', async (req) => {
    const { filialId, clienteId, status, vencimentoDe, vencimentoAte, nfId, page, pageSize } = req.query;
    return svc.listar({
      filialId, clienteId, status, vencimentoDe, vencimentoAte, nfId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });
};
