'use strict';
/**
 * config.js
 *
 * Configuração centralizada da API. Lê variáveis do .env via dotenv.
 * Variáveis obrigatórias:
 *   API_KEYS, PG_HOST, PG_DATABASE, PG_USER, PG_PASS,
 *   SESSION_SECRET, ADMIN_USERNAME e ADMIN_PASSWORD_HASH.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const config = {
  nodeEnv:  process.env.NODE_ENV || 'development',
  port:     Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: process.env.TRUST_PROXY === 'true',
  enforceHttps: process.env.ENFORCE_HTTPS === 'true',
  bodyLimit: Number(process.env.BODY_LIMIT_BYTES) || 1048576,
  apiKeys:  (process.env.API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean),
  rateLimit: {
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    window: process.env.RATE_LIMIT_WINDOW || '1 minute',
    loginMax: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  },
  session: {
    secret: process.env.SESSION_SECRET || '',
    cookieName: process.env.SESSION_COOKIE_NAME || 'actionapi_session',
    ttlSeconds: Number(process.env.SESSION_TTL_SECONDS) || 28800,
    secureCookie: process.env.COOKIE_SECURE !== 'false',
  },
  admin: {
    username: process.env.ADMIN_USERNAME || '',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
  },
  pg: {
    host:     process.env.PG_HOST,
    port:     Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DATABASE,
    user:     process.env.PG_USER,
    password: process.env.PG_PASS,
  },
};

function validateConfig() {
  const errors = [];

  if (!config.apiKeys.length) errors.push('API_KEYS deve conter ao menos uma chave');
  if (!config.session.secret || config.session.secret.length < 32) {
    errors.push('SESSION_SECRET deve ter pelo menos 32 caracteres');
  }
  if (!config.admin.username) errors.push('ADMIN_USERNAME não configurado');
  if (!config.admin.passwordHash.startsWith('scrypt$')) {
    errors.push('ADMIN_PASSWORD_HASH deve ser gerado pelo script npm run hash-password');
  }
  if (!config.pg.host || !config.pg.database || !config.pg.user || !config.pg.password) {
    errors.push('Configuração PostgreSQL incompleta');
  }
  if (config.enforceHttps && !config.session.secureCookie) {
    errors.push('COOKIE_SECURE deve ser true quando ENFORCE_HTTPS=true');
  }

  if (errors.length) {
    const error = new Error(`Configuração inválida: ${errors.join('; ')}`);
    error.code = 'CONFIG_ERROR';
    throw error;
  }
}

module.exports = { ...config, validateConfig };
