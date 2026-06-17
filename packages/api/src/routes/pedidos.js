'use strict';
const svc = require('../services/pedidos');

module.exports = async function (fastify) {
  // GET /api/v1/pedidos
  // Filtros: dataInicio, dataFim, filialId, clienteId, vendedorId,
  //          status (0=Não Lib 1=Lib 5=Confirmado 9=Cancelado),
  //          origem (S=CRM, null=ERP direto),
  //          grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId
  fastify.get('/pedidos', async (req) => {
    const {
      dataInicio, dataFim, filialId, clienteId, vendedorId, status, origem,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page, pageSize,
    } = req.query;

    return svc.listar({
      dataInicio, dataFim, filialId, clienteId, vendedorId, status, origem,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 100, 500),
    });
  });

  // GET /api/v1/pedidos/resumo
  // Filtros: agrupamento (dia/mes/trimestre/ano), filialId, dataInicio, dataFim, status, origem
  // Resposta inclui breakdown: nao_liberados, liberados, confirmados, cancelados, do_crm, do_erp
  fastify.get('/pedidos/resumo', async (req) => {
    const { agrupamento, filialId, dataInicio, dataFim, status, origem } = req.query;
    return svc.resumo({ agrupamento, filialId, dataInicio, dataFim, status, origem });
  });

  // GET /api/v1/pedidos/itens
  // Nível de item — filtros por grupo, subgrupo, produto, princípio ativo, origem
  fastify.get('/pedidos/itens', async (req) => {
    const {
      dataInicio, dataFim, filialId, clienteId, vendedorId, status, origem,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page, pageSize,
    } = req.query;

    return svc.listarItens({
      dataInicio, dataFim, filialId, clienteId, vendedorId, status, origem,
      grupoId, subgrupoId, produtoId, principioAtivoId, principioAtivoRecId,
      page:     Number(page)     || 1,
      pageSize: Math.min(Number(pageSize) || 200, 1000),
    });
  });

  // GET /api/v1/pedidos/:id/faturamento
  // NFs emitidas que originaram deste pedido (via INOTA.PEDI_PED → PEDIDO)
  fastify.get('/pedidos/:id/faturamento', async (req, reply) => {
    const pedido = await svc.buscarPorId(req.params.id);
    if (!pedido) return reply.code(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND' });
    return svc.buscarFaturamento(req.params.id);
  });

  // GET /api/v1/pedidos/:id/saldo
  // Saldo do pedido: itens pedidos vs itens faturados, por produto.
  // Retorna status_comercial: ABERTO | FATURADO_PARCIALMENTE | FATURADO_INTEGRAL
  fastify.get('/pedidos/:id/saldo', async (req, reply) => {
    const saldo = await svc.calcularSaldo(req.params.id);
    if (!saldo) return reply.code(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND' });
    return saldo;
  });

  // GET /api/v1/pedidos/:id
  // Pedido completo com itens (grupo, subgrupo, unidade, ambos os PAs, origem)
  fastify.get('/pedidos/:id', async (req, reply) => {
    const pedido = await svc.buscarPorId(req.params.id);
    if (!pedido) return reply.code(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND' });
    return pedido;
  });
};
