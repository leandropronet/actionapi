'use strict';
/**
 * Documento OpenAPI estático.
 *
 * As rotas continuam definidas nos módulos Fastify; este catálogo descreve o
 * contrato público para integrações e alimenta o Swagger em /docs.
 */

const stringQuery = (name, description, example) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type: 'string', ...(example ? { example } : {}) },
});

const integerQuery = (name, description, example) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type: 'integer', minimum: 1, ...(example ? { example } : {}) },
});

const dateParams = [
  stringQuery('dataInicio', 'Data inicial de emissão no formato AAAA-MM-DD.', '2025-01-01'),
  stringQuery('dataFim', 'Data final de emissão no formato AAAA-MM-DD.', '2025-12-31'),
];

const pagination = [
  integerQuery('page', 'Página, iniciando em 1.', 1),
  integerQuery('pageSize', 'Quantidade de registros por página.', 100),
];

const filial = stringQuery('filialId', 'Código da filial.', '1');
const idPath = (name, description) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

const standardResponses = {
  200: {
    description: 'Consulta realizada com sucesso.',
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  429: { $ref: '#/components/responses/TooManyRequests' },
  500: { $ref: '#/components/responses/InternalError' },
};

function get(summary, tag, parameters = [], description = '') {
  return {
    summary,
    description,
    tags: [tag],
    security: [{ ApiKeyAuth: [] }, { AdminSession: [] }],
    parameters,
    responses: standardResponses,
  };
}

const paths = {
  '/api/v1/faturamento': {
    get: get('Listar notas fiscais', 'Faturamento', [
      ...dateParams, filial,
      stringQuery('dataSaidaDe', 'Data inicial de saída.', '2025-01-01'),
      stringQuery('dataSaidaAte', 'Data final de saída.', '2025-12-31'),
      stringQuery('clienteId', 'Código do cliente.'),
      stringQuery('vendedorId', 'Código do vendedor.'),
      stringQuery('status', 'Status da nota: 0, 5 ou 9.', '5'),
      stringQuery('tranTop', 'Tipo de transação: 1=entrada, 2=saída, 3=transferência.', '2'),
      stringQuery('operacaoId', 'Código da operação.'),
      stringQuery('grupoId', 'Código do grupo de produto.'),
      stringQuery('produtoId', 'Código do produto.'),
      ...pagination,
    ]),
  },
  '/api/v1/faturamento/resumo': {
    get: get(
      'Resumo e consolidado de faturamento',
      'Faturamento',
      [
        ...dateParams, filial,
        stringQuery('agrupamento', 'dia, mes, trimestre ou ano.', 'mes'),
        stringQuery('tranTop', 'Tipo de transação para o resumo convencional.'),
        stringQuery('paramId', 'Ativa o consolidado A−S de NOTA e NFENTRA.', '102'),
        stringQuery('status', 'Status das notas no consolidado. Padrão: 5.', '5'),
      ],
      'Com paramId, reproduz o relatório Saídas Faturadas Analítico usando emissão e devoluções de NFENTRA.',
    ),
  },
  '/api/v1/faturamento/itens': {
    get: get('Listar itens faturados', 'Faturamento', [
      ...dateParams, filial,
      stringQuery('clienteId', 'Código do cliente.'),
      stringQuery('vendedorId', 'Código do vendedor.'),
      stringQuery('tranTop', 'Tipo de transação.'),
      stringQuery('grupoId', 'Código do grupo.'),
      stringQuery('produtoId', 'Código do produto.'),
      ...pagination,
    ]),
  },
  '/api/v1/faturamento/{id}': {
    get: get('Consultar nota fiscal', 'Faturamento', [idPath('id', 'NPRE_NOT da nota.')]),
  },
  '/api/v1/entradas': {
    get: get('Listar NF-e de entrada', 'Entradas', [
      ...dateParams, filial,
      stringQuery('dataRecebDe', 'Data inicial de recebimento.'),
      stringQuery('dataRecebAte', 'Data final de recebimento.'),
      stringQuery('parceiroId', 'Código do parceiro/fornecedor.'),
      stringQuery('operacaoId', 'Código da operação.'),
      ...pagination,
    ]),
  },
  '/api/v1/entradas/resumo': {
    get: get('Resumo de NF-e de entrada', 'Entradas', [
      ...dateParams, filial,
      stringQuery('dataRecebDe', 'Data inicial de recebimento.'),
      stringQuery('dataRecebAte', 'Data final de recebimento.'),
      stringQuery('agrupamento', 'dia, mes, trimestre ou ano.', 'mes'),
    ]),
  },
  '/api/v1/entradas/itens': {
    get: get('Listar itens de entrada', 'Entradas', [
      ...dateParams, filial,
      stringQuery('parceiroId', 'Código do parceiro.'),
      stringQuery('operacaoId', 'Código da operação.'),
      stringQuery('grupoId', 'Código do grupo.'),
      stringQuery('produtoId', 'Código do produto.'),
      stringQuery('paramId', 'Parâmetro de função de operação.', '102'),
      stringQuery('funcao', 'Função A ou S.', 'S'),
      ...pagination,
    ]),
  },
  '/api/v1/entradas/devolucoes': {
    get: get('Consultar devoluções de clientes', 'Entradas', [
      ...dateParams, filial,
      stringQuery('paramId', 'Parâmetro de operação. Padrão: 102.', '102'),
    ]),
  },
  '/api/v1/entradas/{id}': {
    get: get('Consultar NF-e de entrada', 'Entradas', [idPath('id', 'CTRL_NFE da entrada.')]),
  },
  '/api/v1/pedidos': {
    get: get('Listar pedidos', 'Pedidos', [
      ...dateParams, filial,
      stringQuery('clienteId', 'Código do cliente.'),
      stringQuery('vendedorId', 'Código do vendedor.'),
      stringQuery('status', 'Status 0, 1, 5 ou 9.'),
      stringQuery('origem', 'Origem S, M ou vazia.'),
      ...pagination,
    ]),
  },
  '/api/v1/pedidos/resumo': {
    get: get('Resumo de pedidos', 'Pedidos', [
      ...dateParams, filial,
      stringQuery('agrupamento', 'dia, mes, trimestre ou ano.', 'mes'),
    ]),
  },
  '/api/v1/pedidos/itens': {
    get: get('Listar itens de pedidos', 'Pedidos', [
      ...dateParams, filial,
      stringQuery('produtoId', 'Código do produto.'),
      stringQuery('grupoId', 'Código do grupo.'),
      ...pagination,
    ]),
  },
  '/api/v1/pedidos/{id}': {
    get: get('Consultar pedido', 'Pedidos', [idPath('id', 'Identificador do pedido.')]),
  },
  '/api/v1/pedidos/{id}/faturamento': {
    get: get('Consultar faturamento do pedido', 'Pedidos', [idPath('id', 'Identificador do pedido.')]),
  },
  '/api/v1/pedidos/{id}/saldo': {
    get: get('Consultar saldo comercial do pedido', 'Pedidos', [idPath('id', 'Identificador do pedido.')]),
  },
  '/api/v1/duplicatas': {
    get: get('Listar duplicatas', 'Financeiro', [
      filial,
      stringQuery('clienteId', 'Código do cliente.'),
      stringQuery('nfId', 'Identificador da nota.'),
      stringQuery('vencimentoDe', 'Vencimento inicial.'),
      stringQuery('vencimentoAte', 'Vencimento final.'),
      stringQuery('status', 'A=aberto, B=baixado, C=cancelado.'),
      ...pagination,
    ]),
  },
  '/api/v1/financeiro': {
    get: get('Consultar contas a pagar ou receber', 'Financeiro', [
      stringQuery('tipo', 'CP=contas a pagar ou CR=contas a receber.', 'CR'),
      filial,
      stringQuery('vencimentoDe', 'Vencimento inicial.'),
      stringQuery('vencimentoAte', 'Vencimento final.'),
      ...pagination,
    ]),
  },
  '/api/v1/financeiro/fluxo-caixa': {
    get: get('Consultar fluxo de caixa', 'Financeiro', [...dateParams, filial]),
  },
  '/api/v1/recebimentos': {
    get: get('Listar recebimentos', 'Baixas', [...dateParams, filial, ...pagination]),
  },
  '/api/v1/recebimentos/resumo': {
    get: get('Resumo de recebimentos', 'Baixas', [
      ...dateParams, filial,
      stringQuery('agrupamento', 'dia, mes, trimestre ou ano.', 'mes'),
    ]),
  },
  '/api/v1/pagamentos': {
    get: get('Listar pagamentos', 'Baixas', [...dateParams, filial, ...pagination]),
  },
  '/api/v1/pagamentos/resumo': {
    get: get('Resumo de pagamentos', 'Baixas', [
      ...dateParams, filial,
      stringQuery('agrupamento', 'dia, mes, trimestre ou ano.', 'mes'),
    ]),
  },
  '/api/v1/estoque': {
    get: get('Consultar estoque', 'Estoque', [
      filial,
      stringQuery('produtoId', 'Código do produto.'),
      stringQuery('grupoId', 'Código do grupo.'),
      ...pagination,
    ]),
  },
  '/api/v1/lotes': {
    get: get('Consultar lotes', 'Estoque', [
      filial,
      stringQuery('produtoId', 'Código do produto.'),
      stringQuery('grupoId', 'Código do grupo.'),
      integerQuery('vencendoEm', 'Dias até o vencimento.', 30),
      stringQuery('saldoMinimo', 'Saldo mínimo.'),
      ...pagination,
    ]),
  },
  '/api/v1/lotes/vencendo': {
    get: get('Consultar lotes vencendo', 'Estoque', [
      integerQuery('dias', 'Janela de vencimento em dias.', 30),
      filial,
      stringQuery('grupoId', 'Código do grupo.'),
    ]),
  },
  '/api/v1/lotes/resumo': {
    get: get('Resumo de lotes', 'Estoque', [filial, stringQuery('grupoId', 'Código do grupo.')]),
  },
  '/api/v1/clientes': {
    get: get('Listar clientes', 'Clientes', [
      stringQuery('search', 'Razão social ou nome fantasia.'),
      stringQuery('cgcCnpj', 'CPF ou CNPJ.'),
      stringQuery('status', 'A=ativo ou I=inativo.'),
      ...pagination,
    ]),
  },
  '/api/v1/clientes/{id}': {
    get: get('Consultar cliente', 'Clientes', [idPath('id', 'Código do cliente.')]),
  },
  '/api/v1/clientes/{id}/faturamento': {
    get: get('Consultar faturamento do cliente', 'Clientes', [
      idPath('id', 'Código do cliente.'), ...dateParams, ...pagination,
    ]),
  },
  '/api/v1/clientes/{id}/pedidos': {
    get: get('Consultar pedidos do cliente', 'Clientes', [
      idPath('id', 'Código do cliente.'), ...dateParams, ...pagination,
    ]),
  },
  '/api/v1/clientes/{id}/propriedades': {
    get: get('Consultar propriedades do cliente', 'Clientes', [idPath('id', 'Código do cliente.')]),
  },
  '/api/v1/clientes/{id}/resumo': {
    get: get('Consultar resumo do cliente', 'Clientes', [idPath('id', 'Código do cliente.'), ...dateParams]),
  },
  '/api/v1/contabil': {
    get: get('Listar lançamentos contábeis', 'Contabilidade', [
      filial,
      stringQuery('competencia', 'Competência no formato AAAA-MM.'),
      stringQuery('conta', 'Código da conta.'),
      stringQuery('planoContas', 'Código do plano de contas.'),
      stringQuery('tipo', 'F=fiscal ou S=societário.'),
      ...pagination,
    ]),
  },
  '/api/v1/contabil/saldo-contas': {
    get: get('Consultar saldo das contas', 'Contabilidade', [
      filial, stringQuery('competencia', 'Competência AAAA-MM.'),
    ]),
  },
  '/api/v1/contabil/resumo': {
    get: get('Resumo contábil', 'Contabilidade', [...dateParams, filial]),
  },
  '/api/v1/contabil/balancete': {
    get: get('Consultar balancete', 'Contabilidade', [...dateParams, filial]),
  },
  '/api/v1/dre': {
    get: get('Consultar DRE', 'Contabilidade', [...dateParams, filial]),
  },
  '/api/v1/dre/estrutura': {
    get: get('Consultar estrutura da DRE', 'Contabilidade'),
  },
  '/api/v1/bi/financeiro': {
    get: get(
      'Dataset financeiro plano para Power BI e Excel',
      'BI e Conciliação',
      [
        ...dateParams, filial,
        stringQuery('tipo', 'CP ou CR.'),
        stringQuery('parceiroId', 'Código do parceiro.'),
        stringQuery('status', 'Status da parcela.'),
        stringQuery('format', 'json ou csv.', 'json'),
        ...pagination,
      ],
      'Uma linha por parcela, com título, parceiro, baixas agregadas e saldo calculado.',
    ),
  },
  '/api/v1/bi/contabil': {
    get: get(
      'Dataset contábil plano para Power BI e Excel',
      'BI e Conciliação',
      [
        ...dateParams, filial,
        stringQuery('parceiroId', 'Código do parceiro.'),
        stringQuery('conta', 'Código da conta contábil.'),
        stringQuery('origem', 'Origem do lançamento, como DP ou NE.'),
        stringQuery('tipoPartida', 'D=débito ou C=crédito.'),
        stringQuery('format', 'json ou csv.', 'json'),
        ...pagination,
      ],
      'Uma linha por partida contábil, com cabeçalho, conta, histórico, débito e crédito.',
    ),
  },
  '/api/v1/bi/analise-contabil': {
    get: get(
      'Analise contabil gerencial para Power BI e Excel',
      'BI e Conciliacao',
      [
        ...dateParams, filial,
        stringQuery('conta', 'Conta formatada (4.2.1...) ou codigo interno.'),
        stringQuery('ccustoId', 'Codigo do centro de custo.'),
        stringQuery('naturezaContabil', 'Natureza gerencial da planilha.'),
        stringQuery('classificacaoEbitda', 'EBITDA, RF ou DA.'),
        stringQuery('safra', 'Período de 01/07 a 30/06. Exemplo: Safra 2024/2025.'),
        stringQuery('statusLoja', 'OK, SEM_CODIGO_LOJA, CENTRO_CUSTO_SEM_REFERENCIA_LOJA ou CODIGO_LOJA_DIFERENTE_CENTRO_CUSTO.'),
        stringQuery('format', 'json ou csv.', 'json'),
        ...pagination,
      ],
      'Uma linha mensal por codigo de loja, conta e centro de custo. O codigo oficial vem exclusivamente do CABLANCTB; o centro de custo e usado apenas para sinalizar inconsistencias.',
    ),
  },
  '/api/v1/conciliacao/financeiro-contabil': {
    get: get('Conciliação financeiro × contábil', 'BI e Conciliação', [
      ...dateParams, filial,
      stringQuery('tipo', 'CP ou CR.'),
      stringQuery('parceiroId', 'Código do parceiro.'),
      stringQuery('statusConciliacao', 'OK, SEM_LANCAMENTO_CONTABIL, MULTIPLOS_LANCAMENTOS, VALOR_DIVERGENTE ou NAO_APLICAVEL_REGRA_AUTOMATICA.'),
      stringQuery('tolerancia', 'Tolerância monetária para diferença.', '0.01'),
      stringQuery('format', 'json ou csv.', 'json'),
      ...pagination,
    ]),
  },
  '/api/v1/conciliacao/financeiro-contabil/divergencias': {
    get: get('Somente divergências financeiro × contábil', 'BI e Conciliação', [
      ...dateParams, filial,
      stringQuery('tipo', 'CP ou CR.'),
      stringQuery('parceiroId', 'Código do parceiro.'),
      stringQuery('tolerancia', 'Tolerância monetária para diferença.', '0.01'),
      stringQuery('format', 'json ou csv.', 'json'),
      ...pagination,
    ]),
  },
  '/api/v1/conciliacao/financeiro-contabil/resumo': {
    get: get('Resumo da conciliação por tipo e status', 'BI e Conciliação', [
      ...dateParams, filial,
      stringQuery('tipo', 'CP ou CR.'),
      stringQuery('parceiroId', 'Código do parceiro.'),
      stringQuery('tolerancia', 'Tolerância monetária para diferença.', '0.01'),
    ]),
  },
};

// Parâmetro comum: qualquer consulta GET pode ser exportada em CSV.
for (const pathItem of Object.values(paths)) {
  if (!pathItem.get) continue;
  const hasFormat = pathItem.get.parameters?.some((parameter) => parameter.name === 'format');
  if (!hasFormat) {
    pathItem.get.parameters = [
      ...(pathItem.get.parameters || []),
      stringQuery('format', 'Use csv para baixar uma tabela compatível com Excel/Power BI.', 'json'),
    ];
  }
  pathItem.get.responses[200] = {
    description: 'Consulta em JSON ou CSV quando format=csv.',
    content: {
      'application/json': { schema: { type: 'object', additionalProperties: true } },
      'text/csv': { schema: { type: 'string' } },
    },
  };
}

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'ActionAPI',
    version: '1.1.0',
    description: [
      'API somente leitura para dados sincronizados do ERP SiAGRI.',
      '',
      'Integrações usam `X-API-Key`. O painel e esta documentação também podem usar a sessão administrativa.',
      'O Oracle é acessado exclusivamente pelo ETL em modo de consulta.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'Servidor atual' }],
  tags: [
    { name: 'Faturamento' },
    { name: 'Entradas' },
    { name: 'Pedidos' },
    { name: 'Financeiro' },
    { name: 'Baixas' },
    { name: 'Estoque' },
    { name: 'Clientes' },
    { name: 'Contabilidade' },
    { name: 'BI e Conciliação' },
  ],
  paths,
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      AdminSession: { type: 'apiKey', in: 'cookie', name: 'actionapi_session' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error', 'code'],
        properties: {
          error: { type: 'string' },
          code: { type: 'string' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Parâmetros inválidos.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Unauthorized: {
        description: 'API key ou sessão ausente/inválida.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      TooManyRequests: {
        description: 'Limite de requisições excedido.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      InternalError: {
        description: 'Erro interno.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
};
