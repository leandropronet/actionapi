-- Dataset de apoio para o dashboard de Contas a Pagar.
--
-- O vínculo é estrutural e vem integralmente do SiAGRI:
--   CABPAGAR <- NOTACPG -> INFENTRA -> PEDCOM
--
-- Uma linha representa um item de nota de entrada relacionado a um título e
-- a um pedido de compra. A API agrega essas linhas antes de juntá-las às
-- parcelas para não multiplicar valores financeiros.

CREATE TABLE IF NOT EXISTS raw.financeiro_titulo_pedidos (
  id               TEXT        PRIMARY KEY, -- {CTRL_CPG}_{CTRL_NCP}_{ITEM_INF}
  titulo_id        TEXT        NOT NULL,    -- CABPAGAR.CTRL_CPG
  nf_entrada_id    TEXT        NOT NULL,    -- NOTACPG.CTRL_NCP / INFENTRA.CTRL_NFE
  pedido_id        TEXT        NOT NULL,    -- {EMPR_PEC}_{NUME_PEC}
  filial_pedido_id TEXT,                    -- INFENTRA.EMPR_PEC
  numero_pedido    TEXT,                    -- INFENTRA.NUME_PEC
  produto_id       TEXT,                    -- INFENTRA.CODI_PSV
  produto_descricao TEXT,                   -- PRODSERV.DESC_PSV
  item_nf          TEXT,                    -- INFENTRA.ITEM_INF
  data_alteracao   TIMESTAMPTZ,
  _dados           JSONB       NOT NULL DEFAULT '{}',
  _sync_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source          TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_fin_titulo_pedidos_titulo
  ON raw.financeiro_titulo_pedidos (titulo_id);
CREATE INDEX IF NOT EXISTS idx_fin_titulo_pedidos_nf
  ON raw.financeiro_titulo_pedidos (nf_entrada_id);
CREATE INDEX IF NOT EXISTS idx_fin_titulo_pedidos_pedido
  ON raw.financeiro_titulo_pedidos (pedido_id);
CREATE INDEX IF NOT EXISTS idx_fin_titulo_pedidos_produto
  ON raw.financeiro_titulo_pedidos (produto_id);

CREATE TABLE IF NOT EXISTS raw.tipos_documento (
  id              TEXT        PRIMARY KEY, -- TIPDOC.CODI_TDO
  descricao       TEXT,                    -- TIPDOC.DESC_TDO
  tipo            CHAR(1),                 -- TIPDOC.TIPO_TDO
  status          CHAR(1),                 -- TIPDOC.SITU_TDO
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB       NOT NULL DEFAULT '{}',
  _sync_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source         TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_tipos_documento_descricao
  ON raw.tipos_documento (descricao);

-- Índices usados pelo cálculo do saldo e pelo JOIN parcela -> título.
CREATE INDEX IF NOT EXISTS idx_pagamentos_parcela_status
  ON raw.pagamentos (parcela_id, status);
CREATE INDEX IF NOT EXISTS idx_financeiro_cp_titulo
  ON raw.financeiro_cp ((_dados->>'CAB_ID'));

INSERT INTO etl_sync (dominio, ultimo_sync) VALUES
  ('financeiro_titulo_pedidos', '1899-01-01 00:00:00+00'),
  ('tipos_documento', '1899-01-01 00:00:00+00')
ON CONFLICT (dominio) DO NOTHING;
