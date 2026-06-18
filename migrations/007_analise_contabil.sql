-- Dataset gerencial equivalente à "planilha de analise contabil.xlsx".

-- CODI_CCU se repete entre planos de contas. A chave anterior, apenas CODI_CCU,
-- fazia um plano sobrescrever a descrição do outro.
ALTER TABLE raw.ccusto ADD COLUMN IF NOT EXISTS ccusto_id TEXT;

UPDATE raw.ccusto
SET ccusto_id = id
WHERE ccusto_id IS NULL;

UPDATE raw.ccusto
SET id = COALESCE(plano_id, '') || '_' || ccusto_id
WHERE id <> COALESCE(plano_id, '') || '_' || ccusto_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccusto_plano_codigo
  ON raw.ccusto (plano_id, ccusto_id);

CREATE TABLE IF NOT EXISTS analytics.conta_gerencial (
  conta_id             TEXT PRIMARY KEY,
  conta_formatada      TEXT NOT NULL UNIQUE,
  natureza_contabil    TEXT,
  grupo_nivel_1        TEXT,
  grupo_nivel_2        TEXT,
  grupo_nivel_3        TEXT,
  classificacao_ebitda TEXT,
  origem_mapeamento    TEXT NOT NULL DEFAULT 'planilha_exemplo',
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conta_gerencial_classificacao
  ON analytics.conta_gerencial (classificacao_ebitda);

CREATE INDEX IF NOT EXISTS idx_contabil_analise_conta_partida
  ON raw.contabil (
    ((_dados->>'CODI_PLC')),
    ((_dados->>'CODI_CPC')),
    ((_dados->>'SEQU_LCT')),
    ((_dados->>'SEQU_CLC'))
  );
