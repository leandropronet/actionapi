-- Estrutura para reproduzir localmente, no PostgreSQL, as funções oficiais:
--   VALOR_ABERTO_RECEBER_DATA
--   VALOR_ABERTO_PAGAR_DATA
--
-- Para títulos indexados, o saldo oficial é expresso em unidades do
-- indexador (SJ$, US$, ER etc.), e não em reais:
--   valor_face / cotação_origem - baixas / cotação_de_cada_baixa

ALTER TABLE raw.duplicatas
  ADD COLUMN IF NOT EXISTS tipo_documento TEXT,
  ADD COLUMN IF NOT EXISTS indexador_id TEXT,
  ADD COLUMN IF NOT EXISTS indexador_filial_id TEXT,
  ADD COLUMN IF NOT EXISTS data_indexador DATE;

ALTER TABLE raw.recebimentos
  ADD COLUMN IF NOT EXISTS indexador_id TEXT,
  ADD COLUMN IF NOT EXISTS data_indexador DATE;

ALTER TABLE raw.financeiro_cp
  ADD COLUMN IF NOT EXISTS parceiro_id TEXT,
  ADD COLUMN IF NOT EXISTS tipo_documento TEXT,
  ADD COLUMN IF NOT EXISTS indexador_id TEXT,
  ADD COLUMN IF NOT EXISTS data_indexador DATE;

ALTER TABLE raw.pagamentos
  ADD COLUMN IF NOT EXISTS indexador_id TEXT,
  ADD COLUMN IF NOT EXISTS data_indexador DATE,
  ADD COLUMN IF NOT EXISTS valor_complementar NUMERIC(18,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS raw.indexadores (
  id              TEXT PRIMARY KEY,
  descricao       TEXT,
  abreviatura     TEXT,
  tipo            CHAR(1),
  status          CHAR(1),
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL DEFAULT '{}',
  _sync_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source         TEXT NOT NULL DEFAULT 'siagri'
);

CREATE TABLE IF NOT EXISTS raw.indexador_valores (
  id              TEXT PRIMARY KEY, -- {CODI_EMP}_{CODI_IND}_{AAAA-MM-DD}
  filial_id       TEXT NOT NULL,
  indexador_id    TEXT NOT NULL,
  data_valor      DATE NOT NULL,
  valor           NUMERIC(21,9) NOT NULL,
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL DEFAULT '{}',
  _sync_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source         TEXT NOT NULL DEFAULT 'siagri'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_indexador_valores_natural
  ON raw.indexador_valores (filial_id, indexador_id, data_valor);

CREATE TABLE IF NOT EXISTS raw.param_ger_financ (
  id                    TEXT PRIMARY KEY, -- CODI_EMP
  data_base_baixa       DATE,             -- DBBA_PRF
  valor_diferenca       NUMERIC(10,4),    -- VLRD_PRF
  data_alteracao        TIMESTAMPTZ,
  _dados                JSONB NOT NULL DEFAULT '{}',
  _sync_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source               TEXT NOT NULL DEFAULT 'siagri'
);

CREATE TABLE IF NOT EXISTS raw.receber_agrupamentos (
  id                    TEXT PRIMARY KEY, -- CTRL_RAG
  parcela_id            TEXT NOT NULL,
  titulo_agrupador_id   TEXT,
  valor                 NUMERIC(21,9),
  data_titulo_agrupador DATE,
  data_alteracao        TIMESTAMPTZ,
  _dados                JSONB NOT NULL DEFAULT '{}',
  _sync_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source               TEXT NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_receber_agrupamentos_parcela
  ON raw.receber_agrupamentos (parcela_id);

CREATE TABLE IF NOT EXISTS raw.pagar_agrupamentos (
  id                    TEXT PRIMARY KEY,
  parcela_id            TEXT NOT NULL,
  titulo_agrupador_id   TEXT,
  valor                 NUMERIC(21,9),
  indexador_id          TEXT,
  indexador_filial_id   TEXT,
  data_indexador        DATE,
  data_titulo_agrupador DATE,
  data_alteracao        TIMESTAMPTZ,
  _dados                JSONB NOT NULL DEFAULT '{}',
  _sync_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source               TEXT NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_pagar_agrupamentos_parcela
  ON raw.pagar_agrupamentos (parcela_id);

CREATE TABLE IF NOT EXISTS raw.pagar_saldo_exclusoes (
  id              TEXT PRIMARY KEY, -- {motivo}_{CTRL_PAG}
  parcela_id      TEXT NOT NULL,
  motivo          TEXT NOT NULL,
  data_referencia DATE,
  _sync_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source         TEXT NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_pagar_saldo_exclusoes_parcela
  ON raw.pagar_saldo_exclusoes (parcela_id);

CREATE TABLE IF NOT EXISTS raw.financeiro_saldos_local (
  id                       TEXT PRIMARY KEY, -- CP_{parcela} / CR_{parcela}
  tipo                     CHAR(2) NOT NULL,
  parcela_id               TEXT NOT NULL,
  titulo_id                TEXT,
  filial_id                TEXT,
  parceiro_id              TEXT,
  tipo_documento           TEXT,
  natureza_tipo_documento  CHAR(1),
  valor_parcela_face       NUMERIC(21,9),
  indexador_id             TEXT,
  indexador_abreviatura    TEXT,
  valor_indexador_origem   NUMERIC(21,9),
  saldo_unidade            NUMERIC(21,9),
  saldo_ajustado           NUMERIC(21,9),
  valor_indexador_atual    NUMERIC(21,9),
  saldo_convertido_atual   NUMERIC(21,2),
  data_calculo             DATE NOT NULL,
  metodologia              TEXT NOT NULL,
  _sync_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source                  TEXT NOT NULL DEFAULT 'actionapi-local'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_saldos_local_tipo_parcela
  ON raw.financeiro_saldos_local (tipo, parcela_id);
CREATE INDEX IF NOT EXISTS idx_fin_saldos_local_parceiro
  ON raw.financeiro_saldos_local (tipo, parceiro_id);
CREATE INDEX IF NOT EXISTS idx_fin_saldos_local_saldo
  ON raw.financeiro_saldos_local (tipo, saldo_ajustado);

INSERT INTO etl_sync (dominio) VALUES
  ('financeiro_indexadores'),
  ('financeiro_saldos_local')
ON CONFLICT (dominio) DO NOTHING;
