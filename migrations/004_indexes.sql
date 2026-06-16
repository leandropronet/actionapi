-- Índices para performance nas consultas do SaaS

-- RAW: índices nos campos de filtro mais comuns
CREATE INDEX IF NOT EXISTS idx_raw_faturamento_filial_data   ON raw.faturamento(filial_id, data_emissao);
CREATE INDEX IF NOT EXISTS idx_raw_faturamento_data_alter    ON raw.faturamento(data_alteracao);
CREATE INDEX IF NOT EXISTS idx_raw_duplicatas_filial_venc    ON raw.duplicatas(filial_id, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_raw_duplicatas_nf             ON raw.duplicatas(nf_id);
CREATE INDEX IF NOT EXISTS idx_raw_duplicatas_data_alter     ON raw.duplicatas(data_alteracao);
CREATE INDEX IF NOT EXISTS idx_raw_pedidos_filial_data       ON raw.pedidos(filial_id, data_pedido);
CREATE INDEX IF NOT EXISTS idx_raw_pedidos_cliente           ON raw.pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_raw_pedidos_data_alter        ON raw.pedidos(data_alteracao);
CREATE INDEX IF NOT EXISTS idx_raw_pedidos_itens_pedido      ON raw.pedidos_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_raw_estoque_filial_produto    ON raw.estoque(filial_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_raw_estoque_data_alter        ON raw.estoque(data_alteracao);
CREATE INDEX IF NOT EXISTS idx_raw_financeiro_cp_filial_venc ON raw.financeiro_cp(filial_id, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_raw_financeiro_cr_filial_venc ON raw.financeiro_cr(filial_id, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_raw_contabil_filial_comp      ON raw.contabil(filial_id, competencia);

-- ANALYTICS: índices nas fact tables
CREATE INDEX IF NOT EXISTS idx_fact_fat_data        ON analytics.fact_faturamento(data_id);
CREATE INDEX IF NOT EXISTS idx_fact_fat_filial      ON analytics.fact_faturamento(filial_id);
CREATE INDEX IF NOT EXISTS idx_fact_fat_cliente     ON analytics.fact_faturamento(cliente_id);
CREATE INDEX IF NOT EXISTS idx_fact_fat_produto     ON analytics.fact_faturamento(produto_id);
CREATE INDEX IF NOT EXISTS idx_fact_fat_vendedor    ON analytics.fact_faturamento(vendedor_id);

CREATE INDEX IF NOT EXISTS idx_fact_ped_data        ON analytics.fact_pedidos(data_id);
CREATE INDEX IF NOT EXISTS idx_fact_ped_filial      ON analytics.fact_pedidos(filial_id);
CREATE INDEX IF NOT EXISTS idx_fact_ped_cliente     ON analytics.fact_pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_fact_ped_status      ON analytics.fact_pedidos(status);

CREATE INDEX IF NOT EXISTS idx_fact_est_filial_prod ON analytics.fact_estoque(filial_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_fact_est_data        ON analytics.fact_estoque(data_id);

CREATE INDEX IF NOT EXISTS idx_fact_fin_tipo_filial ON analytics.fact_financeiro(tipo, filial_id);
CREATE INDEX IF NOT EXISTS idx_fact_fin_venc        ON analytics.fact_financeiro(data_venc_id);
CREATE INDEX IF NOT EXISTS idx_fact_fin_status      ON analytics.fact_financeiro(status);

CREATE INDEX IF NOT EXISTS idx_fact_cont_filial     ON analytics.fact_contabil(filial_id, competencia);
CREATE INDEX IF NOT EXISTS idx_fact_cont_conta      ON analytics.fact_contabil(conta);

-- JSONB: índices GIN para consultas dentro do _dados
CREATE INDEX IF NOT EXISTS idx_raw_faturamento_dados ON raw.faturamento USING GIN (_dados);
CREATE INDEX IF NOT EXISTS idx_raw_duplicatas_dados  ON raw.duplicatas  USING GIN (_dados);
CREATE INDEX IF NOT EXISTS idx_raw_pedidos_dados     ON raw.pedidos     USING GIN (_dados);
CREATE INDEX IF NOT EXISTS idx_raw_estoque_dados     ON raw.estoque     USING GIN (_dados);
