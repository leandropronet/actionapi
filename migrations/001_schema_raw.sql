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
  ('pagamentos'),
  ('lotes'),
  ('operacoes'),
  ('grupos'),
  ('dadospro'),
  ('saldo_lote'),
  ('param_oper'),
  ('param_oper_detalhe')
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
-- PARAMETRIZAÇÃO DE TIPO DE OPERAÇÃO — PARTOPER (cabeçalho, tela Tran121)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.param_oper (
  id              TEXT NOT NULL,   -- CODI_PTO
  descricao       TEXT,            -- DESC_PTO (ex: 102="VENDAS - DEVOLUCAO")
  tipo            CHAR(1),         -- E=Entrada, S=Saída
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- FUNÇÕES DE TIPO DE OPERAÇÃO — FUNCAOTOPER (detalhe do Tran121)
--   CODI_PTO × CODI_TOP → FUNC_TOP (A=Adicionar / S=Subtrair)
--   Uso: faturamento líquido = SUM(valor WHERE funcao='A') - SUM(valor WHERE funcao='S')
--        agrupado por param_id (ex: 102 = VENDAS - DEVOLUCAO)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.param_oper_detalhe (
  id              TEXT NOT NULL,   -- CODI_PTO_CODI_TOP
  param_id        TEXT,            -- FK → raw.param_oper
  operacao_id     TEXT,            -- FK → raw.operacoes (CODI_TOP)
  funcao          CHAR(1),         -- A=Adicionar, S=Subtrair
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_param_oper_detalhe_param
  ON raw.param_oper_detalhe (param_id, funcao);

-- ---------------------------------------------------------------
-- GRUPOS DE PRODUTO — GRUPO
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.grupos (
  id              TEXT NOT NULL,   -- CODI_GPR
  descricao       TEXT,            -- DESC_GPR (Defensivos, Sementes, Adubos...)
  status          CHAR(1),         -- A=Ativo, I=Inativo
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- PRODUTO POR FILIAL — DADOSPRO
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.dadospro (
  id              TEXT NOT NULL,   -- CODI_EMP_CODI_PSV
  filial_id       TEXT,
  produto_id      TEXT,
  est_min         NUMERIC(18,4),   -- EMIN_DAD (estoque mínimo — alerta reposição)
  est_max         NUMERIC(18,4),   -- EMAX_DAD
  status          CHAR(1),         -- A=Ativo, I=Inativo
  locacao         TEXT,            -- LOCA_DAD (posição física no depósito)
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- SALDO POR LOTE — snapshot diário calculado via SALDO_LOTE()
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.saldo_lote (
  id               TEXT NOT NULL,   -- CODI_EMP_CODI_PSV_LOTE_LOT
  filial_id        TEXT,
  produto_id       TEXT,            -- FK → raw.produtos
  produto_desc     TEXT,
  grupo_id         TEXT,            -- FK → raw.grupos
  grupo_desc       TEXT,
  lote             TEXT,
  data_validade    DATE,            -- VALG_LOT — chave para dashboards de vencimento
  data_fabricacao  DATE,            -- DTFA_LOT
  tipo_lote        CHAR(1),         -- S=Semente, etc.
  saldo            NUMERIC(18,4),   -- retorno de SALDO_LOTE(..., 'F', NULL)
  data_referencia  DATE NOT NULL,   -- data do snapshot (SYSDATE ao gerar)
  _source          TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- Índice para o dashboard "a vencer em N dias"
CREATE INDEX IF NOT EXISTS idx_saldo_lote_validade
  ON raw.saldo_lote (data_validade, grupo_id, filial_id);

-- ---------------------------------------------------------------
-- OPERAÇÕES FISCAIS — TIPOOPER (dimensão de tipos de operação)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.operacoes (
  id              TEXT NOT NULL,   -- CODI_TOP
  descricao       TEXT,            -- DESC_TOP
  status          CHAR(1),         -- A=Ativo, I=Inativo
  tran_top        CHAR(1),         -- 1=Entrada, 2=Saída, 3=Transferência
  tipo_top        CHAR(1),         -- E=Entrada, S=Saída
  template_id     TEXT,            -- CODI_TPL (grupo pai)
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- FATURAMENTO / NF-e
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.faturamento (
  id              TEXT NOT NULL,
  filial_id       TEXT,
  data_emissao    DATE,
  operacao_id     TEXT,            -- CODI_TOP → raw.operacoes
  tran_top        CHAR(1),         -- 2=Venda (saída), 1=Compra (entrada), 3=Transf
  tipo_top        CHAR(1),         -- S=Saída, E=Entrada (devolução)
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
  cliente_id      TEXT,            -- CODI_TRA via JOIN CABREC
  tipo_doc        TEXT,            -- CODI_TDO via JOIN CABREC (101=dup, 103=adto, 106=dev)
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
-- LOTES — mestre de lotes com data de validade (VALG_LOT)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.lotes (
  id              TEXT NOT NULL,   -- CODI_PSV_LOTE_LOT
  produto_id      TEXT,            -- FK → raw.produtos
  lote            TEXT,
  tipo            CHAR(1),         -- S=Semente
  status          CHAR(1),         -- A=Ativo, I=Inativo
  data_validade   DATE,            -- VALG_LOT — campo-chave para dashboards
  data_fabricacao DATE,            -- DTFA_LOT
  fornecedor_id   TEXT,            -- FK → raw.clientes (TRANSAC)
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- LOTES POR FILIAL — quantidade inicial do lote por filial/depósito (ILOTE)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.lotes_filial (
  id              TEXT NOT NULL,   -- CODI_PSV_LOTE_LOT_CODI_EMP
  produto_id      TEXT,
  lote            TEXT,
  filial_id       TEXT,
  deposito_id     TEXT,
  qtd_inicial     NUMERIC(18,4),   -- QINI_ILO
  data_entrada    DATE,            -- DINI_ILO
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
