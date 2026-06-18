'use strict';
/**
 * middleware/auth.js
 *
 * Autenticação híbrida:
 *   - integrações usam o header X-API-Key;
 *   - o painel e Swagger usam sessão JWT em cookie HttpOnly.
 */
const crypto = require('crypto');
const config = require('../config');

function safeEqual(valueA, valueB) {
  const a = Buffer.from(String(valueA));
  const b = Buffer.from(String(valueB));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function apiKeyIdentity(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function validApiKey(key) {
  return Boolean(key) && config.apiKeys.some((candidate) => safeEqual(key, candidate));
}

async function verifyAdminSession(request) {
  try {
    const payload = await request.jwtVerify({ onlyCookie: true });
    if (payload.role !== 'admin' || payload.sub !== config.admin.username) return null;
    return payload;
  } catch {
    return null;
  }
}

async function authMiddleware(request, reply) {
  const key = request.headers['x-api-key'];
  if (validApiKey(key)) {
    request.auth = { type: 'api_key', id: apiKeyIdentity(key) };
    return;
  }

  const session = await verifyAdminSession(request);
  if (session) {
    request.auth = { type: 'admin_session', id: session.sub };
    return;
  }

  const code = key ? 'INVALID_API_KEY' : 'AUTH_REQUIRED';
  return reply.code(401).send({
    error: 'Autenticação necessária. Use X-API-Key ou sessão administrativa.',
    code,
  });
}

async function adminSessionMiddleware(request, reply) {
  const session = await verifyAdminSession(request);
  if (!session) {
    if (request.headers.accept?.includes('text/html')) {
      return reply.redirect('/login');
    }
    return reply.code(401).send({ error: 'Sessão administrativa inválida', code: 'SESSION_REQUIRED' });
  }
  request.auth = { type: 'admin_session', id: session.sub };
}

module.exports = {
  adminSessionMiddleware,
  authMiddleware,
  verifyAdminSession,
};
