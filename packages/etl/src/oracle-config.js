'use strict';
// =============================================================
// Mapeamento das tabelas e campos do Oracle SiAGRI — Schema SULGOIANO
// Descoberto via planilha RBCAMPO_RBTABELA_RBRELACIONAMENTO.xlsx
// Campos marcados com "TODO_VERIFICAR" devem ser confirmados
// na primeira conexão ao banco (oracle.js → query exploratória).
// =============================================================

const SCHEMA = process.env.ORACLE_SCHEMA || 'SULGOIANO';

module.exports = {

  // ──────────────────────────────────────────────
  // FATURAMENTO — Notas Fiscais emitidas (NOTA)
  //   Itens: INOTA (FK: NPRE_NOT)
  //
  //   Operações (CODI_TOP → TIPOOPER):
  //     TRAN_TOP = 1 → Entradas (compras, devoluções de venda)
  //     TRAN_TOP = 2 → Saídas (vendas + devoluções de compra) — faturamento principal
  //     TRAN_TOP = 3 → Transferências entre filiais
  //
  //   Para relatórios de "faturamento de vendas":
  //     filtrar TIPOOPER.TRAN_TOP = 2 (todos os tipos de saída)
  //     ou especificamente CODI_TOP IN (20, 21, 29, 31, 85, 81, ...)
  //
  //   CCSALDO — controles de saldo (CODI_CTR → descrição):
  //     1=Estoque Físico, 2=Ped.Compra Não Recebido, 3=Ped.Venda Não Entregue
  //     5=Venda p/ Entrega Futura, 8=Remessa Dep/Arm Recebida
  //     16=Comprovante Entrega (valor negativo = entregue)
  // ──────────────────────────────────────────────
  faturamento: {
    schema:          SCHEMA,
    tabela:          'NOTA',
    campoId:         'NPRE_NOT',      // Número da Pré-Nota (PK)
    campoFilial:     'CODI_EMP',
    campoCliente:    'CODI_TRA',      // Código do Parceiro
    campoVendedor:   'COD1_PES',      // Código do Vendedor 1
    campoDataEmissao:'DEMI_NOT',
    campoDataSaida:  'DSAI_NOT',
    campoNumeroNF:   'NOTA_NOT',
    campoSerie:      'SERI_NOT',
    campoTotal:      'TOTA_NOT',
    // SITU_NOT: 0=Pré-Nota, 3=Transferência, 5=NF Gerada, 9=Cancelada
    campoStatus:     'SITU_NOT',
    // CODI_TOP → TIPOOPER: operação fiscal/comercial da NF (ver comentário acima)
    campoOperacao:   'CODI_TOP',
    // Campo de alteração para ETL incremental (campo-chave de todas as tabelas SiAGRI)
    campoDataAlter:  'DUMANUT',
    // Itens da NF
    tabelaItens:     'INOTA',
    campoItemNfId:   'NPRE_NOT',
    campoItemSeq:    'ITEM_INO',
    campoItemProduto:'CODI_PSV',
    campoItemQtd:    'QTDE_INO',
    campoItemValor:  'VLOR_INO',
  },

  // ──────────────────────────────────────────────
  // DUPLICATAS — Contas a Receber
  //   Cabeçalho: CABREC (por documento/NF)
  //   Parcelas:  RECEBER (por vencimento, com flag ACDU_REC para Fase 2)
  // ──────────────────────────────────────────────
  duplicatas: {
    schema:              SCHEMA,
    // CABREC — Cabeçalho do documento a receber
    tabelaCab:           'CABREC',
    campoCabId:          'CTRL_CBR',   // PK do cabeçalho
    campoCabFilial:      'CODI_EMP',
    campoCabCliente:     'CODI_TRA',
    campoCabData:        'DATA_CBR',
    campoCabTotal:       'TOTA_CBR',
    // SITU_CBR: A=Aberto, C=Cancelado
    campoCabStatus:      'SITU_CBR',
    campoCabDataAlter:   'DUMANUT',
    // RECEBER — Parcelas/duplicatas
    tabelaParcela:       'RECEBER',
    campoParcelaId:      'CTRL_REC',   // PK da parcela (TODO_VERIFICAR campo exato)
    campoParcelaCabId:   'CTRL_CBR',   // FK → CABREC
    campoParcelaNr:      'NPAR_REC',
    campoParcelaVenc:    'VENC_REC',   // TODO_VERIFICAR
    campoParcelaValor:   'VLOR_REC',   // TODO_VERIFICAR
    campoParcelaStatus:  'SITU_REC',   // TODO_VERIFICAR
    // Flag Fase 2 — assinatura digital da duplicata
    campoFlagAssina:     'ACDU_REC',   // 'S'/'N'
    campoVendedor1:      'COD1_PES',
    campoParcelaDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // PEDIDOS — Pedidos de Venda
  //   Itens: IPEDIDO (FK: PEDI_PED + SERI_PED)
  // ──────────────────────────────────────────────
  pedidos: {
    schema:            SCHEMA,
    tabela:            'PEDIDO',
    // PK composta: número + série + filial
    campoPedidoId:     'PEDI_PED',
    campoPedidoSerie:  'SERI_PED',
    campoFilial:       'CODI_EMP',
    campoCliente:      'CODI_TRA',
    campoVendedor:     'COD1_PES',    // TODO_VERIFICAR (mesmo padrão do NOTA)
    campoDataPedido:   'DEMI_PED',
    // SITU_PED: 0=Não Liberado, 1=Liberado, 5=Confirmado, 9=Cancelado
    campoStatus:       'SITU_PED',
    campoTotal:        'TOTA_PED',    // TODO_VERIFICAR
    campoDataAlter:    'DUMANUT',
    // Itens do pedido
    tabelaItens:       'IPEDIDO',
    campoItemPedidoId: 'PEDI_PED',
    campoItemSerie:    'SERI_PED',
    campoItemSeq:      'ITEM_IPE',
    campoItemProduto:  'CODI_PSV',
    campoItemQtd:      'QTDE_IPE',
    campoItemValor:    'VLOR_IPE',
  },

  // ──────────────────────────────────────────────
  // ESTOQUE — View CCSALDO (saldo por filial, produto e tipo de controle)
  //   Campos confirmados via conexão direta ao Oracle ORCL
  // ──────────────────────────────────────────────
  estoque: {
    schema:        SCHEMA,
    tabela:        'CCSALDO',
    campoFilial:   'CODI_EMP',
    campoProduto:  'CODI_PSV',
    campoTipoCtrl: 'CODI_CTR',   // Tipo/controle de estoque
    campoSaldo:    'QTDE_CCS',
    campoData:     'DATA_CCS',   // Data da posição do saldo
    // CCSALDO não tem DUMANUT — ETL usa DATAPOSICAO (realtime, sempre atualiza)
    campoDataAlter: 'DATA_CCS',
  },

  // ──────────────────────────────────────────────
  // FINANCEIRO CP — Contas a Pagar
  //   Cabeçalho: CABPAGAR
  //   Parcelas:  PAGAR (com flag ACDU_PAG para Fase 2)
  // ──────────────────────────────────────────────
  financeiro_cp: {
    schema:              SCHEMA,
    tabelaCab:           'CABPAGAR',
    campoCabId:          'CTRL_CPG',
    campoCabFilial:      'CODI_EMP',
    campoCabFornecedor:  'CODI_TRA',
    campoCabData:        'DMOV_CPG',
    campoCabTotal:       'TOTA_CPG',
    campoCabDataAlter:   'DUMANUT',
    // PAGAR — parcelas
    tabelaParcela:       'PAGAR',
    campoParcelaId:      'CTRL_PAG',
    campoParcelaCabId:   'CTRL_CPG',
    campoParcelaNr:      'NPAR_PAG',
    campoParcelaVenc:    'DVEN_PAG',
    campoParcelaValor:   'VLOR_PAG',
    // Flag Fase 2 — assinatura digital do documento
    campoFlagAssina:     'ACDU_PAG',  // 'S'/'N'
    campoParcelaDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // FINANCEIRO CR — Contas a Receber (mesmas tabelas de duplicatas,
  //   usadas aqui para fluxo de caixa e relatórios financeiros)
  // ──────────────────────────────────────────────
  financeiro_cr: {
    schema:              SCHEMA,
    tabelaCab:           'CABREC',
    campoCabId:          'CTRL_CBR',
    campoCabFilial:      'CODI_EMP',
    campoCabCliente:     'CODI_TRA',
    campoCabData:        'DATA_CBR',
    campoCabTotal:       'TOTA_CBR',
    campoCabStatus:      'SITU_CBR',
    campoCabDataAlter:   'DUMANUT',
    tabelaParcela:       'RECEBER',
    campoParcelaId:      'CTRL_REC',
    campoParcelaCabId:   'CTRL_CBR',
    campoParcelaNr:      'NPAR_REC',
    campoParcelaVenc:    'VENC_REC',
    campoParcelaValor:   'VLOR_REC',
    campoParcelaStatus:  'SITU_REC',
    campoFlagAssina:     'ACDU_REC',
    campoParcelaDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // CONTABILIDADE — Lançamentos contábeis
  //   Cabeçalho: CABLANCTB
  //   Partidas:  LANCONTAB (D/C por conta)
  // ──────────────────────────────────────────────
  contabil: {
    schema:         SCHEMA,
    tabelaCab:      'CABLANCTB',
    campoCabId:     'SEQU_CLC',
    campoCabFilial: 'CODI_EMP',
    campoCabData:   'DATA_CLC',
    campoCabValor:  'VCON_CLC',
    campoCabDoc:    'CTRL_CLC',     // Número do documento origem
    // TIPO_CLC: F=Fiscal, S=Societário
    campoCabTipo:   'TIPO_CLC',
    campoCabDataAlter: 'DUMANUT',
    // LANCONTAB — partidas contábeis
    tabelaLanc:     'LANCONTAB',
    campoLancId:    'SEQU_LCT',
    campoLancCabId: 'SEQU_CLC',
    campoLancFilial:'CODI_EMP',
    campoLancConta: 'CODI_CPC',     // Código da conta contábil
    campoLancPlano: 'CODI_PLC',     // Plano de contas
    campoLancValor: 'VLOR_LCT',
    // TIPO_LCT: D=Débito, C=Crédito
    campoLancTipo:  'TIPO_LCT',
    campoLancHist:  'HIST_HIS',     // Código do histórico
    campoLancDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // PARCEIROS / CLIENTES — TRANSAC (mestra de todos os parceiros)
  //   CLIENTE = extensão com dados específicos de clientes
  // ──────────────────────────────────────────────
  clientes: {
    schema:           SCHEMA,
    tabela:           'TRANSAC',
    campoId:          'CODI_TRA',   // PK — referenciado por todos os documentos
    campoRazao:       'RAZA_TRA',
    campoFantasia:    'FANT_TRA',
    campoCpfCnpj:     'CGC_TRA',
    campoTelefone:    'TEL1_TRA',
    campoDataAlter:   'DUMANUT',    // TODO_VERIFICAR se TRANSAC tem DUMANUT
    // CLIENTE — dados adicionais de clientes (join via CODI_TRA)
    tabelaCliente:    'CLIENTE',
    campoClienteTra:  'CODI_TRA',   // FK → TRANSAC
    campoClienteEmp:  'CODI_EMP',
  },

  // ──────────────────────────────────────────────
  // NF DE ENTRADA — Notas Fiscais de terceiros (compras)
  //   Cabeçalho: NFENTRA  |  Itens: INFENTRA
  // ──────────────────────────────────────────────
  nfentra: {
    schema:          SCHEMA,
    tabela:          'NFENTRA',
    campoId:         'CTRL_NFE',
    campoFilial:     'CODI_EMP',
    campoFornecedor: 'CODI_TRA',
    campoDataEmissao:'DEMI_NFE',
    campoTotal:      'TOTA_NFE',
    campoDataAlter:  'DUMANUT',
    // Itens da NF de entrada
    tabelaItens:     'INFENTRA',
    campoItemNfeId:  'CTRL_NFE',      // FK → NFENTRA
    campoItemSeq:    'ITEM_INF',
    campoItemProduto:'CODI_PSV',
    campoItemQtd:    'QUAN_INF',      // Quantidade
    campoItemValor:  'VLOR_INF',      // Valor unitário
    campoItemValorLiq:'VLIQ_INF',     // Valor líquido
  },

  // ──────────────────────────────────────────────
  // PRODUTOS — PRODSERV (tabela mestre de produtos/serviços)
  //   5.698 registros confirmados via banco ORCL
  //   Tipo em PRSE_PSV: P=Produto, B=Bem, U=Uso/Consumo, S=Serviço
  //   PRODUTO e PRODUTOS são extensões (fiscal, regulatório, agroquímico)
  // ──────────────────────────────────────────────
  produtos: {
    schema:        SCHEMA,
    tabela:        'PRODSERV',
    campoId:       'CODI_PSV',    // PK — código universal referenciado em todas as tabelas
    campoDescricao:'DESC_PSV',    // Descrição (VARCHAR2 120) — confirmado
    campoCodAlt:   'CODI_PRO',    // Código alternativo/ERP (em PRODUTO)
    campoTipo:     'PRSE_PSV',    // Tipo: P=Produto B=Bem U=Uso/Consumo S=Serviço
    campoGrupo:    'CODI_GPR',
    campoSubgrupo: 'CODI_SBG',
    campoUnidade:  'UNID_PSV',
    campoStatus:   'SITU_PSV',    // A=Ativo I=Inativo
    campoDataAlter:'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // FILIAIS — CADEMP
  // ──────────────────────────────────────────────
  filiais: {
    schema:      SCHEMA,
    tabela:      'CADEMP',
    campoId:     'CODI_EMP',
    campoNome:   'FANT_EMP',
    campoCnpj:   'CNPJ_EMP',
    // SITU_EMP: A=Ativa, I=Inativa
    campoStatus: 'SITU_EMP',
    campoDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // GRUPOS DE PRODUTO — GRUPO
  //   PK: CODI_GPR. Referenciado em PRODSERV.CODI_GPR.
  //   Grupos principais: 1=Defensivos, 2=Sementes, 3=Adubos/Fertilizantes
  //   Custom: 11000006=Serviços, 11000007=Equipamentos, 11000018=Uso e Consumo
  // ──────────────────────────────────────────────
  grupos: {
    schema:       SCHEMA,
    tabela:       'GRUPO',
    campoId:      'CODI_GPR',
    campoDesc:    'DESC_GPR',
    campoStatus:  'SITU_GPR',
    campoDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // PRODUTO POR FILIAL — DADOSPRO (27.117 registros)
  //   PK: CODI_EMP + CODI_PSV. Lista quais produtos estão ativos por filial.
  //   EMIN_DAD = estoque mínimo (alerta de reposição)
  //   EMAX_DAD = estoque máximo
  //   SITU_DAD = A=Ativo, I=Inativo
  //   LOCA_DAD = localização física no depósito
  //   Usado como base para calcular saldo por lote (JOIN com LOTE → SALDO_LOTE())
  // ──────────────────────────────────────────────
  dadospro: {
    schema:         SCHEMA,
    tabela:         'DADOSPRO',
    campoFilial:    'CODI_EMP',
    campoProduto:   'CODI_PSV',
    campoEstMin:    'EMIN_DAD',
    campoEstMax:    'EMAX_DAD',
    campoStatus:    'SITU_DAD',
    campoLocacao:   'LOCA_DAD',
    campoDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // SALDO POR LOTE — calculado via função Oracle SALDO_LOTE()
  //   Assinatura: SALDO_LOTE(AEMPRESA, APRODUTO, ALOTE, ADATA, ATIPOEST, ACODIDPT)
  //     ATIPOEST='F' → Estoque Físico (controle 1 do CCSALDO)
  //     ACODIDPT=NULL → todos os depósitos
  //   Snapshot diário: job carrega todas as combinações DADOSPRO×LOTE com SALDO > 0
  //   Função equivalente para estoque geral: SALDO_INICIAL(EMP, CTR, PSV, DATA, DPT)
  //   View com histórico: CCSALDODIA (CODI_EMP, CODI_CTR, CODI_PSV, DATA_CCS, QTDE_CCS)
  // ──────────────────────────────────────────────
  saldoLote: {
    schema: SCHEMA,
    // Função Oracle a chamar (pipelined, retorna QTDE)
    funcaoSaldoLote: 'SALDO_LOTE',   // (EMP, PSV, LOTE, DATA, ATIPOEST, DPT)
    funcaoSaldoIni:  'SALDO_INICIAL', // (EMP, CTR, PSV, DATA, DPT)
    viewSaldoDia:    'CCSALDODIA',    // histórico diário sem lote
  },

  // ──────────────────────────────────────────────
  // TIPO DE OPERAÇÃO — TIPOOPER (dimensão de operações fiscais/comerciais)
  //   PK: CODI_TOP. Vinculado em NOTA.CODI_TOP.
  //   TRAN_TOP: 1=Entrada, 2=Saída, 3=Transferência
  //   TIPO_TOP: E=Entrada, S=Saída
  //   CODI_TPL: template/grupo pai (ex: 1000002=Venda Normal, 1000004=Devol.Venda)
  //   Para relatórios de faturamento/vendas: TRAN_TOP=2
  //   297 operações cadastradas (mix de standard 1-200 + custom 10000xxx)
  // ──────────────────────────────────────────────
  operacoes: {
    schema:        SCHEMA,
    tabela:        'TIPOOPER',
    campoId:       'CODI_TOP',
    campoDesc:     'DESC_TOP',
    campoStatus:   'SITU_TOP',   // A=Ativo, I=Inativo
    campoTran:     'TRAN_TOP',   // 1=Entrada, 2=Saída, 3=Transferência
    campoTipo:     'TIPO_TOP',   // E=Entrada, S=Saída
    campoTemplate: 'CODI_TPL',   // Grupo pai da operação
    campoTipoDoc:  'CODI_TDO',   // FK → TIPDOC (tipo de doc. financeiro gerado)
    campoDataAlter:'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // VENDEDORES — PESSOAL (pessoal interno da empresa)
  //   CODI_PES é referenciado como COD1_PES / COD2_PES nos documentos
  // ──────────────────────────────────────────────
  vendedores: {
    schema:      SCHEMA,
    tabela:      'PESSOAL',
    campoId:     'CODI_PES',
    campoNome:   'NOME_PES',
    campoFilial: 'CODI_EMP',
    // SITU_PES: A=Ativo, I=Inativo
    campoStatus: 'SITU_PES',
    campoDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // LOTES — Lotes de produtos (LOTE + ILOTE)
  //   LOTE: mestre do lote por produto. PK = CODI_PSV + LOTE_LOT.
  //     VALG_LOT = data de validade — campo-chave para dashboards de vencimento.
  //     TPRO_LOT: S=Semente. SITU_LOT: A=Ativo, I=Inativo.
  //   ILOTE: lote por filial (CODI_EMP) com quantidade inicial (QINI_ILO) e depósito.
  //   16.502 lotes | 6.024 registros por filial (jun/2026)
  // ──────────────────────────────────────────────
  lotes: {
    schema:          SCHEMA,
    tabela:          'LOTE',
    campoProduto:    'CODI_PSV',   // FK → PRODSERV (parte da PK)
    campoLote:       'LOTE_LOT',   // Código do lote (parte da PK)
    campoTipo:       'TPRO_LOT',   // Tipo: S=Semente
    campoStatus:     'SITU_LOT',   // A=Ativo, I=Inativo
    campoValidade:   'VALG_LOT',   // Data de validade do lote
    campoFabricacao: 'DTFA_LOT',   // Data de fabricação
    campoFornecedor: 'CODI_TRA',   // FK → TRANSAC
    campoDataAlter:  'DUMANUT',
    // ILOTE — quantidade do lote por filial/depósito
    tabelaFilial:    'ILOTE',
    campoIloteProd:  'CODI_PSV',
    campoIloteLote:  'LOTE_LOT',
    campoIloteEmp:   'CODI_EMP',
    campoIloteQtd:   'QINI_ILO',   // Quantidade inicial no lote
    campoIloteDepo:  'CODI_DPT',   // Depósito
    campoIloteDt:    'DINI_ILO',   // Data de entrada do lote na filial
    campoIloteAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // RECEBIMENTOS — Baixas de Contas a Receber (CRCBAIXA)
  //   Cada linha = um pagamento efetivo de uma parcela (CTRL_REC → RECEBER)
  //   SITU_BAI: N=Normal, E=Estornada
  //   181.057 registros (jun/2026)
  // ──────────────────────────────────────────────
  recebimentos: {
    schema:         SCHEMA,
    tabela:         'CRCBAIXA',
    campoId:        'SEQU_BAI',    // PK
    campoParcelaId: 'CTRL_REC',    // FK → RECEBER
    campoFilial:    'CODI_EMP',
    campoDtPag:     'DPAG_BAI',    // Data do recebimento
    campoValor:     'VLOR_BAI',    // Valor recebido
    campoMulta:     'MULT_BAI',
    campoJuros:     'JURO_BAI',
    campoDesconto:  'DESC_BAI',
    campoAcrescimo: 'ACRE_BAI',
    campoRecibo:    'CODI_REC',    // FK → RECIBO
    // SITU_BAI: N=Normal, E=Estornada
    campoStatus:    'SITU_BAI',
    campoDataAlter: 'DUMANUT',
  },

  // ──────────────────────────────────────────────
  // PAGAMENTOS — Baixas de Contas a Pagar (CPGBAIXA)
  //   Cada linha = um pagamento efetivo de uma parcela (CTRL_PAG → PAGAR)
  //   SITU_CPB: N=Normal, E=Estornada
  //   211.064 registros (jun/2026)
  // ──────────────────────────────────────────────
  pagamentos: {
    schema:         SCHEMA,
    tabela:         'CPGBAIXA',
    campoId:        'SEQU_CPB',    // PK
    campoParcelaId: 'CTRL_PAG',    // FK → PAGAR
    campoFilial:    'CODI_EMP',
    campoDtPag:     'DPAG_CPB',    // Data do pagamento
    campoValor:     'VLOR_CPB',    // Valor pago
    campoMulta:     'MULT_CPB',
    campoJuros:     'JURO_CPB',
    campoDesconto:  'DESC_CPB',
    campoAcrescimo: 'ACRE_CPB',
    // SITU_CPB: N=Normal, E=Estornada
    campoStatus:    'SITU_CPB',
    campoDataAlter: 'DUMANUT',
  },

};
