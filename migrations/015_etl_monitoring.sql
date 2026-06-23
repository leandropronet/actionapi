CREATE TABLE IF NOT EXISTS etl_job_status (
  job_name              TEXT PRIMARY KEY,
  last_started_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error            TEXT,
  duration_ms           BIGINT,
  consecutive_failures  INT NOT NULL DEFAULT 0,
  last_result           JSONB,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etl_alert_state (
  alert_key     TEXT PRIMARY KEY,
  active        BOOLEAN NOT NULL DEFAULT FALSE,
  last_sent_at  TIMESTAMPTZ,
  last_message  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
