-- CRCBAIXA.VVCA_BAI — valor complementar da baixa (ajuste/encontro de contas,
-- aplicado junto com o pagamento em dinheiro). Sem capturar esse campo,
-- "VLOR_REC - SUM(baixas)" erra o saldo aberto — achado e validado em
-- 2026-06-20 contra o relatório "Contas a Receber por Cliente - Data"
-- (residual de R$8.406,59 a R$20.000,06 em parcelas reais, sempre batendo
-- exato com -1 * VVCA_BAI da baixa).

ALTER TABLE raw.recebimentos ADD COLUMN IF NOT EXISTS valor_complementar NUMERIC(18,2) DEFAULT 0;
