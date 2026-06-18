-- Cabeçalhos necessários para conciliação financeiro × contábil e consumo por BI.

CREATE TABLE IF NOT EXISTS raw.contabil_cabecalhos (
  id               TEXT PRIMARY KEY,     -- SEQU_CLC
  filial_id        TEXT,                 -- EDOC_CLC / CODI_EMP / CORI_EMP
  data_lancamento  DATE,
  competencia      TEXT,
  origem           TEXT,                 -- ORIG_CLC
  documento        TEXT,                 -- CTRL_CLC
  parceiro_id      TEXT,                 -- CODI_TRA
  serie_documento  TEXT,                 -- SDOC_CLC
  empresa_documento TEXT,                -- EDOC_CLC
  valor            NUMERIC(18,2),        -- VCON_CLC
  tipo             TEXT,                 -- TIPO_CLC
  data_alteracao   TIMESTAMPTZ,
  _dados           JSONB NOT NULL DEFAULT '{}',
  _sync_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source          TEXT NOT NULL DEFAULT 'siagri'
);

CREATE TABLE IF NOT EXISTS raw.financeiro_titulos (
  id               TEXT PRIMARY KEY,     -- CP_CTRL_CPG / CR_CTRL_CBR
  tipo             CHAR(2) NOT NULL,     -- CP / CR
  titulo_id        TEXT NOT NULL,
  filial_id        TEXT,
  parceiro_id      TEXT,
  tipo_documento   TEXT,
  numero_documento TEXT,
  serie_documento  TEXT,
  data_emissao     DATE,
  valor_total      NUMERIC(18,2),
  status           TEXT,
  data_alteracao   TIMESTAMPTZ,
  _dados           JSONB NOT NULL DEFAULT '{}',
  _sync_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source          TEXT NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_contab_cab_data
  ON raw.contabil_cabecalhos(data_lancamento);
CREATE INDEX IF NOT EXISTS idx_contab_cab_origem_doc
  ON raw.contabil_cabecalhos(origem, documento);
CREATE INDEX IF NOT EXISTS idx_contab_cab_cr_match
  ON raw.contabil_cabecalhos(origem, documento, serie_documento, empresa_documento, parceiro_id);
CREATE INDEX IF NOT EXISTS idx_contab_cab_parceiro
  ON raw.contabil_cabecalhos(parceiro_id);

CREATE INDEX IF NOT EXISTS idx_fin_titulos_tipo_data
  ON raw.financeiro_titulos(tipo, data_emissao);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_filial
  ON raw.financeiro_titulos(filial_id);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_parceiro
  ON raw.financeiro_titulos(parceiro_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_titulos_natural
  ON raw.financeiro_titulos(tipo, titulo_id);

INSERT INTO etl_sync (dominio, ultimo_sync) VALUES
  ('contabil_cabecalhos', '2025-01-01 00:00:00+00'),
  ('financeiro_titulos_cp', '2025-01-01 00:00:00+00'),
  ('financeiro_titulos_cr', '2025-01-01 00:00:00+00')
ON CONFLICT (dominio) DO NOTHING;
