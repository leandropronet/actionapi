'use strict';
const svc = require('../services/duplicatas');

module.exports = async function (fastify) {
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
