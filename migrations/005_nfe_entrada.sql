-- NF-e de Entrada (NFENTRA + INFENTRA)
-- Armazena notas fiscais recebidas pelo SiAGRI:
--   compras de fornecedores e devoluções de clientes.
-- Para cálculo do faturamento líquido: incluir nfe_entrada_itens com funcao='S'
-- em param_oper_detalhe como deduções adicionais.

CREATE TABLE IF NOT EXISTS raw.nfe_entrada (
  id               TEXT        PRIMARY KEY,          -- CTRL_NFE
  filial_id        TEXT,                             -- CODI_EMP
  operacao_id      TEXT,                             -- CODI_TOP (cabeçalho)
  data_emissao     DATE,                             -- DEMI_NFE
  data_recebimento DATE,                             -- DREC_NFE
  data_alteracao   TIMESTAMPTZ,                      -- DUMANUT
  _dados           JSONB       NOT NULL DEFAULT '{}',
  _sync_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source          TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE TABLE IF NOT EXISTS raw.nfe_entrada_itens (
  id               TEXT        PRIMARY KEY,          -- CTRL_NFE_ITEM_INF
  nfe_entrada_id   TEXT        NOT NULL,             -- CTRL_NFE (FK)
  produto_id       TEXT,                             -- CODI_PSV
  operacao_id      TEXT,                             -- CODI_TOP (item, nullable)
  data_recebimento DATE,                             -- DREC_INF
  _dados           JSONB       NOT NULL DEFAULT '{}',
  _sync_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source          TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_nfe_entrada_filial    ON raw.nfe_entrada(filial_id);
CREATE INDEX IF NOT EXISTS idx_nfe_entrada_emissao   ON raw.nfe_entrada(data_emissao);
CREATE INDEX IF NOT EXISTS idx_nfe_entrada_receb     ON raw.nfe_entrada(data_recebimento);
CREATE INDEX IF NOT EXISTS idx_nfe_entrada_operacao  ON raw.nfe_entrada(operacao_id);
CREATE INDEX IF NOT EXISTS idx_nfe_entrada_dados     ON raw.nfe_entrada USING gin(_dados);

CREATE INDEX IF NOT EXISTS idx_nfe_itens_nfe         ON raw.nfe_entrada_itens(nfe_entrada_id);
CREATE INDEX IF NOT EXISTS idx_nfe_itens_produto     ON raw.nfe_entrada_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_nfe_itens_operacao    ON raw.nfe_entrada_itens(operacao_id);
CREATE INDEX IF NOT EXISTS idx_nfe_itens_dados       ON raw.nfe_entrada_itens USING gin(_dados);

-- Registra domínio no controle de sync incremental
INSERT INTO etl_sync (dominio)
VALUES ('nfe_entrada')
ON CONFLICT (dominio) DO NOTHING;
