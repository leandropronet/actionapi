-- Schema RAW: espelho fiel do Oracle. Armazena os dados exatamente como
-- vieram da fonte. _dados JSONB contém o registro completo — colunas
-- específicas são adicionadas quando o schema Oracle for mapeado.

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS audit;

-- Controle do ETL incremental (jobs agendados)
CREATE TABLE IF NOT EXISTS etl_sync (
  dominio      TEXT PRIMARY KEY,
  ultimo_sync  TIMESTAMPTZ NOT NULL DEFAULT '2020-01-01 00:00:00+00',
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO etl_sync (dominio) VALUES
  ('faturamento'),
  ('duplicatas'),
  ('pedidos'),
  ('estoque'),
  ('financeiro_cp'),
  ('financeiro_cr'),
  ('contabil'),
  ('clientes'),
  ('produtos'),
  ('filiais'),
  ('vendedores'),
  ('recebimentos'),
  ('pagamentos')
ON CONFLICT (dominio) DO NOTHING;

-- Controle da carga inicial (batch por janela mensal + filial)
CREATE TABLE IF NOT EXISTS etl_carga_inicial (
  id              SERIAL PRIMARY KEY,
  dominio         TEXT NOT NULL,
  filial_id       TEXT NOT NULL,
  janela_inicio   DATE NOT NULL,
  janela_fim      DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente | em_progresso | concluido | erro
  registros       INT DEFAULT 0,
  erro            TEXT,
  iniciado_em     TIMESTAMPTZ,
  concluido_em    TIMESTAMPTZ,
  UNIQUE (dominio, filial_id, janela_inicio)
);

-- ---------------------------------------------------------------
-- FATURAMENTO / NF-e
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.faturamento (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  data_emissao    DATE,
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- DUPLICATAS (títulos financeiros a receber)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.duplicatas (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  nf_id           TEXT,
  data_emissao    DATE,
  data_vencimento DATE,
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- PEDIDOS DE VENDA
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.pedidos (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  cliente_id      TEXT,
  data_pedido     DATE,
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS raw.pedidos_itens (
  id              TEXT NOT NULL,
  pedido_id       TEXT NOT NULL,
  produto_id      TEXT,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- ESTOQUE
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.estoque (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  produto_id      TEXT,
  deposito_id     TEXT,
  data_posicao    DATE,
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- FINANCEIRO: contas a pagar
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.financeiro_cp (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  data_emissao    DATE,
  data_vencimento DATE,
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- FINANCEIRO: contas a receber
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.financeiro_cr (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  data_emissao    DATE,
  data_vencimento DATE,
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- CONTABILIDADE
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.contabil (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  data_lancamento DATE,
  competencia     TEXT,  -- AAAA-MM
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- DIMENSÕES (cadastros)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.clientes (
  id              TEXT NOT NULL,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS raw.produtos (
  id              TEXT NOT NULL,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS raw.filiais (
  id              TEXT NOT NULL,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS raw.vendedores (
  id              TEXT NOT NULL,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- RECEBIMENTOS — CRCBAIXA (baixas de contas a receber)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.recebimentos (
  id              TEXT NOT NULL,   -- SEQU_BAI
  parcela_id      TEXT,            -- CTRL_REC → raw.duplicatas
  filial_id       TEXT,
  data_pagamento  DATE,
  valor           NUMERIC(18,2),
  multa           NUMERIC(18,2),
  juros           NUMERIC(18,2),
  desconto        NUMERIC(18,2),
  acrescimo       NUMERIC(18,2),
  recibo_id       TEXT,
  status          CHAR(1),         -- N=Normal, E=Estornada
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- PAGAMENTOS — CPGBAIXA (baixas de contas a pagar)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.pagamentos (
  id              TEXT NOT NULL,   -- SEQU_CPB
  parcela_id      TEXT,            -- CTRL_PAG → raw.financeiro_cp
  filial_id       TEXT,
  data_pagamento  DATE,
  valor           NUMERIC(18,2),
  multa           NUMERIC(18,2),
  juros           NUMERIC(18,2),
  desconto        NUMERIC(18,2),
  acrescimo       NUMERIC(18,2),
  status          CHAR(1),         -- N=Normal, E=Estornada
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);
