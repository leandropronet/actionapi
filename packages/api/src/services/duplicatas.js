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
 * Funções exportadas:
 *   listar() — duplicatas com filtros de vencimento/filial/status/nf/cliente
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

module.exports = { listar };
