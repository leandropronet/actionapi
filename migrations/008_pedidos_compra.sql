-- Pedidos de Compra (PEDCOM + IPEDCOM + PARCPEDCOM)
-- Domínio novo: até aqui o ETL só trazia Pedidos de Venda (PEDIDO/IPEDIDO).
-- Saldo em aberto do item = qtd_pedida - qtd_recebida (calculado em query, não armazenado).

CREATE TABLE IF NOT EXISTS raw.pedidos_compra (
  id                TEXT        PRIMARY KEY,          -- {CODI_EMP}_{NUME_PEC}
  filial_id         TEXT,                             -- CODI_EMP
  numero            TEXT,                              -- NUME_PEC
  fornecedor_id     TEXT,                              -- CODI_TRA → raw.clientes
  operacao_id       TEXT,                              -- CODI_TOP
  data_pedido       DATE,                              -- DATA_PEC
  data_previsao     DATE,                              -- DPRE_PEC
  data_cancelamento DATE,                              -- DCAN_PEC
  status            CHAR(1),                           -- P=Pendente, A=Aprovado, C=Cancelado
  valor_total       NUMERIC(18,2),                     -- TOTA_PEC
  data_alteracao    TIMESTAMPTZ,
  _dados            JSONB       NOT NULL DEFAULT '{}',
  _sync_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source           TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE TABLE IF NOT EXISTS raw.pedidos_compra_itens (
  id              TEXT        PRIMARY KEY,            -- {CODI_EMP}_{NUME_PEC}_{CODI_PSV}
  pedido_id       TEXT        NOT NULL,                -- FK → raw.pedidos_compra
  produto_id      TEXT,                                -- CODI_PSV
  qtd_pedida      NUMERIC(18,4),                        -- QTDP_IPC
  qtd_recebida    NUMERIC(18,4),                        -- QTDR_IPC
  valor_unitario  NUMERIC(18,4),                        -- VLOR_IPC
  valor_liquido   NUMERIC(18,4),                        -- VLIQ_IPC
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB       NOT NULL DEFAULT '{}',
  _sync_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source         TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE TABLE IF NOT EXISTS raw.pedidos_compra_parcelas (
  id              TEXT        PRIMARY KEY,            -- CTRL_PPC
  pedido_id       TEXT        NOT NULL,                -- FK → raw.pedidos_compra
  data_vencimento DATE,                                -- VENC_PPC
  valor           NUMERIC(18,2),                       -- VLOR_PPC
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB       NOT NULL DEFAULT '{}',
  _sync_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source         TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_pedcompra_filial      ON raw.pedidos_compra(filial_id);
CREATE INDEX IF NOT EXISTS idx_pedcompra_fornecedor  ON raw.pedidos_compra(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_pedcompra_status      ON raw.pedidos_compra(status);
CREATE INDEX IF NOT EXISTS idx_pedcompra_data        ON raw.pedidos_compra(data_pedido);

CREATE INDEX IF NOT EXISTS idx_pedcompra_itens_pedido  ON raw.pedidos_compra_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedcompra_itens_produto ON raw.pedidos_compra_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_pedcompra_itens_aberto  ON raw.pedidos_compra_itens(produto_id)
  WHERE qtd_pedida > qtd_recebida;

CREATE INDEX IF NOT EXISTS idx_pedcompra_parcelas_pedido ON raw.pedidos_compra_parcelas(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedcompra_parcelas_venc   ON raw.pedidos_compra_parcelas(data_vencimento);

-- Carga inicial: pega todo o histórico (PEDCOM tem registros desde 2007) na
-- primeira execução incremental, já que o volume é pequeno (~6.500 cabeçalhos).
INSERT INTO etl_sync (dominio, ultimo_sync) VALUES
  ('pedidos_compra', '2007-01-01 00:00:00+00')
ON CONFLICT (dominio) DO NOTHING;
