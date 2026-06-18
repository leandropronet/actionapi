'use strict';
/**
 * Exportação CSV transversal para todas as rotas GET /api/v1/*.
 *
 * Ativação: ?format=csv
 * - listas usam a propriedade `data`;
 * - respostas com uma coleção principal (itens, grupos, por_filial etc.)
 *   repetem os campos escalares do cabeçalho em cada linha;
 * - objetos aninhados restantes são serializados como JSON dentro da célula.
 */

const COLLECTION_PRIORITY = [
  'data',
  'itens',
  'grupos',
  'por_filial',
  'propriedades',
  'componentes',
];

function safeExcelValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvEscape(value) {
  const text = safeExcelValue(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function flattenObject(value, prefix = '', output = {}) {
  for (const [key, item] of Object.entries(value || {})) {
    const column = prefix ? `${prefix}_${key}` : key;
    if (item === null || item === undefined || typeof item !== 'object' || item instanceof Date) {
      output[column] = item;
    } else if (Array.isArray(item)) {
      output[column] = JSON.stringify(item);
    } else {
      flattenObject(item, column, output);
    }
  }
  return output;
}

function findCollection(payload) {
  for (const key of COLLECTION_PRIORITY) {
    if (Array.isArray(payload?.[key])) return key;
  }
  return Object.keys(payload || {}).find((key) => Array.isArray(payload[key])) || null;
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload.map((row) => flattenObject(row));
  if (!payload || typeof payload !== 'object') return [{ valor: payload }];

  const collectionKey = findCollection(payload);
  if (!collectionKey) return [flattenObject(payload)];

  const parent = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === collectionKey || ['total', 'page', 'pageSize'].includes(key)) continue;
    if (!Array.isArray(value)) {
      Object.assign(parent, flattenObject({ [key]: value }, 'cabecalho'));
    }
  }

  return payload[collectionKey].map((row) => ({
    ...parent,
    ...flattenObject(row),
  }));
}

function csvFromRows(rows) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!columns.length) return '';
  return [
    columns.map(csvEscape).join(';'),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(';')),
  ].join('\r\n');
}

function filenameFor(request) {
  const path = request.routeOptions?.url || request.url.split('?')[0];
  const name = path
    .replace(/^\/api\/v\d+\//, '')
    .replace(/[:{}]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'actionapi';
  return `${name}.csv`;
}

async function csvExportHook(request, reply, payload) {
  if (
    request.method !== 'GET'
    || !request.url.startsWith('/api/')
    || request.query?.format !== 'csv'
    || reply.statusCode >= 400
  ) {
    return payload;
  }

  let parsed = payload;
  if (Buffer.isBuffer(payload)) parsed = payload.toString('utf8');
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return payload;
    }
  }

  const csv = csvFromRows(rowsFromPayload(parsed));
  reply
    .type('text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filenameFor(request)}"`);
  return `\uFEFF${csv}`;
}

module.exports = { csvExportHook, rowsFromPayload, csvFromRows };
