'use strict';
/**
 * config.js
 *
 * Configuração centralizada da API. Lê variáveis do .env via dotenv.
 * Variáveis obrigatórias: PORT, API_KEYS, PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASS.
 */
require('dotenv').config();

module.exports = {
  port:     Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  apiKeys:  (process.env.API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean),
  pg: {
    host:     process.env.PG_HOST,
    port:     Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DATABASE,
    user:     process.env.PG_USER,
    password: process.env.PG_PASS,
  },
};
