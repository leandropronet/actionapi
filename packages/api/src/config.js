'use strict';
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
