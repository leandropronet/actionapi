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
  // ESTOQUE — O saldo real fica em views Oracle
  //   Executar ao conectar: SELECT VIEW_NAME FROM ALL_VIEWS
  //   WHERE OWNER='SULGOIANO' AND VIEW_NAME LIKE '%ESTO%' OR VIEW_NAME LIKE '%SALDO%'
  // ──────────────────────────────────────────────
  estoque: {
    schema:        SCHEMA,
    // Substituir pela view real após conectar ao banco
    tabela:        'TODO_VIEW_ESTOQUE',
    campoFilial:   'CODI_EMP',
    campoProduto:  'CODI_PSV',
    campoDeposito: 'CODI_DPT',
    campoTipoCtrl: 'CODI_CTR',   // Controle de saldo (tipo de estoque)
    campoSaldo:    'SALDO',       // TODO_VERIFICAR campo na view
    campoValorMedio:'CMED',       // TODO_VERIFICAR
    campoDataAlter: 'DUMANUT',
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
  // PRODUTOS — PRODUTO (CODI_PSV como chave universal)
  // ──────────────────────────────────────────────
  produtos: {
    schema:        SCHEMA,
    tabela:        'PRODUTO',
    campoId:       'CODI_PSV',       // Código do Produto/Serviço (PK)
    campoDescricao:'DESC_PRO',        // TODO_VERIFICAR nome exato do campo
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

};
