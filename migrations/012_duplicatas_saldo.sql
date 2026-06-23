-- Saldo em aberto de Contas a Receber (Duplicatas), calculado via a função
-- oficial do Oracle VALOR_ABERTO_RECEBER_DATA — validada em 2026-06-20 contra
-- o relatório "Contas a Receber por Cliente - Data" do SiAGRI (bateu exato,
-- R$ 157.092.758,96, considerando a moeda secundária SJ$ em valor de face).
--
-- Snapshot diário (mesmo padrão de raw.saldo_lote): TRUNCATE + INSERT, porque
-- o saldo de qualquer parcela pode mudar (baixa, estorno, cancelamento).
-- Este snapshot continua sendo a referência oficial. A reprodução local
-- completa foi adicionada posteriormente na migração 014, após a leitura do
-- código-fonte da função (indexadores, data de cada baixa, agrupamentos e
-- tolerância por filial).

CREATE TABLE IF NOT EXISTS raw.duplicatas_saldo (
  id                       TEXT        PRIMARY KEY,  -- CTRL_REC
  nf_id                    TEXT,                      -- CTRL_CBR
  filial_id                TEXT,
  cliente_id               TEXT,
  tipo_documento           TEXT,                      -- CODI_TDO
  natureza_tipo_documento  CHAR(1),                   -- D=Débito, C=Crédito
  numero_documento         TEXT,
  serie_documento          TEXT,
  parcela_nr               TEXT,
  data_emissao             DATE,
  data_vencimento          DATE,
  valor_parcela            NUMERIC(18,2),
  saldo_funcao             NUMERIC(18,2),              -- valor bruto de VALOR_ABERTO_RECEBER_DATA
  saldo_ajustado           NUMERIC(18,2),              -- com sinal invertido se natureza=C
  dias_atraso              INT,
  data_calculo             DATE        NOT NULL,        -- DT_CALC usado na chamada da função
  _sync_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _source                  TEXT        NOT NULL DEFAULT 'siagri'
);

CREATE INDEX IF NOT EXISTS idx_dup_saldo_cliente  ON raw.duplicatas_saldo (cliente_id);
CREATE INDEX IF NOT EXISTS idx_dup_saldo_filial   ON raw.duplicatas_saldo (filial_id);
CREATE INDEX IF NOT EXISTS idx_dup_saldo_venc      ON raw.duplicatas_saldo (data_vencimento);

INSERT INTO etl_sync (dominio) VALUES ('duplicatas_saldo')
ON CONFLICT (dominio) DO NOTHING;
