'use strict';
/**
 * middleware/auth.js
 *
 * Autenticação por API Key via header X-API-Key.
 * Chaves válidas são definidas em API_KEYS=chave1,chave2 no .env.
 * Aplicado em todas as rotas /api/* via addHook('onRequest') no app.js.
 * A rota /health é pública e não passa por aqui.
 */
const config = require('../config');

async function authMiddleware(request, reply) {
  if (!config.apiKeys.length) {
    reply.code(500).send({ error: 'API_KEYS não configurada no servidor', code: 'CONFIG_ERROR' });
    return;
  }
  const key = request.headers['x-api-key'];
  if (!key) {
    reply.code(401).send({ error: 'Header X-API-Key ausente', code: 'MISSING_API_KEY' });
    return;
  }
  if (!config.apiKeys.includes(key)) {
    reply.code(401).send({ error: 'API Key inválida', code: 'INVALID_API_KEY' });
  }
}

module.exports = { authMiddleware };
