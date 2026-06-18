'use strict';
const assert = require('assert');
const { hashPassword } = require('../src/security/password');

process.env.NODE_ENV = 'test';
process.env.API_KEYS = 'integration-test-key';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
process.env.SESSION_COOKIE_NAME = 'actionapi_test_session';
process.env.SESSION_TTL_SECONDS = '3600';
process.env.COOKIE_SECURE = 'false';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD_HASH = hashPassword('uma-senha-de-teste-forte');
process.env.PG_HOST = 'localhost';
process.env.PG_DATABASE = 'actionapi';
process.env.PG_USER = 'actionapi';
process.env.PG_PASS = 'not-used';

const { buildApp } = require('../src/app');

async function run() {
  const app = await buildApp();

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.ok(health.headers['x-content-type-options']);

  const anonymousApi = await app.inject({ method: 'GET', url: '/api/v1/nao-existe' });
  assert.equal(anonymousApi.statusCode, 401);

  const apiKeyRequest = await app.inject({
    method: 'GET',
    url: '/api/v1/nao-existe',
    headers: { 'x-api-key': 'integration-test-key' },
  });
  assert.equal(apiKeyRequest.statusCode, 404);

  const badLogin = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username: 'admin', password: 'errada' },
  });
  assert.equal(badLogin.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username: 'admin', password: 'uma-senha-de-teste-forte' },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.match(login.headers['set-cookie'], /SameSite=Strict/);

  const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().username, 'admin');

  const panel = await app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.equal(panel.statusCode, 200);
  assert.match(panel.body, /PAINEL SOMENTE LEITURA/);

  const anonymousDocs = await app.inject({
    method: 'GET',
    url: '/docs/',
    headers: { accept: 'text/html' },
  });
  assert.equal(anonymousDocs.statusCode, 302);
  assert.equal(anonymousDocs.headers.location, '/login');

  const docs = await app.inject({ method: 'GET', url: '/docs/', headers: { cookie } });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.body, /Swagger UI/);

  const sessionApi = await app.inject({
    method: 'GET',
    url: '/api/v1/nao-existe',
    headers: { cookie },
  });
  assert.equal(sessionApi.statusCode, 404);

  await app.close();
  console.log('security: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
