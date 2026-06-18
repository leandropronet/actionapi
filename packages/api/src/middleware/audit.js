'use strict';
/**
 * Auditoria de consultas sem registrar API keys, cookies ou conteúdo sensível.
 */
async function auditResponse(request, reply) {
  if (!request.url.startsWith('/api/')) return;

  request.log.info({
    event: 'api_access',
    method: request.method,
    path: request.routeOptions?.url || request.url.split('?')[0],
    statusCode: reply.statusCode,
    authType: request.auth?.type || 'unknown',
    authId: request.auth?.id || 'unknown',
    durationMs: Math.round(reply.elapsedTime || 0),
    remoteAddress: request.ip,
  });
}

module.exports = { auditResponse };
