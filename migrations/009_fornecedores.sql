-- Fornecedores (TRANSAC com FORN_TRA='S') — espelha raw.clientes, mas sem
-- depender da extensão CLIENTE. Um parceiro pode existir nas duas tabelas
-- se for cliente e fornecedor ao mesmo tempo.

CREATE TABLE IF NOT EXISTS raw.fornecedores (
  id              TEXT        PRIMARY KEY,            -- CODI_TRA
  razao_social    TEXT,                                -- RAZA_TRA
  cgc_cnpj        TEXT,                                -- CGC_TRA (CPF ou CNPJ)
  status          CHAR(1),                             -- SITU_TRA: A=Ativo, I=Inativo
  _dados          JSONB       NOT NULL DEFAULT '{}',
  _sync_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source         TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_razao  ON raw.fornecedores (razao_social);
CREATE INDEX IF NOT EXISTS idx_fornecedores_cgc    ON raw.fornecedores (cgc_cnpj);
CREATE INDEX IF NOT EXISTS idx_fornecedores_status ON raw.fornecedores (status);

INSERT INTO etl_sync (dominio) VALUES ('fornecedores')
ON CONFLICT (dominio) DO NOTHING;
