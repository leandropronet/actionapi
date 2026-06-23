'use strict';
const pg = require('./db/postgres');
const telegram = require('./telegram');

const startedAt = Date.now();

async function garantirSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS etl_job_status (
      job_name TEXT PRIMARY KEY,
      last_started_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_error_at TIMESTAMPTZ,
      last_error TEXT,
      duration_ms BIGINT,
      consecutive_failures INT NOT NULL DEFAULT 0,
      last_result JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS etl_alert_state (
      alert_key TEXT PRIMARY KEY,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      last_sent_at TIMESTAMPTZ,
      last_message TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function registrarInicio(jobName) {
  await pg.query(
    `INSERT INTO etl_job_status (job_name, last_started_at, updated_at)
     VALUES ($1, NOW(), NOW())
     ON CONFLICT (job_name) DO UPDATE SET
       last_started_at = NOW(), updated_at = NOW()`,
    [jobName],
  );
}

async function registrarSucesso(jobName, started, result) {
  await pg.query(
    `INSERT INTO etl_job_status (
       job_name, last_started_at, last_success_at, duration_ms,
       consecutive_failures, last_error, last_result, updated_at
     )
     VALUES ($1, $2, NOW(), $3, 0, NULL, $4::jsonb, NOW())
     ON CONFLICT (job_name) DO UPDATE SET
       last_started_at = EXCLUDED.last_started_at,
       last_success_at = EXCLUDED.last_success_at,
       duration_ms = EXCLUDED.duration_ms,
       consecutive_failures = 0,
       last_error = NULL,
       last_result = EXCLUDED.last_result,
       updated_at = NOW()`,
    [jobName, started, Date.now() - started.getTime(), JSON.stringify(result ?? null)],
  );
  await resolverAlerta(
    `job_error:${jobName}`,
    `${telegram.cabecalho('✅ RECUPERADO')}\nJob: ${jobName}\nExecução voltou ao normal.`,
  );
}

async function registrarErro(jobName, started, error) {
  const message = String(error?.stack || error?.message || error).slice(0, 8000);
  await pg.query(
    `INSERT INTO etl_job_status (
       job_name, last_started_at, last_error_at, last_error,
       duration_ms, consecutive_failures, updated_at
     )
     VALUES ($1, $2, NOW(), $3, $4, 1, NOW())
     ON CONFLICT (job_name) DO UPDATE SET
       last_started_at = EXCLUDED.last_started_at,
       last_error_at = EXCLUDED.last_error_at,
       last_error = EXCLUDED.last_error,
       duration_ms = EXCLUDED.duration_ms,
       consecutive_failures = etl_job_status.consecutive_failures + 1,
       updated_at = NOW()`,
    [jobName, started, message, Date.now() - started.getTime()],
  );
  await ativarAlerta(
    `job_error:${jobName}`,
    `${telegram.cabecalho('🚨 ERRO')}\nJob: ${jobName}\n${String(error?.message || error).slice(0, 2500)}`,
  );
}

function monitorados() {
  const raw = process.env.ETL_MONITOR_JOBS
    || 'duplicatas:120,recebimentos:120,pagamentos:120,financeiro_saldos_local:120,reconciliacao_financeira_recente:1560';
  return raw.split(',').map((item) => {
    const [jobName, minutes] = item.trim().split(':');
    return { jobName, minutes: Number(minutes) };
  }).filter((item) => item.jobName && Number.isFinite(item.minutes));
}

async function ativarAlerta(key, message) {
  const repeatMinutes = Number(process.env.TELEGRAM_ALERT_REPEAT_MINUTES || 360);
  const result = await pg.query(
    `SELECT active, last_sent_at
     FROM etl_alert_state
     WHERE alert_key = $1`,
    [key],
  );
  const state = result.rows[0];
  const repeatDue = !state?.last_sent_at
    || Date.now() - new Date(state.last_sent_at).getTime() >= repeatMinutes * 60000;
  if (!state?.active || repeatDue) {
    let delivered = false;
    try {
      const result = await telegram.enviar(message);
      delivered = result.enviado;
    } catch (error) {
      console.error('[telegram] falha ao enviar alerta:', error.message);
    }
    if (!delivered) return;
    await pg.query(
      `INSERT INTO etl_alert_state (
         alert_key, active, last_sent_at, last_message, updated_at
       )
       VALUES ($1, TRUE, NOW(), $2, NOW())
       ON CONFLICT (alert_key) DO UPDATE SET
         active = TRUE, last_sent_at = NOW(),
         last_message = EXCLUDED.last_message, updated_at = NOW()`,
      [key, message],
    );
  }
}

async function resolverAlerta(key, message) {
  const result = await pg.query(
    'SELECT active FROM etl_alert_state WHERE alert_key = $1',
    [key],
  );
  if (!result.rows[0]?.active) return;
  if (!telegram.configurado()) {
    await pg.query(
      `UPDATE etl_alert_state
       SET active = FALSE, last_message = $2, updated_at = NOW()
       WHERE alert_key = $1`,
      [key, message],
    );
    return;
  }
  let delivered = false;
  try {
    const delivery = await telegram.enviar(message);
    delivered = delivery.enviado;
  } catch (error) {
    console.error('[telegram] falha ao enviar recuperação:', error.message);
  }
  if (!delivered) return;
  await pg.query(
    `UPDATE etl_alert_state
     SET active = FALSE, last_sent_at = NOW(),
         last_message = $2, updated_at = NOW()
     WHERE alert_key = $1`,
    [key, message],
  );
}

async function verificarAtrasos() {
  const graceMinutes = Number(process.env.ETL_MONITOR_STARTUP_GRACE_MINUTES || 20);
  if (Date.now() - startedAt < graceMinutes * 60000) return;

  for (const item of monitorados()) {
    const result = await pg.query(
      `SELECT last_success_at
       FROM etl_job_status
       WHERE job_name = $1`,
      [item.jobName],
    );
    const lastSuccess = result.rows[0]?.last_success_at
      ? new Date(result.rows[0].last_success_at)
      : null;
    const ageMinutes = lastSuccess
      ? Math.floor((Date.now() - lastSuccess.getTime()) / 60000)
      : null;
    const key = `job_stale:${item.jobName}`;

    if (ageMinutes === null || ageMinutes > item.minutes) {
      await ativarAlerta(
        key,
        `${telegram.cabecalho('⚠️ ATRASO')}\nJob: ${item.jobName}\n`
          + `Último sucesso: ${lastSuccess?.toISOString() || 'nunca registrado'}\n`
          + `Limite: ${item.minutes} minutos.`,
      );
    } else {
      await resolverAlerta(
        key,
        `${telegram.cabecalho('✅ RECUPERADO')}\nJob: ${item.jobName}\n`
          + `Último sucesso: ${lastSuccess.toISOString()}.`,
      );
    }
  }
}

module.exports = {
  garantirSchema,
  registrarInicio,
  registrarSucesso,
  registrarErro,
  verificarAtrasos,
};
