-- Schema ANALYTICS: star schema simplificado para consultas do SaaS.
-- Populado pelo ETL transform a partir do schema raw.
-- Os campos específicos são completados após mapeamento do Oracle.

-- ---------------------------------------------------------------
-- DIMENSÃO TEMPO (tabela calendário — 2020 a 2030)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.dim_tempo (
  data_id         INTEGER PRIMARY KEY,  -- YYYYMMDD
  data            DATE NOT NULL UNIQUE,
  ano             SMALLINT NOT NULL,
  semestre        SMALLINT NOT NULL,
  trimestre       SMALLINT NOT NULL,
  mes             SMALLINT NOT NULL,
  mes_nome        TEXT NOT NULL,
  semana_ano      SMALLINT NOT NULL,
  dia_mes         SMALLINT NOT NULL,
  dia_semana      SMALLINT NOT NULL,  -- 0=dom, 6=sab
  dia_semana_nome TEXT NOT NULL,
  eh_fim_semana   BOOLEAN NOT NULL,
  eh_ultimo_dia_mes BOOLEAN NOT NULL
);

-- Preenche dim_tempo de 2020-01-01 a 2030-12-31
INSERT INTO analytics.dim_tempo
SELECT
  TO_CHAR(d, 'YYYYMMDD')::INT AS data_id,
  d::DATE AS data,
  EXTRACT(YEAR FROM d)::SMALLINT AS ano,
  CEIL(EXTRACT(MONTH FROM d) / 6.0)::SMALLINT AS semestre,
  EXTRACT(QUARTER FROM d)::SMALLINT AS trimestre,
  EXTRACT(MONTH FROM d)::SMALLINT AS mes,
  TO_CHAR(d, 'TMMonth') AS mes_nome,
  EXTRACT(WEEK FROM d)::SMALLINT AS semana_ano,
  EXTRACT(DAY FROM d)::SMALLINT AS dia_mes,
  EXTRACT(DOW FROM d)::SMALLINT AS dia_semana,
  TO_CHAR(d, 'TMDay') AS dia_semana_nome,
  EXTRACT(DOW FROM d) IN (0, 6) AS eh_fim_semana,
  (d = DATE_TRUNC('month', d) + INTERVAL '1 month' - INTERVAL '1 day') AS eh_ultimo_dia_mes
FROM GENERATE_SERIES('2020-01-01'::DATE, '2030-12-31'::DATE, '1 day'::INTERVAL) AS d
ON CONFLICT (data) DO NOTHING;

-- ---------------------------------------------------------------
-- DIMENSÃO FILIAL
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.dim_filial (
  filial_id   TEXT PRIMARY KEY,
  nome        TEXT,
  cnpj        TEXT,
  uf          TEXT,
  municipio   TEXT,
  ativo       BOOLEAN DEFAULT TRUE,
  _sync_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- DIMENSÃO CLIENTE
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.dim_cliente (
  cliente_id      TEXT PRIMARY KEY,
  razao_social    TEXT,
  nome_fantasia   TEXT,
  cpf_cnpj        TEXT,
  tipo            TEXT,  -- PF | PJ
  uf              TEXT,
  municipio       TEXT,
  segmento        TEXT,
  categoria       TEXT,
  vendedor_id     TEXT,
  ativo           BOOLEAN DEFAULT TRUE,
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- DIMENSÃO PRODUTO
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.dim_produto (
  produto_id      TEXT PRIMARY KEY,
  descricao       TEXT,
  unidade         TEXT,
  familia         TEXT,
  categoria       TEXT,
  grupo           TEXT,
  ativo           BOOLEAN DEFAULT TRUE,
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- DIMENSÃO VENDEDOR
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.dim_vendedor (
  vendedor_id     TEXT PRIMARY KEY,
  nome            TEXT,
  equipe          TEXT,
  regiao          TEXT,
  ativo           BOOLEAN DEFAULT TRUE,
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- FATO FATURAMENTO
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.fact_faturamento (
  id              TEXT PRIMARY KEY,
  data_id         INTEGER REFERENCES analytics.dim_tempo(data_id),
  filial_id       TEXT REFERENCES analytics.dim_filial(filial_id),
  cliente_id      TEXT,
  produto_id      TEXT,
  vendedor_id     TEXT,
  numero_nf       TEXT,
  serie           TEXT,
  quantidade      NUMERIC(18,4),
  valor_unitario  NUMERIC(18,4),
  valor_total     NUMERIC(18,2),
  desconto        NUMERIC(18,2),
  valor_liquido   NUMERIC(18,2),
  custo           NUMERIC(18,2),
  margem          NUMERIC(18,2),
  status          TEXT,
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- FATO PEDIDOS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.fact_pedidos (
  id              TEXT PRIMARY KEY,
  data_id         INTEGER REFERENCES analytics.dim_tempo(data_id),
  filial_id       TEXT REFERENCES analytics.dim_filial(filial_id),
  cliente_id      TEXT,
  produto_id      TEXT,
  vendedor_id     TEXT,
  numero_pedido   TEXT,
  quantidade      NUMERIC(18,4),
  valor_unitario  NUMERIC(18,4),
  valor_total     NUMERIC(18,2),
  desconto        NUMERIC(18,2),
  status          TEXT,
  data_entrega_id INTEGER,
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- FATO ESTOQUE (snapshot diário)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.fact_estoque (
  id              TEXT PRIMARY KEY,
  data_id         INTEGER REFERENCES analytics.dim_tempo(data_id),
  filial_id       TEXT REFERENCES analytics.dim_filial(filial_id),
  produto_id      TEXT,
  deposito_id     TEXT,
  saldo           NUMERIC(18,4),
  valor_medio     NUMERIC(18,4),
  valor_total     NUMERIC(18,2),
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- FATO FINANCEIRO (CP + CR consolidados)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.fact_financeiro (
  id              TEXT PRIMARY KEY,
  tipo            TEXT NOT NULL,  -- CP | CR
  data_emissao_id INTEGER REFERENCES analytics.dim_tempo(data_id),
  data_venc_id    INTEGER REFERENCES analytics.dim_tempo(data_id),
  filial_id       TEXT REFERENCES analytics.dim_filial(filial_id),
  parceiro_id     TEXT,
  valor           NUMERIC(18,2),
  valor_pago      NUMERIC(18,2),
  saldo           NUMERIC(18,2),
  status          TEXT,  -- aberto | pago | parcial | cancelado
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- FATO CONTÁBIL
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.fact_contabil (
  id              TEXT PRIMARY KEY,
  data_id         INTEGER REFERENCES analytics.dim_tempo(data_id),
  competencia     TEXT,  -- AAAA-MM
  filial_id       TEXT REFERENCES analytics.dim_filial(filial_id),
  conta           TEXT,
  centro_custo    TEXT,
  historico       TEXT,
  debito          NUMERIC(18,2),
  credito         NUMERIC(18,2),
  _sync_at        TIMESTAMPTZ DEFAULT NOW()
);
