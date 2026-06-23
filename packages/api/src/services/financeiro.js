'use strict';
/**
 * services/financeiro.js
 *
 * Contas a Pagar (CP) e Contas a Receber (CR) do SiAGRI.
 *
 * Fontes de dados:
 *   raw.financeiro_cp  — CABPAGAR (cabeçalho) + PAGAR (parcelas)
 *   raw.financeiro_cr  — CABREC (cabeçalho) + RECEBER (parcelas)
 *
 * Campos disponíveis em _dados (aliases do ETL):
 *   CAB_ID, CODI_EMP, DATA_DOC, TOTA_DOC        ← cabeçalho
 *   PAR_ID, NPAR, VENC, VLOR, FLAG_ASSINA, DT_ALTER ← parcela
 *
 * Nota: status de quitação (SITU_REC/SITU_PAG) não é capturado pelo ETL.
 *   Para saber se uma parcela está quitada, consulte raw.recebimentos (CRCBAIXA)
 *   ou raw.pagamentos (CPGBAIXA) fazendo JOIN por CAB_ID/NPAR.
 *
 * Funções exportadas:
 *   listar()     — parcelas CP ou CR com filtros de vencimento/filial
 *   fluxoCaixa() — saldo diário consolidado (receber - pagar) por período
 */
const db = require('../db/postgres');

async function listar({ tipo, filialId, vencimentoDe, vencimentoAte, page = 1, pageSize = 100 }) {
  const tabela = tipo === 'CP' ? 'raw.financeiro_cp' : tipo === 'CR' ? 'raw.financeiro_cr' : null;

  if (!tabela) {
    return listarConsolidado({ filialId, vencimentoDe, vencimentoAte, page, pageSize });
  }

  const conditions = [];
  const params = [];

  if (filialId)     { params.push(filialId);     conditions.push(`filial_id = $${params.length}`); }
  if (vencimentoDe) { params.push(vencimentoDe); conditions.push(`data_vencimento >= $${params.length}`); }
  if (vencimentoAte){ params.push(vencimentoAte);conditions.push(`data_vencimento <= $${params.length}`); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         id,
         filial_id,
         data_emissao,
         data_vencimento,
         _dados->>'CAB_ID'     AS cab_id,
         _dados->>'NPAR'       AS parcela_nr,
         (_dados->>'VLOR')::NUMERIC AS valor,
         _dados->>'FLAG_ASSINA' AS flag_assina,
         _sync_at
       FROM ${tabela}
       ${where}
       ORDER BY data_vencimento ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM ${tabela} ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function listarConsolidado({ filialId, vencimentoDe, vencimentoAte, page, pageSize }) {
  const buildWhere = (params) => {
    const c = [];
    if (filialId)     { params.push(filialId);     c.push(`filial_id = $${params.length}`); }
    if (vencimentoDe) { params.push(vencimentoDe); c.push(`data_vencimento >= $${params.length}`); }
    if (vencimentoAte){ params.push(vencimentoAte);c.push(`data_vencimento <= $${params.length}`); }
    return c.length ? `WHERE ${c.join(' AND ')}` : '';
  };

  const paramsCp = []; const whereCp = buildWhere(paramsCp);
  const paramsCr = []; const whereCr = buildWhere(paramsCr);
  const offset = (page - 1) * pageSize;

  const [cpRes, crRes] = await Promise.all([
    db.query(
      `SELECT
         'CP' AS tipo, id, filial_id, data_emissao, data_vencimento,
         _dados->>'CAB_ID'      AS cab_id,
         _dados->>'NPAR'        AS parcela_nr,
         (_dados->>'VLOR')::NUMERIC AS valor,
         _dados->>'FLAG_ASSINA' AS flag_assina
       FROM raw.financeiro_cp
       ${whereCp}
       ORDER BY data_vencimento
       LIMIT ${pageSize} OFFSET ${offset}`,
      paramsCp,
    ),
    db.query(
      `SELECT
         'CR' AS tipo, id, filial_id, data_emissao, data_vencimento,
         _dados->>'CAB_ID'      AS cab_id,
         _dados->>'NPAR'        AS parcela_nr,
         (_dados->>'VLOR')::NUMERIC AS valor,
         _dados->>'FLAG_ASSINA' AS flag_assina
       FROM raw.financeiro_cr
       ${whereCr}
       ORDER BY data_vencimento
       LIMIT ${pageSize} OFFSET ${offset}`,
      paramsCr,
    ),
  ]);

  return { data: [...cpRes.rows, ...crRes.rows], page, pageSize };
}

async function fluxoCaixa({ dataInicio, dataFim, filialId }) {
  // Projeção pelo SALDO EM ABERTO (convertido para R$, com sinal — créditos
  // negativos), por dia de vencimento, netando CR e CP. Usa o snapshot validado
  // raw.financeiro_saldos_local (= VALOR_ABERTO_RECEBER/PAGAR_DATA) e busca o
  // vencimento de cada parcela em financeiro_cp (CP) e duplicatas (CR).
  const conditions = [
    'v.data_vencimento BETWEEN $1 AND $2',
    'ABS(sl.saldo_ajustado) > 0.01',
  ];
  const params = [dataInicio, dataFim];
  if (filialId) { params.push(filialId); conditions.push(`sl.filial_id = $${params.length}`); }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const res = await db.query(
    `WITH venc AS (
       SELECT 'CP' AS tipo, f.id AS parcela_id, f.data_vencimento
         FROM raw.financeiro_cp f
       UNION ALL
       SELECT 'CR' AS tipo, d.id AS parcela_id, d.data_vencimento
         FROM raw.duplicatas d
     )
     SELECT sl.tipo,
            DATE_TRUNC('day', v.data_vencimento) AS dia,
            SUM(sl.saldo_convertido_atual) AS valor
       FROM raw.financeiro_saldos_local sl
       JOIN venc v ON v.tipo = sl.tipo AND v.parcela_id = sl.parcela_id
       ${where}
       GROUP BY sl.tipo, dia
       ORDER BY dia`,
    params,
  );

  const cp = {};
  const cr = {};
  for (const row of res.rows) {
    const dia = row.dia.toISOString().slice(0, 10);
    if (row.tipo === 'CP') cp[dia] = Number(row.valor);
    else cr[dia] = Number(row.valor);
  }
  const dias = [...new Set([...Object.keys(cp), ...Object.keys(cr)])].sort();

  return {
    data: dias.map((dia) => ({
      dia,
      receber: cr[dia] || 0,
      pagar:   cp[dia] || 0,
      saldo:   (cr[dia] || 0) - (cp[dia] || 0),
    })),
  };
}

module.exports = { listar, fluxoCaixa };
