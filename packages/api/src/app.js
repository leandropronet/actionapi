'use strict';
/**
 * app.js — ActionAPI
 *
 * Superfícies:
 *   /api/v1/* — API somente leitura; aceita X-API-Key ou sessão administrativa
 *   /login    — autenticação do painel
 *   /painel   — frontend administrativo somente leitura
 *   /docs     — Swagger/OpenAPI protegido por sessão
 *   /health   — verificação pública e limitada de disponibilidade
 */
const path = require('path');
const Fastify = require('fastify');
const cookie = require('@fastify/cookie');
const helmet = require('@fastify/helmet');
const jwt = require('@fastify/jwt');
const rateLimit = require('@fastify/rate-limit');
const fastifyStatic = require('@fastify/static');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const config = require('./config');
const db = require('./db/postgres');
const openapi = require('./openapi');
const { verifyPassword } = require('./security/password');
const { adminSessionMiddleware, authMiddleware } = require('./middleware/auth');
const { auditResponse } = require('./middleware/audit');

async function buildApp({ validateConfig = true } = {}) {
  if (validateConfig) config.validateConfig();

  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
  });

  app.decorateRequest('auth', null);
  app.addHook('onClose', async () => db.pool.end());

  await app.register(cookie);
  await app.register(jwt, {
    secret: config.session.secret || 'development-only-secret-change-me',
    cookie: {
      cookieName: config.session.cookieName,
      signed: false,
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
    errorResponseBuilder: () => ({
      error: 'Muitas requisições. Aguarde e tente novamente.',
      code: 'RATE_LIMITED',
    }),
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    serve: false,
  });

  openapi.components.securitySchemes.AdminSession.name = config.session.cookieName;
  await app.register(swagger, {
    mode: 'static',
    specification: { document: openapi },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiHooks: { onRequest: adminSessionMiddleware },
    staticCSP: true,
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      withCredentials: true,
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    if (
      config.enforceHttps
      && request.protocol !== 'https'
      && request.url !== '/health'
    ) {
      return reply.code(426).send({
        error: 'HTTPS obrigatório',
        code: 'HTTPS_REQUIRED',
      });
    }
    if (request.url.startsWith('/api/')) {
      await authMiddleware(request, reply);
    }
  });
  app.addHook('onResponse', auditResponse);

  app.get('/', async (request, reply) => reply.redirect('/painel'));
  app.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async () => ({ status: 'ok', ts: new Date().toISOString() }));

  app.get('/login', async (request, reply) => reply.sendFile('login.html'));
  app.get('/painel', { preHandler: adminSessionMiddleware }, async (request, reply) => {
    return reply.sendFile('dashboard.html');
  });
  app.get('/assets/styles.css', async (request, reply) => reply.type('text/css').sendFile('styles.css'));
  app.get('/assets/login.js', async (request, reply) => reply.type('application/javascript').sendFile('login.js'));
  app.get('/assets/dashboard.js', async (request, reply) => reply.type('application/javascript').sendFile('dashboard.js'));

  app.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 128 },
          password: { type: 'string', minLength: 1, maxLength: 512 },
        },
      },
    },
    config: {
      rateLimit: {
        max: config.rateLimit.loginMax,
        timeWindow: '15 minutes',
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body || {};
    const validUser = typeof username === 'string' && username === config.admin.username;
    const validPassword = verifyPassword(password, config.admin.passwordHash);

    if (!validUser || !validPassword) {
      request.log.warn({ event: 'admin_login_failed', username, remoteAddress: request.ip });
      return reply.code(401).send({ error: 'Usuário ou senha inválidos', code: 'INVALID_CREDENTIALS' });
    }

    const token = await reply.jwtSign(
      { role: 'admin' },
      { sign: { sub: config.admin.username, expiresIn: config.session.ttlSeconds } },
    );
    reply.setCookie(config.session.cookieName, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.session.secureCookie,
      maxAge: config.session.ttlSeconds,
    });
    request.log.info({ event: 'admin_login_success', username, remoteAddress: request.ip });
    return { authenticated: true, username };
  });

  app.post('/auth/logout', async (request, reply) => {
    reply.clearCookie(config.session.cookieName, { path: '/' });
    return { authenticated: false };
  });

  app.get('/auth/me', { preHandler: adminSessionMiddleware }, async (request) => ({
    authenticated: true,
    username: request.auth.id,
    role: 'admin',
  }));

  app.register(require('./routes/faturamento'), { prefix: '/api/v1' });
  app.register(require('./routes/nfe_entrada'), { prefix: '/api/v1' });
  app.register(require('./routes/duplicatas'), { prefix: '/api/v1' });
  app.register(require('./routes/pedidos'), { prefix: '/api/v1' });
  app.register(require('./routes/estoque'), { prefix: '/api/v1' });
  app.register(require('./routes/financeiro'), { prefix: '/api/v1' });
  app.register(require('./routes/contabil'), { prefix: '/api/v1' });
  app.register(require('./routes/clientes'), { prefix: '/api/v1' });
  app.register(require('./routes/lotes'), { prefix: '/api/v1' });
  app.register(require('./routes/baixas'), { prefix: '/api/v1' });
  app.register(require('./routes/dre'), { prefix: '/api/v1' });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Erro interno' : error.message,
      code: error.code || 'INTERNAL_ERROR',
    });
  });

  return app;
}

async function start() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`ActionAPI rodando na porta ${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

if (require.main === module) start();

module.exports = { buildApp };
