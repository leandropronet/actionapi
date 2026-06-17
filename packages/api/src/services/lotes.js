'use strict';
/**
 * services/lotes.js
 *
 * Saldo de lotes por produto/filial — snapshot diário calculado via Oracle SALDO_LOTE().
 *
 * Fonte de dados: raw.saldo_lote (truncate + insert diário às 06:30)
 *   Contém apenas lotes com saldo > 0 e data de validade preenchida.
 *
 * Colunas disponíveis em raw.saldo_lote:
 *   id (TEXT = CODI_EMP_CODI_PSV_LOTE_LOT)
 *   filial_id, produto_id, produto_desc
 *   grupo_id, grupo_desc
 *   lote, data_validade, data_fabricacao, tipo_lote
 *   saldo, data_referencia
 *
 * Funções exportadas:
 *   listar()   — snapshot atual com filtros
 *   vencendo() — lotes vencendo nos próximos N dias (alerta de validade)
 *   resumo()   — totais por grupo e por filial
 */
const db = require('../db/postgres');

async function listar({ filialId, produtoId, grupoId, vencendoEm, saldoMinimo = 0, page = 1, pageSize = 200 }) {
  const conds = ['saldo > $1'];
  const params = [Number(saldoMinimo) || 0];

  if (filialId)  { params.push(filialId);  conds.push(`filial_id = $${params.length}`); }
  if (produtoId) { params.push(produtoId); conds.push(`produto_id = $${params.length}`); }
  if (grupoId)   { params.push(grupoId);   conds.push(`grupo_id = $${params.length}`); }
  if (vencendoEm) {
    params.push(Number(vencendoEm));
    conds.push(`data_validade IS NOT NULL`);
    conds.push(`data_validade >= CURRENT_DATE`);
    conds.push(`data_validade <= CURRENT_DATE + ($${params.length} || ' days')::INTERVAL`);
  }

  const where  = `WHERE ${conds.join(' AND ')}`;
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         id, filial_id, produto_id, produto_desc,
         grupo_id, grupo_desc, lote,
         data_validade, data_fabricacao, tipo_lote,
         saldo, data_referencia, _sync_at
       FROM raw.saldo_lote
       ${where}
       ORDER BY data_validade ASC NULLS LAST, produto_desc
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.saldo_lote ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function vencendo({ filialId, grupoId, dias = 30 }) {
  const conds = [
    'saldo > 0',
    'data_validade IS NOT NULL',
    `data_validade >= CURRENT_DATE`,
    `data_validade <= CURRENT_DATE + ($1 || ' days')::INTERVAL`,
  ];
  const params = [Number(dias)];

  if (filialId) { params.push(filialId); conds.push(`filial_id = $${params.length}`); }
  if (grupoId)  { params.push(grupoId);  conds.push(`grupo_id = $${params.length}`); }

  const where = `WHERE ${conds.join(' AND ')}`;

  const res = await db.query(
    `SELECT
       id, filial_id, produto_id, produto_desc,
       grupo_id, grupo_desc, lote,
       data_validade,
       (data_validade - CURRENT_DATE)::INT AS dias_para_vencer,
       saldo, data_referencia
     FROM raw.saldo_lote
     ${where}
     ORDER BY data_validade ASC, produto_desc`,
    params,
  );

  return { data: res.rows, dias_filtro: Number(dias) };
}

async function resumo({ filialId }) {
  const conds = ['saldo > 0'];
  const params = [];
  if (filialId) { params.push(filialId); conds.push(`filial_id = $${params.length}`); }
  const where = `WHERE ${conds.join(' AND ')}`;

  const [porGrupo, porFilial, totais] = await Promise.all([
    db.query(
      `SELECT
         grupo_id,
         grupo_desc,
         COUNT(DISTINCT produto_id)::INT AS qtd_produtos,
         COUNT(*)::INT                   AS qtd_lotes,
         SUM(saldo)                      AS saldo_total
       FROM raw.saldo_lote
       ${where}
       GROUP BY grupo_id, grupo_desc
       ORDER BY saldo_total DESC`,
      params,
    ),
    db.query(
      `SELECT
         filial_id,
         COUNT(DISTINCT produto_id)::INT AS qtd_produtos,
         COUNT(*)::INT                   AS qtd_lotes,
         SUM(saldo)                      AS saldo_total,
         COUNT(*) FILTER (
           WHERE data_validade IS NOT NULL
             AND data_validade >= CURRENT_DATE
             AND data_validade < CURRENT_DATE + INTERVAL '30 days'
         )::INT AS vencendo_30d
       FROM raw.saldo_lote
       ${where}
       GROUP BY filial_id
       ORDER BY filial_id`,
      params,
    ),
    db.query(
      `SELECT
         COUNT(*)::INT                AS total_lotes,
         COUNT(DISTINCT produto_id)::INT AS total_produtos,
         SUM(saldo)                   AS saldo_total,
         COUNT(*) FILTER (
           WHERE data_validade IS NOT NULL
             AND data_validade >= CURRENT_DATE
             AND data_validade < CURRENT_DATE + INTERVAL '30 days'
         )::INT AS vencendo_30d,
         COUNT(*) FILTER (
           WHERE data_validade IS NOT NULL AND data_validade < CURRENT_DATE
         )::INT AS vencidos_com_saldo,
         MAX(data_referencia) AS data_referencia
       FROM raw.saldo_lote
       ${where}`,
      params,
    ),
  ]);

  return {
    totais:     totais.rows[0],
    por_grupo:  porGrupo.rows,
    por_filial: porFilial.rows,
  };
}

module.exports = { listar, vencendo, resumo };
