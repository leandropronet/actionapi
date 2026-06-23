-- Vínculo oficial entre título a pagar (CABPAGAR) e NF de entrada (NFENTRA),
-- via NOTACPG.CTRL_NCP (FK direta para NFENTRA.CTRL_NFE — validada com 98,4%
-- de integridade em 2026-06). Muito mais confiável que comparar o número do
-- documento digitado (DOCU_CPG) com o número da NF, que tem erros de digitação.

ALTER TABLE raw.financeiro_titulos ADD COLUMN IF NOT EXISTS nf_entrada_id TEXT;

CREATE INDEX IF NOT EXISTS idx_fin_titulos_nf_entrada
  ON raw.financeiro_titulos (nf_entrada_id) WHERE nf_entrada_id IS NOT NULL;
