'use strict';
/**
 * app.js — ActionAPI
 *
 * Servidor Fastify v5. Todas as rotas /api/v1/* exigem X-API-Key.
 * Porta configurada via PORT no .env (padrão 3000).
 *
 * Domínios disponíveis: faturamento, duplicatas, pedidos, estoque,
 *   financeiro, contabil, clientes.
 *
 * Para adicionar um novo domínio:
 *   1. Criar packages/api/src/services/<dominio>.js
 *   2. Criar packages/api/src/routes/<dominio>.js
 *   3. Registrar: app.register(require('./routes/<dominio>'), { prefix: '/api/v1' })
 */
require('dotenv').config();
const Fastify = require('fastify');
const { authMiddleware } = require('./middleware/auth');
const config = require('./config');

const app = Fastify({ logger: { level: config.logLevel } });

// Health check (sem auth)
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

// Todas as rotas /api/v1/* exigem X-API-Key
app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    await authMiddleware(request, reply);
  }
});

// Registra rotas
app.register(require('./routes/faturamento'), { prefix: '/api/v1' });
app.register(require('./routes/duplicatas'),  { prefix: '/api/v1' });
app.register(require('./routes/pedidos'),     { prefix: '/api/v1' });
app.register(require('./routes/estoque'),     { prefix: '/api/v1' });
app.register(require('./routes/financeiro'),  { prefix: '/api/v1' });
app.register(require('./routes/contabil'),    { prefix: '/api/v1' });
app.register(require('./routes/clientes'),    { prefix: '/api/v1' });

// Handler de erros genérico
app.setErrorHandler((err, req, reply) => {
  app.log.error(err);
  reply.code(err.statusCode || 500).send({
    error: err.message || 'Erro interno',
    code:  err.code || 'INTERNAL_ERROR',
  });
});

app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`ActionAPI rodando na porta ${config.port}`);
});
