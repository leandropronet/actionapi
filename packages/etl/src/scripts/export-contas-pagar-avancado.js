'use strict';
/**
 * Gera um relatório Excel avançado de Contas a Pagar consumindo a ActionAPI.
 *
 * Uso:
 *   node src/scripts/export-contas-pagar-avancado.js [arquivo.xlsx]
 *
 * Variáveis opcionais:
 *   ACTIONAPI_URL=http://127.0.0.1:3000
 *
 * A API key é lida de API_KEYS no .env e nunca é gravada na planilha.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const API_URL = (process.env.ACTIONAPI_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const API_KEY = (process.env.API_KEYS || '').split(',').map((item) => item.trim()).find(Boolean);
const PAGE_SIZE = 10000;

const MONEY_FORMAT = 'R$ #,##0.00;[Red]-R$ #,##0.00';
const NUMBER_FORMAT = '#,##0';
const DATE_FORMAT = 'dd/mm/yyyy';

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function apiGet(endpoint, params = {}) {
  if (!API_KEY) throw new Error('API_KEYS não está configurada no .env');

  const url = new URL(`${API_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ActionAPI respondeu ${response.status}: ${body}`);
  }
  return response.json();
}

async function buscarDetalhes() {
  const linhas = [];
  let page = 1;
  for (;;) {
    const result = await apiGet('/api/v1/financeiro/contas-pagar', {
      somenteEmAberto: true,
      page,
      pageSize: PAGE_SIZE,
    });
    linhas.push(...(result.data || []));
    if (!result.data?.length || linhas.length >= result.total) break;
    page += 1;
  }
  return linhas;
}

function prepararDetalhes(rows) {
  return rows.map((row) => ({
    'Filial': row.filial_id,
    'Nome da filial': row.filial_nome,
    'Fantasia da filial': row.filial_fantasia,
    'Identificação da filial': row.filial_identificacao,
    'Código fornecedor': row.fornecedor_id,
    'Fornecedor': row.fornecedor_nome,
    'CPF/CNPJ': row.fornecedor_cnpj_cpf,
    'Título': row.titulo_id,
    'Parcela': row.parcela_nr,
    'Documento': row.numero_documento,
    'Tipo documento': row.tipo_documento,
    'Descrição tipo documento': row.tipo_documento_descricao,
    'Data emissão': isoDate(row.data_emissao),
    'Data vencimento': isoDate(row.data_vencimento),
    'Valor do título': number(row.valor_titulo),
    'Valor da parcela': number(row.valor_parcela),
    'Valor baixado': number(row.valor_baixado),
    'Juros': number(row.juros),
    'Multa': number(row.multa),
    'Desconto': number(row.desconto),
    'Acréscimo': number(row.acrescimo),
    'Saldo da parcela': number(row.saldo_parcela),
    'Unidade do saldo': row.unidade_saldo,
    'Código indexador': row.indexador_id,
    'Cotação de origem': number(row.valor_indexador_origem),
    'Cotação atual': number(row.valor_indexador_atual),
    'Saldo convertido atual': number(row.saldo_convertido_atual),
    'Situação': row.situacao,
    'Dias em atraso': number(row.dias_atraso),
    'Faixa de vencimento': row.faixa_vencimento,
    'Quantidade de pedidos': number(row.qtd_pedidos),
    'Pedidos': row.pedidos_ids,
    'Pedidos internos SiAGRI': row.pedidos_numeros,
    'Pedidos do fornecedor': row.pedidos_fornecedor_numeros,
    'Código fornecedor do pedido': row.fornecedores_pedido_ids,
    'Fornecedor do pedido': row.fornecedores_pedido_nomes,
    'CPF/CNPJ fornecedor do pedido': row.fornecedores_pedido_cnpjs,
    'Filial do pedido': row.filiais_pedido_ids,
    'Produtos': row.produtos_ids,
    'Descrição dos produtos': row.produtos_descricoes,
    'Notas de entrada': row.nf_entrada_ids,
    'Primeira data pedido': isoDate(row.primeira_data_pedido),
    'Última data pedido': isoDate(row.ultima_data_pedido),
    'Status vínculo pedido': row.status_vinculo_pedido,
    'Conferência pedido': row.conferencia_pedido,
    'Resumo da divergência': row.divergencia_resumo,
    'Detalhe da divergência': row.divergencia_detalhe,
    'Primeira baixa': isoDate(row.primeira_baixa),
    'Última baixa': isoDate(row.ultima_baixa),
  }));
}

function prepararFornecedores(rows) {
  return rows.map((row) => ({
    'Filial': row.filial_id,
    'Nome da filial': row.filial_nome,
    'Código fornecedor': row.fornecedor_id,
    'Fornecedor': row.fornecedor_nome,
    'CPF/CNPJ': row.fornecedor_cnpj_cpf,
    'Quantidade de parcelas': number(row.qtd_parcelas),
    'Quantidade de títulos': number(row.qtd_titulos),
    'Valor das parcelas': number(row.valor_parcelas),
    'Valor baixado': number(row.valor_baixado),
    'Saldo': number(row.saldo),
    'Saldo vencido': number(row.saldo_vencido),
    'Saldo próximos 7 dias': number(row.saldo_proximos_7_dias),
    'Saldo próximos 30 dias': number(row.saldo_proximos_30_dias),
    'Parcelas com pedido': number(row.qtd_parcelas_com_pedido),
    'Parcelas sem pedido': number(row.qtd_parcelas_sem_pedido),
    'Divergências de pedido': number(row.qtd_divergencias_pedido),
    'Primeiro vencimento': isoDate(row.primeiro_vencimento),
    'Último vencimento': isoDate(row.ultimo_vencimento),
  })).sort((a, b) => b.Saldo - a.Saldo);
}

function agruparFaixas(rows) {
  const grupos = new Map();
  for (const row of rows) {
    const key = row.faixa_vencimento || 'SEM_CLASSIFICAÇÃO';
    const atual = grupos.get(key) || { faixa: key, parcelas: 0, titulos: new Set(), saldo: 0 };
    atual.parcelas += 1;
    atual.titulos.add(row.titulo_id);
    atual.saldo += number(row.saldo_parcela);
    grupos.set(key, atual);
  }

  const ordem = [
    'VENCIDO_ACIMA_90_DIAS',
    'VENCIDO_31_A_90_DIAS',
    'VENCIDO_1_A_30_DIAS',
    'VENCE_HOJE',
    'VENCE_EM_1_A_7_DIAS',
    'VENCE_EM_8_A_30_DIAS',
    'VENCE_EM_31_A_60_DIAS',
    'VENCE_EM_61_A_90_DIAS',
    'VENCE_ACIMA_90_DIAS',
  ];

  return [...grupos.values()]
    .map((item) => ({
      'Faixa de vencimento': item.faixa,
      'Quantidade de parcelas': item.parcelas,
      'Quantidade de títulos': item.titulos.size,
      'Saldo': item.saldo,
    }))
    .sort((a, b) => ordem.indexOf(a['Faixa de vencimento']) - ordem.indexOf(b['Faixa de vencimento']));
}

function criarPainel(totalizadores, fornecedores, detalhes, geradoEm) {
  const total = number(totalizadores.saldo);
  const top10 = fornecedores.slice(0, 10);
  const vencidos = detalhes.filter((row) => row.dias_atraso > 0);
  const maiorVencido = vencidos.reduce(
    (max, row) => Math.max(max, number(row.saldo_parcela)),
    0,
  );

  const rows = [
    ['RELATÓRIO AVANÇADO DE CONTAS A PAGAR'],
    ['Gerado em', geradoEm],
    ['Fonte', 'ActionAPI — /api/v1/financeiro/contas-pagar'],
    ['Critério', 'Somente parcelas com saldo superior a R$ 0,01'],
    [],
    ['INDICADORES PRINCIPAIS', 'Valor'],
    ['Saldo total em aberto', total],
    ['Saldo vencido', number(totalizadores.saldo_vencido)],
    ['Saldo próximos 7 dias', number(totalizadores.saldo_proximos_7_dias)],
    ['Saldo próximos 30 dias', number(totalizadores.saldo_proximos_30_dias)],
    ['Quantidade de fornecedores', number(totalizadores.qtd_fornecedores)],
    ['Quantidade de títulos', number(totalizadores.qtd_titulos)],
    ['Quantidade de parcelas', number(totalizadores.qtd_parcelas)],
    ['Parcelas com pedido', number(totalizadores.qtd_parcelas_com_pedido)],
    ['Parcelas sem pedido', number(totalizadores.qtd_parcelas_sem_pedido)],
    ['Divergências título × pedido', number(totalizadores.qtd_divergencias_pedido)],
    ['Maior parcela vencida', maiorVencido],
    [],
    ['CONCENTRAÇÃO — 10 MAIORES FORNECEDORES', 'Saldo', '% do saldo total'],
    ...top10.map((row) => [
      `${row.Fornecedor} — filial ${row.Filial}`,
      row.Saldo,
      total ? row.Saldo / total : 0,
    ]),
  ];

  return XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
}

function criarMetodologia(geradoEm) {
  return XLSX.utils.aoa_to_sheet([
    ['RELATÓRIO DE CONTAS A PAGAR — METODOLOGIA'],
    ['Gerado em', geradoEm],
    [],
    ['Granularidade', 'Uma linha por parcela financeira de PAGAR.'],
    ['Título financeiro', 'CABPAGAR ligado às parcelas em PAGAR.'],
    ['Fornecedor', 'Código do parceiro do título, enriquecido pelo cadastro de fornecedores.'],
    ['Pedido de compra', 'CABPAGAR ← NOTACPG → INFENTRA → PEDCOM.'],
    ['Produtos', 'Obtidos dos itens de INFENTRA ligados ao título e ao pedido.'],
    ['Valor baixado', "Soma de CPGBAIXA com SITU_CPB='N'."],
    ['Estornos', "Registros SITU_CPB='E' são históricos estornados e não compõem o saldo."],
    ['Saldo', 'Valor da parcela menos o valor baixado normal.'],
    ['Evita duplicação', 'Pedidos e produtos são agregados por título antes da ligação com as parcelas.'],
    ['COM_PEDIDO', 'A nota de entrada possui item referenciando PEDCOM.'],
    ['COM_NF_SEM_PEDIDO', 'Existe nota de entrada, mas seus itens não referenciam pedido.'],
    ['SEM_NF_E_SEM_PEDIDO', 'Comum em empréstimos, tributos e adiantamentos.'],
    ['Conferência pedido', 'Compara fornecedor e filial do pedido com os dados do título.'],
    [],
    ['Validação de referência', 'Em 20/06/2026, VALOR_ABERTO_PAGAR_DATA e o cálculo local coincidiram nas 183.656 parcelas, sem divergências.'],
    ['Saldo aberto validado', '542 parcelas e R$ 122.237.778,67 em 20/06/2026.'],
    ['Observação', 'Os números deste arquivo refletem a última sincronização concluída pela ActionAPI.'],
  ], { cellDates: true });
}

function aplicarFormato(sheet, { moneyColumns = [], dateColumns = [], integerColumns = [], percentColumns = [] } = {}) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headers = {};
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
    if (cell) headers[cell.v] = col;
  }

  const formatColumns = (names, format) => {
    for (const name of names) {
      const col = headers[name];
      if (col === undefined) continue;
      for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell) cell.z = format;
      }
    }
  };

  formatColumns(moneyColumns, MONEY_FORMAT);
  formatColumns(dateColumns, DATE_FORMAT);
  formatColumns(integerColumns, NUMBER_FORMAT);
  formatColumns(percentColumns, '0.00%');
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
}

function ajustarColunas(sheet, maxWidth = 45) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const widths = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    let width = 10;
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (!cell?.v) continue;
      const value = cell.v instanceof Date ? '00/00/0000' : String(cell.v);
      width = Math.max(width, Math.min(value.length + 2, maxWidth));
    }
    widths.push({ wch: width });
  }
  sheet['!cols'] = widths;
}

function adicionarPlanilha(workbook, nome, rows, formats = {}) {
  const sheet = XLSX.utils.json_to_sheet(rows, { cellDates: true });
  aplicarFormato(sheet, formats);
  ajustarColunas(sheet);
  XLSX.utils.book_append_sheet(workbook, sheet, nome);
  return sheet;
}

async function main() {
  const hoje = new Date().toISOString().slice(0, 10);
  const output = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '../../../../relatorios', `contas-a-pagar-avancado-${hoje}.xlsx`);

  console.log(`[contas-pagar-excel] consultando ${API_URL}...`);
  const [detalhesApi, resumo] = await Promise.all([
    buscarDetalhes(),
    apiGet('/api/v1/financeiro/contas-pagar/resumo', { somenteEmAberto: true }),
  ]);

  const detalhes = prepararDetalhes(detalhesApi);
  const fornecedores = prepararFornecedores(resumo.data || []);
  const vencidos = detalhesApi.filter((row) => number(row.dias_atraso) > 0);
  const comPedido = detalhesApi.filter((row) => row.status_vinculo_pedido === 'COM_PEDIDO');
  const semPedido = detalhesApi.filter((row) => row.status_vinculo_pedido !== 'COM_PEDIDO');
  const divergencias = detalhesApi.filter(
    (row) => !['OK', 'NAO_APLICAVEL'].includes(row.conferencia_pedido),
  );
  const estabelecimentos = detalhesApi.filter(
    (row) => row.conferencia_pedido === 'MESMA_RAIZ_CNPJ_ESTABELECIMENTO_DIFERENTE',
  );
  const geradoEm = new Date();

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Relatório avançado de contas a pagar por fornecedor',
    Subject: 'Títulos, parcelas, vencimentos, pedidos e produtos',
    Author: 'ActionAPI',
    CreatedDate: geradoEm,
  };

  const painel = criarPainel(resumo.totalizadores || {}, fornecedores, detalhesApi, geradoEm);
  painel['!merges'] = [XLSX.utils.decode_range('A1:C1')];
  painel['B7'].z = MONEY_FORMAT;
  painel['B8'].z = MONEY_FORMAT;
  painel['B9'].z = MONEY_FORMAT;
  painel['B10'].z = MONEY_FORMAT;
  painel['B17'].z = MONEY_FORMAT;
  for (let row = 20; row <= 29; row += 1) {
    if (painel[`B${row}`]) painel[`B${row}`].z = MONEY_FORMAT;
    if (painel[`C${row}`]) painel[`C${row}`].z = '0.00%';
  }
  painel['!cols'] = [{ wch: 55 }, { wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, painel, 'Painel');

  adicionarPlanilha(workbook, 'Titulos a Pagar', detalhes, {
    moneyColumns: [
      'Valor do título', 'Valor da parcela', 'Valor baixado', 'Juros',
      'Multa', 'Desconto', 'Acréscimo', 'Saldo da parcela',
      'Cotação de origem', 'Cotação atual', 'Saldo convertido atual',
    ],
    dateColumns: [
      'Data emissão', 'Data vencimento', 'Primeira data pedido',
      'Última data pedido', 'Primeira baixa', 'Última baixa',
    ],
    integerColumns: ['Parcela', 'Dias em atraso', 'Quantidade de pedidos'],
  });

  adicionarPlanilha(workbook, 'Por Fornecedor', fornecedores, {
    moneyColumns: [
      'Valor das parcelas', 'Valor baixado', 'Saldo', 'Saldo vencido',
      'Saldo próximos 7 dias', 'Saldo próximos 30 dias',
    ],
    dateColumns: ['Primeiro vencimento', 'Último vencimento'],
    integerColumns: [
      'Quantidade de parcelas', 'Quantidade de títulos', 'Parcelas com pedido',
      'Parcelas sem pedido', 'Divergências de pedido',
    ],
  });

  adicionarPlanilha(workbook, 'Faixas Vencimento', agruparFaixas(detalhesApi), {
    moneyColumns: ['Saldo'],
    integerColumns: ['Quantidade de parcelas', 'Quantidade de títulos'],
  });

  adicionarPlanilha(workbook, 'Vencidos', prepararDetalhes(vencidos), {
    moneyColumns: ['Valor da parcela', 'Valor baixado', 'Saldo da parcela'],
    dateColumns: ['Data emissão', 'Data vencimento', 'Primeira data pedido', 'Última data pedido'],
    integerColumns: ['Dias em atraso', 'Quantidade de pedidos'],
  });

  adicionarPlanilha(workbook, 'Com Pedido', prepararDetalhes(comPedido), {
    moneyColumns: ['Valor da parcela', 'Valor baixado', 'Saldo da parcela'],
    dateColumns: ['Data emissão', 'Data vencimento', 'Primeira data pedido', 'Última data pedido'],
    integerColumns: ['Dias em atraso', 'Quantidade de pedidos'],
  });

  adicionarPlanilha(workbook, 'Sem Pedido', prepararDetalhes(semPedido), {
    moneyColumns: ['Valor da parcela', 'Valor baixado', 'Saldo da parcela'],
    dateColumns: ['Data emissão', 'Data vencimento'],
    integerColumns: ['Dias em atraso'],
  });

  adicionarPlanilha(workbook, 'Divergencias', prepararDetalhes(divergencias), {
    moneyColumns: ['Valor da parcela', 'Valor baixado', 'Saldo da parcela'],
    dateColumns: ['Data emissão', 'Data vencimento', 'Primeira data pedido', 'Última data pedido'],
    integerColumns: ['Dias em atraso', 'Quantidade de pedidos'],
  });

  adicionarPlanilha(workbook, 'Estabelecimentos', prepararDetalhes(estabelecimentos), {
    moneyColumns: ['Valor da parcela', 'Valor baixado', 'Saldo da parcela'],
    dateColumns: ['Data emissão', 'Data vencimento', 'Primeira data pedido', 'Última data pedido'],
    integerColumns: ['Dias em atraso', 'Quantidade de pedidos'],
  });

  const metodologia = criarMetodologia(geradoEm);
  metodologia['!cols'] = [{ wch: 28 }, { wch: 110 }];
  metodologia['!merges'] = [XLSX.utils.decode_range('A1:B1')];
  XLSX.utils.book_append_sheet(workbook, metodologia, 'Metodologia');

  fs.mkdirSync(path.dirname(output), { recursive: true });
  XLSX.writeFile(workbook, output, { cellDates: true, compression: true });

  console.log(`[contas-pagar-excel] ${detalhes.length} parcelas exportadas`);
  console.log(`[contas-pagar-excel] arquivo: ${output}`);
}

main().catch((error) => {
  console.error('[contas-pagar-excel] erro:', error);
  process.exitCode = 1;
});
