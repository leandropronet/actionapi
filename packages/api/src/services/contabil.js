'use strict';
/**
 * services/contabil.js
 *
 * Lançamentos contábeis do SiAGRI.
 *
 * Fonte de dados: raw.contabil
 *   Uma linha = uma partida contábil (LANCONTAB) com dados do cabeçalho (CABLANCTB).
 *   Um lançamento (SEQU_CLC) pode ter várias partidas D/C.
 *
 * Campos disponíveis em _dados (aliases do ETL):
 *   SEQU_CLC  — ID do cabeçalho (lançamento)
 *   CODI_EMP  — filial
 *   DATA_CLC  — data do lançamento
 *   VCON_CLC  — valor total do lançamento
 *   CTRL_CLC  — número do documento de origem
 *   TIPO_CLC  — tipo: F=Fiscal, S=Societário
 *   SEQU_LCT  — ID da partida
 *   CODI_CPC  — código da conta contábil
 *   CODI_PLC  — plano de contas
 *   VLOR_LCT  — valor da partida
 *   TIPO_LCT  — D=Débito, C=Crédito
 *   HIST_HIS  — código do histórico
 *
 * Funções exportadas:
 *   listar()       — partidas contábeis com filtros
 *   saldoContas()  — débito/crédito/saldo agrupados por conta e competência
 *   resumo()       — totais por competência (débito, crédito, saldo líquido)
 */
const db = require('../db/postgres');

async function listar({ filialId, competencia, conta, planoContas, tipo, page = 1, pageSize = 200 }) {
  const conditions = [];
  const params = [];

  if (filialId)    { params.push(filialId);    conditions.push(`filial_id = $${params.length}`); }
  if (competencia) { params.push(competencia); conditions.push(`competencia = $${params.length}`); }
  if (conta)       { params.push(conta);       conditions.push(`_dados->>'CODI_CPC' = $${params.length}`); }
  if (planoContas) { params.push(planoContas); conditions.push(`_dados->>'CODI_PLC' = $${params.length}`); }
  if (tipo)        { params.push(tipo);        conditions.push(`_dados->>'TIPO_CLC' = $${params.length}`); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         id,
         filial_id,
         data_lancamento,
         competencia,
         _dados->>'SEQU_CLC'            AS lancamento_id,
         _dados->>'CTRL_CLC'            AS documento,
         _dados->>'TIPO_CLC'            AS tipo,
         _dados->>'CODI_CPC'            AS conta,
         _dados->>'CODI_PLC'            AS plano_contas,
         _dados->>'TIPO_LCT'            AS tipo_partida,
         (_dados->>'VLOR_LCT')::NUMERIC AS valor,
         _dados->>'HIST_HIS'            AS historico,
         _sync_at
       FROM raw.contabil
       ${where}
       ORDER BY data_lancamento DESC, id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.contabil ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function saldoContas({ filialId, competencia }) {
  const conditions = [];
  const params = [];

  if (filialId)    { params.push(filialId);    conditions.push(`filial_id = $${params.length}`); }
  if (competencia) { params.push(competencia); conditions.push(`competencia = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await db.query(
    `SELECT
       filial_id,
       competencia,
       _dados->>'CODI_CPC' AS conta,
       _dados->>'CODI_PLC' AS plano_contas,
       SUM((_dados->>'VLOR_LCT')::NUMERIC)
         FILTER (WHERE _dados->>'TIPO_LCT' = 'D') AS total_debito,
       SUM((_dados->>'VLOR_LCT')::NUMERIC)
         FILTER (WHERE _dados->>'TIPO_LCT' = 'C') AS total_credito,
       COALESCE(SUM((_dados->>'VLOR_LCT')::NUMERIC) FILTER (WHERE _dados->>'TIPO_LCT' = 'C'), 0)
         - COALESCE(SUM((_dados->>'VLOR_LCT')::NUMERIC) FILTER (WHERE _dados->>'TIPO_LCT' = 'D'), 0)
         AS saldo
     FROM raw.contabil
     ${where}
     GROUP BY filial_id, competencia, conta, plano_contas
     ORDER BY competencia DESC, conta`,
    params,
  );

  return { data: res.rows };
}

async function resumo({ filialId, anoInicio, anoFim }) {
  const conditions = [];
  const params = [];

  if (filialId)  { params.push(filialId);  conditions.push(`filial_id = $${params.length}`); }
  if (anoInicio) { params.push(`${anoInicio}-01`); conditions.push(`competencia >= $${params.length}`); }
  if (anoFim)    { params.push(`${anoFim}-12`);    conditions.push(`competencia <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await db.query(
    `SELECT
       competencia,
       filial_id,
       COUNT(DISTINCT _dados->>'SEQU_CLC')::INT      AS total_lancamentos,
       COUNT(*)::INT                                  AS total_partidas,
       SUM((_dados->>'VLOR_LCT')::NUMERIC)
         FILTER (WHERE _dados->>'TIPO_LCT' = 'D')    AS total_debito,
       SUM((_dados->>'VLOR_LCT')::NUMERIC)
         FILTER (WHERE _dados->>'TIPO_LCT' = 'C')    AS total_credito
     FROM raw.contabil
     ${where}
     GROUP BY competencia, filial_id
     ORDER BY competencia DESC, filial_id`,
    params,
  );

  return { data: res.rows };
}

module.exports = { listar, saldoContas, resumo };
