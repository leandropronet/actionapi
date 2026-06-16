'use strict';
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
