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
  ('param_oper_detalhe'),
  ('propriedades'),
  ('propriedades_vendedor'),
  ('principios_ativos'),
  ('principios_ativos_rec'),
  ('produto_principio_ativo_rec'),
  -- contábil — novas tabelas (jun/2026)
  ('plcontas'),
  ('contaspl'),
  ('historico'),
  ('ccusto'),
  ('ccustolan'),
  ('idre'),
  ('contasdre'),
  ('contratofin'),
  ('corlanpes')
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
-- PROPRIEDADES RURAIS — PROPRIED
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.propriedades (
  id              TEXT NOT NULL,   -- PROP_PRO
  cliente_id      TEXT,            -- CODI_TRA → raw.clientes
  descricao       TEXT,            -- DESC_PRO (nome da fazenda)
  area            NUMERIC(18,4),   -- AREA_PRO em hectares
  status          CHAR(1),         -- A=Ativa, I=Inativa
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_propriedades_cliente
  ON raw.propriedades (cliente_id);

-- ---------------------------------------------------------------
-- VENDEDOR POR PROPRIEDADE — VENDEDORPROPRIED
--   Um vendedor por filial por propriedade (COD1_PES = principal)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.propriedades_vendedor (
  id              TEXT NOT NULL,   -- PROP_PRO_CODI_EMP
  propriedade_id  TEXT,            -- FK → raw.propriedades
  filial_id       TEXT,            -- CODI_EMP
  vendedor1_id    TEXT,            -- COD1_PES → raw.vendedores
  vendedor2_id    TEXT,            -- COD2_PES → raw.vendedores
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_prop_vendedor_prop
  ON raw.propriedades_vendedor (propriedade_id);

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
  _sync_at         TIMESTAMPTZ DEFAULT NOW(),
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
  pedido_id       TEXT,            -- PEDI_PED_SERI_PED (quando a NF veio de um pedido)
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- ITENS DE FATURAMENTO / NF-e
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.faturamento_itens (
  id          TEXT NOT NULL,   -- NPRE_NOT_ITEM_INO
  nf_id       TEXT,            -- FK → raw.faturamento
  produto_id  TEXT,            -- CODI_PSV
  pedido_id   TEXT,            -- PEDI_PED_SERI_PED (vínculo INOTA → PEDIDO)
  _dados      JSONB NOT NULL,
  _sync_at    TIMESTAMPTZ DEFAULT NOW(),
  _source     TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_fat_itens_nf ON raw.faturamento_itens (nf_id);
CREATE INDEX IF NOT EXISTS idx_fat_itens_pedido ON raw.faturamento_itens (pedido_id) WHERE pedido_id IS NOT NULL;

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
  origem          CHAR(1),         -- ORIG_PED: NULL=ERP direto, S=CRM, M=Mobile
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
  id              TEXT NOT NULL,   -- CODI_TRA
  razao_social    TEXT,            -- RAZA_TRA
  cgc_cnpj        TEXT,            -- CGC_TRA (CPF ou CNPJ)
  status          CHAR(1),         -- SITU_TRA: A=Ativo, I=Inativo
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_clientes_razao  ON raw.clientes (razao_social);
CREATE INDEX IF NOT EXISTS idx_clientes_cgc    ON raw.clientes (cgc_cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_status ON raw.clientes (status);

-- PRINATIVOS: princípios ativos cadastrados no ERP (vínculo via PRODSERV.CODI_PRI)
CREATE TABLE IF NOT EXISTS raw.principios_ativos (
  id              TEXT NOT NULL,   -- CODI_PRI
  descricao       TEXT,            -- DESC_PRI
  status          CHAR(1),         -- A=Ativo, I=Inativo
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- PRINCIPIOATIVO_REC: princípios ativos do módulo de receituário agronômico (2.352 registros)
CREATE TABLE IF NOT EXISTS raw.principios_ativos_rec (
  id              TEXT NOT NULL,   -- CODI_PRA
  descricao       TEXT,            -- DESC_PRA (CLOB)
  concentracao    NUMERIC,         -- CONC_PRA
  status          CHAR(1),         -- SITU_PRA
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- PRODPRIATIVO_REC: vínculo produto ↔ princípio ativo do receituário
-- Cadeia: PRODSERV.CODI_PSV → PRODUTO.CODI_PRR → PRODPRIATIVO_REC.CODI_PRR → PRINCIPIOATIVO_REC.CODI_PRA
CREATE TABLE IF NOT EXISTS raw.produto_principio_ativo_rec (
  id              TEXT NOT NULL,   -- CODI_PDA
  produto_id      TEXT,            -- CODI_PSV (resolvido via PRODUTO.CODI_PRR)
  principio_id    TEXT,            -- CODI_PRA → raw.principios_ativos_rec
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_prod_pa_rec_produto
  ON raw.produto_principio_ativo_rec (produto_id);

CREATE INDEX IF NOT EXISTS idx_prod_pa_rec_pa
  ON raw.produto_principio_ativo_rec (principio_id);

CREATE TABLE IF NOT EXISTS raw.produtos (
  id              TEXT NOT NULL,
  descricao       TEXT,
  tipo            CHAR(1),         -- P=Produto, B=Bem, U=Uso/Consumo, S=Serviço
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
-- EVOLUÇÕES DE SCHEMA (ADD COLUMN IF NOT EXISTS — idempotentes)
-- Executadas automaticamente pelo entrypoint do Docker na subida.
-- ---------------------------------------------------------------

-- Pedido de origem vinculado à NF (cabeçalho e itens)
ALTER TABLE raw.faturamento      ADD COLUMN IF NOT EXISTS pedido_id  TEXT;
ALTER TABLE raw.faturamento_itens ADD COLUMN IF NOT EXISTS pedido_id  TEXT;
ALTER TABLE raw.pedidos           ADD COLUMN IF NOT EXISTS origem     CHAR(1);

CREATE INDEX IF NOT EXISTS idx_faturamento_pedido
  ON raw.faturamento (pedido_id) WHERE pedido_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fat_itens_pedido
  ON raw.faturamento_itens (pedido_id) WHERE pedido_id IS NOT NULL;

-- Backfill pedido_id em faturamento_itens a partir de _dados (INOTA usa SELECT *)
UPDATE raw.faturamento_itens
SET    pedido_id = (_dados->>'PEDI_PED') || '_' || (_dados->>'SERI_PED')
WHERE  pedido_id IS NULL
  AND  _dados->>'PEDI_PED' IS NOT NULL
  AND  _dados->>'SERI_PED' IS NOT NULL;

-- Backfill origem em pedidos a partir de _dados
UPDATE raw.pedidos
SET    origem = _dados->>'ORIG_PED'
WHERE  origem IS NULL
  AND  _dados->>'ORIG_PED' IS NOT NULL;

-- Colunas tipadas em raw.clientes + indexes de busca e cross-reference
ALTER TABLE raw.clientes ADD COLUMN IF NOT EXISTS razao_social TEXT;
ALTER TABLE raw.clientes ADD COLUMN IF NOT EXISTS cgc_cnpj     TEXT;
ALTER TABLE raw.clientes ADD COLUMN IF NOT EXISTS status       CHAR(1);

CREATE INDEX IF NOT EXISTS idx_clientes_razao  ON raw.clientes (razao_social);
CREATE INDEX IF NOT EXISTS idx_clientes_cgc    ON raw.clientes (cgc_cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_status ON raw.clientes (status);

CREATE INDEX IF NOT EXISTS idx_faturamento_cliente
  ON raw.faturamento ((_dados->>'CODI_TRA'));

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente
  ON raw.pedidos (cliente_id);

-- Backfill clientes a partir de _dados
UPDATE raw.clientes SET
  razao_social = _dados->>'RAZA_TRA',
  cgc_cnpj     = _dados->>'CGC_TRA',
  status       = NULLIF(TRIM(_dados->>'SITU_TRA'), '')
WHERE razao_social IS NULL;

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

-- ---------------------------------------------------------------
-- PLANO DE CONTAS — PLCONTAS (cabeçalho do plano)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.plcontas (
  id              TEXT NOT NULL,   -- CODI_PLC
  descricao       TEXT,            -- DESC_PLC
  status          CHAR(1),         -- N=Não liberado, L=Liberado, E=Encerrado, M=Manutenção
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- CONTAS DO PLANO DE CONTAS — CONTASPL
--   PK composta: CODI_PLC + CODI_CPC
--   GRUP_CPC: 1=Ativo, 2=Passivo, 3=Custos, 4=Despesas, 5=Receitas, 6/7=Compensações
--   Flags: CONT_FOL=folha, CORR_CPC=caixa/banco, CTPL_CPC=PL, DIRP_CPC=IRPJ dedutível
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.contaspl (
  id              TEXT NOT NULL,   -- CODI_PLC_CODI_CPC (PK composta)
  plano_id        TEXT,            -- CODI_PLC → raw.plcontas
  conta_id        TEXT,            -- CODI_CPC
  descricao       TEXT,            -- DESC_CPC
  grupo           TEXT,            -- GRUP_CPC: 1=Ativo, 2=Passivo, 3=Custos, 4=Desp, 5=Rec
  natureza        TEXT,            -- NATU_CPC
  situacao        CHAR(1),         -- SITU_CPC: A=Ativo, I=Inativo
  classificacao   TEXT,            -- CLAS_CPC
  flag_folha      CHAR(1),         -- CONT_FOL: S=integra folha
  correntista     CHAR(1),         -- CORR_CPC: 4=banco/caixa
  flag_pl         CHAR(1),         -- CTPL_CPC: S=patrimônio líquido
  flag_redutora   CHAR(1),         -- REDU_CPC: S=conta redutora
  flag_cc         CHAR(1),         -- UCEC_CPC: S=utiliza centro de custo
  flag_irpj       CHAR(1),         -- DIRP_CPC: S=dedutível IRPJ
  cod_reduzido    TEXT,            -- CRED_CPC
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_contaspl_plano   ON raw.contaspl (plano_id);
CREATE INDEX IF NOT EXISTS idx_contaspl_conta   ON raw.contaspl (conta_id);
CREATE INDEX IF NOT EXISTS idx_contaspl_grupo   ON raw.contaspl (grupo);
CREATE INDEX IF NOT EXISTS idx_contaspl_folha   ON raw.contaspl (flag_folha) WHERE flag_folha = 'S';
CREATE INDEX IF NOT EXISTS idx_contaspl_banco   ON raw.contaspl (correntista) WHERE correntista = '4';

-- ---------------------------------------------------------------
-- HISTÓRICOS CONTÁBEIS — HISTORICO
--   DESC_HIS: texto livre do lançamento (ex: "Pagamento de fornecedor")
--   TIPO_HIS: D=Débito, C=Crédito, N=Neutro
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.historico (
  id              TEXT NOT NULL,   -- HIST_HIS
  descricao       TEXT,            -- DESC_HIS
  tipo            CHAR(1),         -- D=Débito, C=Crédito, N=Neutro
  status          CHAR(1),         -- A=Ativo, I=Inativo
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- CENTROS DE CUSTO — CCUSTO
--   DEPT_FOL: código do departamento para rateio de folha entre filiais
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.ccusto (
  id              TEXT NOT NULL,   -- CODI_CCU
  plano_id        TEXT,            -- CODI_PLC → raw.plcontas
  descricao       TEXT,            -- DESC_CCU
  status          CHAR(1),         -- A=Ativo, I=Inativo
  dept_folha      TEXT,            -- DEPT_FOL (departamento para integração folha)
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- DESDOBRAMENTO DE LANÇAMENTO POR CENTRO DE CUSTO — CCUSTOLAN
--   PK composta: SEQU_LCT + CODI_CCU
--   Habilita DRE por filial/departamento e análise de despesas de RH rateadas.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.ccustolan (
  id              TEXT NOT NULL,   -- SEQU_LCT_CODI_CCU (PK composta)
  lancamento_id   TEXT,            -- FK → raw.contabil
  ccusto_id       TEXT,            -- FK → raw.ccusto
  plano_id        TEXT,            -- CODI_PLC
  valor           NUMERIC(18,2),   -- VLOR_LCT (valor rateado neste CC)
  data_alteracao  TIMESTAMPTZ,
  _source         TEXT DEFAULT 'siagri',
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_ccustolan_lancamento ON raw.ccustolan (lancamento_id);
CREATE INDEX IF NOT EXISTS idx_ccustolan_ccusto     ON raw.ccustolan (ccusto_id);

-- ---------------------------------------------------------------
-- LINHAS DA DRE — IDRE
--   Estrutura hierárquica pré-definida no SiAGRI.
--   NIVE_IDR: nível na hierarquia (1=topo). POSI_IDR: CODI_IDR do pai.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.idre (
  id              TEXT NOT NULL,   -- CODI_IDR
  descricao       TEXT,            -- DESC_IDR (ex: "Receita Bruta", "Lucro Bruto")
  grupo           TEXT,            -- GRUP_IDR
  nivel           INT,             -- NIVE_IDR (1=topo, N=folha)
  pai_id          TEXT,            -- POSI_IDR → raw.idre (autorreferência)
  tipo            TEXT,            -- TIPO_IDR
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
-- MAPEAMENTO CONTA → LINHA DA DRE — CONTASDRE
--   Liga cada conta contábil (CODI_CPC) a uma linha da DRE (CODI_IDR).
--   SOSU_DRC: S=Soma, U=Subtrai na linha da DRE.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.contasdre (
  id              TEXT NOT NULL,   -- CODI_DRC (PK)
  idre_id         TEXT,            -- CODI_IDR → raw.idre
  conta_id        TEXT,            -- CODI_CPC → raw.contaspl
  soma_subtrai    CHAR(1),         -- SOSU_DRC: S=Soma, U=Subtrai
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_contasdre_idre  ON raw.contasdre (idre_id);
CREATE INDEX IF NOT EXISTS idx_contasdre_conta ON raw.contasdre (conta_id);

-- ---------------------------------------------------------------
-- CONTRATOS DE FINANCIAMENTO/EMPRÉSTIMOS — CONTRATOFIN
--   CODI_TRA = agente financeiro (banco credor)
--   PCJU_CFE = percentual de juros do contrato
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.contratofin (
  id              TEXT NOT NULL,   -- CODI_CFE
  filial_id       TEXT,            -- CODI_EMP
  numero          TEXT,            -- NUME_CFE
  descricao       TEXT,            -- DESC_CFE
  valor           NUMERIC(18,2),   -- VLOR_CFE (valor total do contrato)
  data_documento  DATE,            -- DTDO_CFE
  data_vencimento DATE,            -- DTVC_CFE
  taxa_juros      NUMERIC(10,4),   -- PCJU_CFE (percentual de juros)
  agente_id       TEXT,            -- CODI_TRA → raw.clientes (banco credor)
  tipo_fin_id     TEXT,            -- CODI_TFI → TIPOFINAN
  data_alteracao  TIMESTAMPTZ,
  _dados          JSONB NOT NULL,
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  _source         TEXT DEFAULT 'siagri',
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_contratofin_filial  ON raw.contratofin (filial_id);
CREATE INDEX IF NOT EXISTS idx_contratofin_agente  ON raw.contratofin (agente_id);
CREATE INDEX IF NOT EXISTS idx_contratofin_vencto  ON raw.contratofin (data_vencimento);

-- ---------------------------------------------------------------
-- DESDOBRAMENTO DE LANÇAMENTO POR PESSOA — CORLANPES
--   PK composta: SEQU_LCT + CODI_PES
--   Link entre lançamento contábil de folha e o colaborador.
--   Permite calcular custo real por colaborador sem módulo folha do SiAGRI.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.corlanpes (
  id              TEXT NOT NULL,   -- SEQU_LCT_CODI_PES (PK composta)
  lancamento_id   TEXT,            -- FK → raw.contabil
  pessoa_id       TEXT,            -- FK → raw.vendedores (PESSOAL)
  valor           NUMERIC(18,2),   -- VLOR_LCT (valor atribuído a esta pessoa)
  data_alteracao  TIMESTAMPTZ,
  _source         TEXT DEFAULT 'siagri',
  _sync_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_corlanpes_lancamento ON raw.corlanpes (lancamento_id);
CREATE INDEX IF NOT EXISTS idx_corlanpes_pessoa     ON raw.corlanpes (pessoa_id);
