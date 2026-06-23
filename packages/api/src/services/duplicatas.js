'use strict';
/**
 * services/duplicatas.js
 *
 * Duplicatas (títulos a receber) do SiAGRI.
 *
 * Fonte de dados: raw.duplicatas — JOIN CABREC (cabeçalho) + RECEBER (parcelas)
 *
 * Campos disponíveis em _dados (aliases do ETL):
 *   CTRL_CBR, CODI_EMP, CODI_TRA, DATA_CBR, TOTA_CBR, SITU_CBR  ← cabeçalho
 *   CTRL_REC, NPAR_REC, VENC_REC, VLOR_REC, SITU_REC, ACDU_REC, COD1_PES ← parcela
 *
 * SITU_REC: status da parcela (A=Aberto, B=Baixado, C=Cancelado)
 * ACDU_REC: flag de assinatura digital (S/N) — Fase 2
 *
 * Saldo em aberto (raw.duplicatas_saldo): snapshot diário calculado via a
 * função oficial do Oracle VALOR_ABERTO_RECEBER_DATA — validado em 2026-06-20
 * contra o relatório "Contas a Receber por Cliente - Data" do SiAGRI (bateu
 * exato, R$ 157.092.758,96). A reprodução local equivalente está em
 * raw.financeiro_saldos_local e é exposta junto para auditoria da diferença.
 *
 * Funções exportadas:
 *   listar()        — duplicatas com filtros de vencimento/filial/status/nf/cliente
 *   listarSaldo()    — saldo em aberto por parcela (raw.duplicatas_saldo)
 *   resumoSaldoPorCliente() — saldo em aberto agregado por cliente
 */
const db = require('../db/postgres');

async function listar({ filialId, status, vencimentoAte, vencimentoDe, nfId, clienteId, page = 1, pageSize = 100 }) {
  const conditions = [];
  const params = [];

  if (filialId)     { params.push(filialId);     conditions.push(`filial_id = $${params.length}`); }
  if (nfId)         { params.push(nfId);         conditions.push(`nf_id = $${params.length}`); }
  if (clienteId)    { params.push(clienteId);    conditions.push(`_dados->>'CODI_TRA' = $${params.length}`); }
  if (vencimentoDe) { params.push(vencimentoDe); conditions.push(`data_vencimento >= $${params.length}`); }
  if (vencimentoAte){ params.push(vencimentoAte);conditions.push(`data_vencimento <= $${params.length}`); }
  if (status)       { params.push(status);       conditions.push(`_dados->>'SITU_REC' = $${params.length}`); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         id,
         filial_id,
         nf_id,
         data_emissao,
         data_vencimento,
         _dados->>'CODI_TRA'            AS cliente_id,
         _dados->>'NPAR_REC'            AS parcela_nr,
         (_dados->>'VLOR_REC')::NUMERIC AS valor,
         _dados->>'SITU_REC'            AS status,
         _dados->>'SITU_CBR'            AS status_cabecalho,
         _dados->>'ACDU_REC'            AS flag_assina,
         _dados->>'COD1_PES'            AS vendedor_id,
         _sync_at
       FROM raw.duplicatas
       ${where}
       ORDER BY data_vencimento ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.duplicatas ${where}`, params),
  ]);

  return {
    data:     dataRes.rows,
    total:    countRes.rows[0].total,
    page,
    pageSize,
  };
}

async function listarSaldo({ filialId, clienteId, vencimentoDe, vencimentoAte, page = 1, pageSize = 200 }) {
  const conditions = [];
  const params = [];

  if (filialId)      { params.push(filialId);      conditions.push(`s.filial_id = $${params.length}`); }
  if (clienteId)      { params.push(clienteId);      conditions.push(`s.cliente_id = $${params.length}`); }
  if (vencimentoDe)   { params.push(vencimentoDe);   conditions.push(`s.data_vencimento >= $${params.length}`); }
  if (vencimentoAte)  { params.push(vencimentoAte);  conditions.push(`s.data_vencimento <= $${params.length}`); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         s.id, s.nf_id, s.filial_id, s.cliente_id,
         c.razao_social AS cliente_nome,
         s.tipo_documento, s.natureza_tipo_documento,
         s.numero_documento, s.serie_documento, s.parcela_nr,
         s.data_emissao, s.data_vencimento,
         s.valor_parcela, s.saldo_ajustado, s.dias_atraso,
         s.data_calculo,
         l.saldo_ajustado AS saldo_local,
         l.saldo_ajustado - s.saldo_ajustado AS diferenca_saldo_local,
         l.indexador_id,
         l.indexador_abreviatura AS unidade_saldo,
         l.valor_indexador_origem,
         l.valor_indexador_atual,
         l.saldo_convertido_atual
       FROM raw.duplicatas_saldo s
       LEFT JOIN raw.clientes c ON c.id = s.cliente_id
       LEFT JOIN raw.financeiro_saldos_local l
         ON l.tipo = 'CR' AND l.parcela_id = s.id
       ${where}
       ORDER BY s.data_vencimento ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total, COALESCE(SUM(s.saldo_ajustado),0) AS total_saldo FROM raw.duplicatas_saldo s ${where}`, params),
  ]);

  return {
    data:       dataRes.rows,
    total:      countRes.rows[0].total,
    totalSaldo: countRes.rows[0].total_saldo,
    page,
    pageSize,
  };
}

async function resumoSaldoPorCliente({ filialId, clienteId } = {}) {
  const conditions = [];
  const params = [];

  if (filialId)  { params.push(filialId);  conditions.push(`s.filial_id = $${params.length}`); }
  if (clienteId) { params.push(clienteId); conditions.push(`s.cliente_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await db.query(
    `SELECT
       s.cliente_id,
       c.razao_social AS cliente_nome,
       COUNT(*)::INT AS qtd_parcelas,
       SUM(s.saldo_ajustado) AS saldo_aberto,
       MIN(s.data_vencimento) AS vencimento_mais_antigo,
       SUM(s.saldo_ajustado) FILTER (WHERE s.data_vencimento < CURRENT_DATE) AS saldo_vencido,
       SUM(s.saldo_ajustado) FILTER (WHERE s.data_vencimento >= CURRENT_DATE) AS saldo_a_vencer
     FROM raw.duplicatas_saldo s
     LEFT JOIN raw.clientes c ON c.id = s.cliente_id
     ${where}
     GROUP BY s.cliente_id, c.razao_social
     ORDER BY saldo_aberto DESC`,
    params,
  );

  return { data: res.rows };
}

module.exports = { listar, listarSaldo, resumoSaldoPorCliente };
