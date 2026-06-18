'use strict';
/**
 * services/baixas.js
 *
 * Baixas efetivas de Contas a Receber (CRCBAIXA) e Contas a Pagar (CPGBAIXA).
 *
 * Tabelas: raw.recebimentos | raw.pagamentos
 *
 * Colunas tipadas em raw.recebimentos:
 *   id, parcela_id, filial_id, cliente_id, tipo_doc,
 *   data_pagamento, valor, multa, juros, desconto, acrescimo, recibo_id, status
 *
 * Colunas tipadas em raw.pagamentos:
 *   id, parcela_id, filial_id,
 *   data_pagamento, valor, multa, juros, desconto, acrescimo, status
 *
 * status: N=Normal, E=Estornada
 *
 * Funções exportadas:
 *   listarRecebimentos() — baixas CR com filtros
 *   listarPagamentos()   — baixas CP com filtros
 *   resumoRecebimentos() — totais por período
 *   resumoPagamentos()   — totais por período
 */
const db = require('../db/postgres');

async function listarRecebimentos({
  filialId, clienteId, tipoDoc, status,
  dataDe, dataAte,
  page = 1, pageSize = 100,
}) {
  const conds = [];
  const params = [];

  if (filialId)  { params.push(filialId);  conds.push(`filial_id = $${params.length}`); }
  if (clienteId) { params.push(clienteId); conds.push(`cliente_id = $${params.length}`); }
  if (tipoDoc)   { params.push(tipoDoc);   conds.push(`tipo_doc = $${params.length}`); }
  if (status)    { params.push(status);    conds.push(`status = $${params.length}`); }
  if (dataDe)    { params.push(dataDe);    conds.push(`data_pagamento >= $${params.length}`); }
  if (dataAte)   { params.push(dataAte);   conds.push(`data_pagamento <= $${params.length}`); }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         id, parcela_id, filial_id, cliente_id, tipo_doc,
         data_pagamento,
         valor::NUMERIC        AS valor,
         multa::NUMERIC        AS multa,
         juros::NUMERIC        AS juros,
         desconto::NUMERIC     AS desconto,
         acrescimo::NUMERIC    AS acrescimo,
         (valor + multa + juros + acrescimo - desconto)::NUMERIC AS valor_liquido,
         recibo_id, status, _sync_at
       FROM raw.recebimentos
       ${where}
       ORDER BY data_pagamento DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.recebimentos ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function listarPagamentos({
  filialId, status,
  dataDe, dataAte,
  page = 1, pageSize = 100,
}) {
  const conds = [];
  const params = [];

  if (filialId) { params.push(filialId); conds.push(`filial_id = $${params.length}`); }
  if (status)   { params.push(status);   conds.push(`status = $${params.length}`); }
  if (dataDe)   { params.push(dataDe);   conds.push(`data_pagamento >= $${params.length}`); }
  if (dataAte)  { params.push(dataAte);  conds.push(`data_pagamento <= $${params.length}`); }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         id, parcela_id, filial_id,
         data_pagamento,
         valor::NUMERIC        AS valor,
         multa::NUMERIC        AS multa,
         juros::NUMERIC        AS juros,
         desconto::NUMERIC     AS desconto,
         acrescimo::NUMERIC    AS acrescimo,
         (valor + multa + juros + acrescimo - desconto)::NUMERIC AS valor_liquido,
         status, _sync_at
       FROM raw.pagamentos
       ${where}
       ORDER BY data_pagamento DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.pagamentos ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function resumoRecebimentos({ agrupamento = 'mes', filialId, dataDe, dataAte }) {
  const conds = [];
  const params = [];

  if (filialId) { params.push(filialId); conds.push(`filial_id = $${params.length}`); }
  if (dataDe)   { params.push(dataDe);   conds.push(`data_pagamento >= $${params.length}`); }
  if (dataAte)  { params.push(dataAte);  conds.push(`data_pagamento <= $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const trunc = agrupamento === 'dia'       ? `DATE_TRUNC('day',     data_pagamento)`
              : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', data_pagamento)`
              : agrupamento === 'ano'       ? `DATE_TRUNC('year',    data_pagamento)`
              :                              `DATE_TRUNC('month',    data_pagamento)`;

  const res = await db.query(
    `SELECT
       ${trunc}                                     AS periodo,
       filial_id,
       COUNT(*)::INT                                AS quantidade,
       COUNT(*) FILTER (WHERE status = 'N')::INT   AS normais,
       COUNT(*) FILTER (WHERE status = 'E')::INT   AS estornadas,
       SUM(valor)                                  AS total_valor,
       SUM(multa)                                  AS total_multa,
       SUM(juros)                                  AS total_juros,
       SUM(desconto)                               AS total_desconto,
       SUM(valor + multa + juros + acrescimo - desconto) AS total_liquido
     FROM raw.recebimentos
     ${where}
     GROUP BY periodo, filial_id
     ORDER BY periodo DESC, filial_id`,
    params,
  );

  return { data: res.rows };
}

async function resumoPagamentos({ agrupamento = 'mes', filialId, dataDe, dataAte }) {
  const conds = [];
  const params = [];

  if (filialId) { params.push(filialId); conds.push(`filial_id = $${params.length}`); }
  if (dataDe)   { params.push(dataDe);   conds.push(`data_pagamento >= $${params.length}`); }
  if (dataAte)  { params.push(dataAte);  conds.push(`data_pagamento <= $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const trunc = agrupamento === 'dia'       ? `DATE_TRUNC('day',     data_pagamento)`
              : agrupamento === 'trimestre' ? `DATE_TRUNC('quarter', data_pagamento)`
              : agrupamento === 'ano'       ? `DATE_TRUNC('year',    data_pagamento)`
              :                              `DATE_TRUNC('month',    data_pagamento)`;

  const res = await db.query(
    `SELECT
       ${trunc}                                     AS periodo,
       filial_id,
       COUNT(*)::INT                                AS quantidade,
       COUNT(*) FILTER (WHERE status = 'N')::INT   AS normais,
       COUNT(*) FILTER (WHERE status = 'E')::INT   AS estornadas,
       SUM(valor)                                  AS total_valor,
       SUM(multa)                                  AS total_multa,
       SUM(juros)                                  AS total_juros,
       SUM(desconto)                               AS total_desconto,
       SUM(valor + multa + juros + acrescimo - desconto) AS total_liquido
     FROM raw.pagamentos
     ${where}
     GROUP BY periodo, filial_id
     ORDER BY periodo DESC, filial_id`,
    params,
  );

  return { data: res.rows };
}

module.exports = { listarRecebimentos, listarPagamentos, resumoRecebimentos, resumoPagamentos };
