'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const telegram = require('../telegram');

(async () => {
  if (!telegram.configurado()) {
    throw new Error('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
  }
  await telegram.enviar(
    `${telegram.cabecalho('✅ TESTE')}\nAlertas do ETL configurados com sucesso.`,
  );
  console.log('[testar-telegram] mensagem enviada');
})().catch((error) => {
  console.error('[testar-telegram] erro:', error.message);
  process.exitCode = 1;
});
