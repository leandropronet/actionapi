'use strict';
const os = require('os');

function configurado() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function enviar(mensagem) {
  if (!configurado()) {
    console.log('[telegram] não configurado; alerta apenas no log');
    return { enviado: false, motivo: 'nao_configurado' };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: mensagem,
    disable_web_page_preview: true,
  };
  if (process.env.TELEGRAM_MESSAGE_THREAD_ID) {
    body.message_thread_id = Number(process.env.TELEGRAM_MESSAGE_THREAD_ID);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.TELEGRAM_TIMEOUT_MS || 10000),
  );
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(
        `Telegram HTTP ${response.status}: ${payload.description || 'erro desconhecido'}`,
      );
    }
    return { enviado: true };
  } finally {
    clearTimeout(timeout);
  }
}

function cabecalho(tipo) {
  const ambiente = process.env.NODE_ENV || 'development';
  return `${tipo} ActionAPI ETL\nHost: ${os.hostname()}\nAmbiente: ${ambiente}`;
}

module.exports = { configurado, enviar, cabecalho };
