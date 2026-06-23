'use strict';
/**
 * Reproduz em PostgreSQL, sem chamar funções Oracle, as regras de:
 *   VALOR_ABERTO_RECEBER_DATA
 *   VALOR_ABERTO_PAGAR_DATA
 *
 * A fórmula foi comparada parcela a parcela em 2026-06-20:
 *   CR: 156.487 parcelas, 0 divergências
 *   CP: 183.656 parcelas, 0 divergências
 */
const pg = require('../db/postgres');
const { atualizarSync } = require('../upsert');

const COTACAO_ATUAL = (alias) => `
  COALESCE(
    (
      SELECT iv.valor
      FROM raw.indexador_valores iv
      WHERE iv.filial_id = ${alias}.indexador_filial_id
        AND iv.indexador_id = ${alias}.indexador_id
        AND iv.data_valor <= CURRENT_DATE
        AND iv.valor > 0
      ORDER BY iv.data_valor DESC
      LIMIT 1
    ),
    (
      SELECT iv.valor
      FROM raw.indexador_valores iv
      WHERE iv.filial_id = ${alias}.indexador_filial_id
        AND iv.indexador_id = ${alias}.indexador_id
        AND iv.data_valor >= CURRENT_DATE
        AND iv.valor > 0
      ORDER BY iv.data_valor
      LIMIT 1
    ),
    1
  )
`;

async function sincronizar() {
  console.log('[financeiro_saldos_local] calculando saldos equivalentes às funções Oracle...');
  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE raw.financeiro_saldos_local');

    await client.query(`
      INSERT INTO raw.financeiro_saldos_local (
        id, tipo, parcela_id, titulo_id, filial_id, parceiro_id,
        tipo_documento, natureza_tipo_documento, valor_parcela_face,
        indexador_id, indexador_abreviatura, valor_indexador_origem,
        saldo_unidade, saldo_ajustado, valor_indexador_atual,
        saldo_convertido_atual, data_calculo, metodologia
      )
      WITH baixas AS (
        SELECT
          d.id AS parcela_id,
          SUM(
            CASE
              WHEN d.indexador_id IS NOT NULL THEN b.valor / iv.valor
              ELSE b.valor
            END
          ) AS valor_baixado,
          MAX(b.data_pagamento) AS ultima_baixa_normal
        FROM raw.duplicatas d
        JOIN raw.recebimentos b
          ON b.parcela_id = d.id
         AND b.status = 'N'
         AND b.data_pagamento <= CURRENT_DATE
        LEFT JOIN raw.indexador_valores iv
          ON iv.filial_id = d.indexador_filial_id
         AND iv.indexador_id = d.indexador_id
         AND iv.data_valor = b.data_indexador
        GROUP BY d.id
      ),
      baixas_todas AS (
        SELECT parcela_id, MAX(data_pagamento) AS ultima_baixa
        FROM raw.recebimentos
        GROUP BY parcela_id
      ),
      agrupamentos AS (
        SELECT parcela_id, SUM(COALESCE(valor, 0)) AS valor_agrupado
        FROM raw.receber_agrupamentos
        WHERE data_titulo_agrupador <= CURRENT_DATE
        GROUP BY parcela_id
      ),
      base AS (
        SELECT
          d.id AS parcela_id,
          d.nf_id AS titulo_id,
          d.filial_id,
          d._dados->>'CODI_TRA' AS parceiro_id,
          d.tipo_documento,
          td.tipo AS natureza_tipo_documento,
          (d._dados->>'VLOR_REC')::NUMERIC AS valor_face,
          d.indexador_id,
          d.indexador_filial_id,
          i.abreviatura,
          iv0.valor AS valor_indice_origem,
          d.data_emissao,
          bt.ultima_baixa,
          p.data_base_baixa,
          p.valor_diferenca,
          CASE
            WHEN d.indexador_id IS NOT NULL
              THEN (d._dados->>'VLOR_REC')::NUMERIC / iv0.valor
            ELSE (d._dados->>'VLOR_REC')::NUMERIC
          END AS valor_titulo_unidade,
          b.valor_baixado,
          CASE
            WHEN d.indexador_id IS NOT NULL
              THEN COALESCE(a.valor_agrupado, 0) / iv0.valor
            ELSE COALESCE(a.valor_agrupado, 0)
          END AS valor_agrupado_unidade
        FROM raw.duplicatas d
        LEFT JOIN raw.tipos_documento td ON td.id = d.tipo_documento
        LEFT JOIN raw.indexadores i ON i.id = d.indexador_id
        LEFT JOIN raw.indexador_valores iv0
          ON iv0.filial_id = d.indexador_filial_id
         AND iv0.indexador_id = d.indexador_id
         AND iv0.data_valor = d.data_indexador
        LEFT JOIN baixas b ON b.parcela_id = d.id
        LEFT JOIN baixas_todas bt ON bt.parcela_id = d.id
        LEFT JOIN agrupamentos a ON a.parcela_id = d.id
        LEFT JOIN raw.param_ger_financ p ON p.id = d.filial_id
      ),
      bruto AS (
        SELECT
          base.*,
          CASE
            WHEN indexador_id IS NULL AND valor_baixado IS NOT NULL
              THEN ROUND(valor_titulo_unidade - valor_baixado - valor_agrupado_unidade, 2)
            ELSE valor_titulo_unidade - COALESCE(valor_baixado, 0) - valor_agrupado_unidade
          END AS saldo_bruto
        FROM base
      ),
      calculado AS (
        SELECT
          bruto.*,
          CASE
            WHEN (
              data_base_baixa IS NULL
              OR (
                (data_emissao < data_base_baixa AND ultima_baixa IS NULL)
                OR ultima_baixa < data_base_baixa
              )
            )
            AND saldo_bruto <= valor_diferenca THEN 0
            WHEN saldo_bruto < 0.005 THEN ROUND(saldo_bruto, 2)
            ELSE saldo_bruto
          END AS saldo_local
        FROM bruto
      ),
      cotado AS (
        SELECT calculado.*, ${COTACAO_ATUAL('calculado')} AS cotacao_atual
        FROM calculado
      )
      SELECT
        'CR_' || parcela_id,
        'CR',
        parcela_id,
        titulo_id,
        filial_id,
        parceiro_id,
        tipo_documento,
        natureza_tipo_documento,
        valor_face,
        indexador_id,
        COALESCE(abreviatura, 'R$'),
        valor_indice_origem,
        saldo_local,
        ROUND(CASE WHEN natureza_tipo_documento = 'C' THEN -saldo_local ELSE saldo_local END, 2),
        CASE WHEN indexador_id IS NULL THEN 1 ELSE cotacao_atual END,
        ROUND(
          ROUND(CASE WHEN natureza_tipo_documento = 'C' THEN -saldo_local ELSE saldo_local END, 2)
          * CASE WHEN indexador_id IS NULL THEN 1 ELSE cotacao_atual END,
          2
        ),
        CURRENT_DATE,
        'EQUIVALENTE_VALOR_ABERTO_RECEBER_DATA'
      FROM cotado
    `);

    await client.query(`
      INSERT INTO raw.financeiro_saldos_local (
        id, tipo, parcela_id, titulo_id, filial_id, parceiro_id,
        tipo_documento, natureza_tipo_documento, valor_parcela_face,
        indexador_id, indexador_abreviatura, valor_indexador_origem,
        saldo_unidade, saldo_ajustado, valor_indexador_atual,
        saldo_convertido_atual, data_calculo, metodologia
      )
      WITH baixas AS (
        SELECT
          f.id AS parcela_id,
          SUM(
            CASE
              WHEN f.indexador_id IS NOT NULL THEN b.valor / iv.valor
              ELSE b.valor
            END
          ) AS valor_baixado
        FROM raw.financeiro_cp f
        JOIN raw.pagamentos b
          ON b.parcela_id = f.id
         AND b.status = 'N'
         AND b.data_pagamento <= CURRENT_DATE
        LEFT JOIN raw.indexador_valores iv
          ON iv.filial_id = f.filial_id
         AND iv.indexador_id = f.indexador_id
         AND iv.data_valor = b.data_indexador
        GROUP BY f.id
      ),
      baixas_todas AS (
        SELECT parcela_id, MAX(data_pagamento) AS ultima_baixa
        FROM raw.pagamentos
        GROUP BY parcela_id
      ),
      agrupamentos AS (
        SELECT
          parcela_id,
          SUM(
            CASE
              WHEN a.indexador_id IS NOT NULL THEN a.valor / iv.valor
              ELSE a.valor
            END
          ) AS valor_agrupado
        FROM raw.pagar_agrupamentos a
        LEFT JOIN raw.indexador_valores iv
          ON iv.filial_id = a.indexador_filial_id
         AND iv.indexador_id = a.indexador_id
         AND iv.data_valor = a.data_indexador
        WHERE data_titulo_agrupador <= CURRENT_DATE
        GROUP BY parcela_id
      ),
      base AS (
        SELECT
          f.id AS parcela_id,
          f._dados->>'CAB_ID' AS titulo_id,
          f.filial_id,
          f.parceiro_id,
          f.tipo_documento,
          td.tipo AS natureza_tipo_documento,
          (f._dados->>'VLOR')::NUMERIC AS valor_face,
          f.indexador_id,
          f.filial_id AS indexador_filial_id,
          i.abreviatura,
          iv0.valor AS valor_indice_origem,
          f.data_emissao,
          bt.ultima_baixa,
          p.data_base_baixa,
          p.valor_diferenca,
          CASE
            WHEN f.indexador_id IS NOT NULL
              THEN (f._dados->>'VLOR')::NUMERIC / iv0.valor
            ELSE (f._dados->>'VLOR')::NUMERIC
          END AS valor_titulo_unidade,
          b.valor_baixado,
          COALESCE(a.valor_agrupado, 0) AS valor_agrupado,
          EXISTS (
            SELECT 1 FROM raw.pagar_saldo_exclusoes e WHERE e.parcela_id = f.id
          ) AS excluida
        FROM raw.financeiro_cp f
        LEFT JOIN raw.tipos_documento td ON td.id = f.tipo_documento
        LEFT JOIN raw.indexadores i ON i.id = f.indexador_id
        LEFT JOIN raw.indexador_valores iv0
          ON iv0.filial_id = f.filial_id
         AND iv0.indexador_id = f.indexador_id
         AND iv0.data_valor = f.data_indexador
        LEFT JOIN baixas b ON b.parcela_id = f.id
        LEFT JOIN baixas_todas bt ON bt.parcela_id = f.id
        LEFT JOIN agrupamentos a ON a.parcela_id = f.id
        LEFT JOIN raw.param_ger_financ p ON p.id = f.filial_id
      ),
      bruto AS (
        SELECT
          base.*,
          CASE
            WHEN valor_baixado IS NULL OR valor_baixado + valor_agrupado = 0
              THEN valor_titulo_unidade
            WHEN indexador_id IS NULL
              THEN ROUND(valor_titulo_unidade - valor_baixado - valor_agrupado, 2)
            ELSE valor_titulo_unidade - valor_baixado - valor_agrupado
          END AS saldo_bruto
        FROM base
      ),
      calculado AS (
        SELECT
          bruto.*,
          CASE
            WHEN excluida THEN 0
            WHEN (
              data_base_baixa IS NULL
              OR (
                (data_emissao < data_base_baixa AND ultima_baixa IS NULL)
                OR ultima_baixa < data_base_baixa
              )
            )
            AND saldo_bruto <= valor_diferenca THEN 0
            WHEN saldo_bruto < 0.005 THEN ROUND(saldo_bruto, 2)
            ELSE saldo_bruto
          END AS saldo_local
        FROM bruto
      ),
      cotado AS (
        SELECT calculado.*, ${COTACAO_ATUAL('calculado')} AS cotacao_atual
        FROM calculado
      )
      SELECT
        'CP_' || parcela_id,
        'CP',
        parcela_id,
        titulo_id,
        filial_id,
        parceiro_id,
        tipo_documento,
        natureza_tipo_documento,
        valor_face,
        indexador_id,
        COALESCE(abreviatura, 'R$'),
        valor_indice_origem,
        ROUND(saldo_local, 2),
        ROUND(CASE WHEN natureza_tipo_documento = 'C' THEN -saldo_local ELSE saldo_local END, 2),
        CASE WHEN indexador_id IS NULL THEN 1 ELSE cotacao_atual END,
        ROUND(
          ROUND(CASE WHEN natureza_tipo_documento = 'C' THEN -saldo_local ELSE saldo_local END, 2)
          * CASE WHEN indexador_id IS NULL THEN 1 ELSE cotacao_atual END,
          2
        ),
        CURRENT_DATE,
        'EQUIVALENTE_VALOR_ABERTO_PAGAR_DATA'
      FROM cotado
    `);

    await client.query('COMMIT');
    await atualizarSync('financeiro_saldos_local');

    const totals = await pg.query(`
      SELECT s.tipo,
             COUNT(*) FILTER (
               WHERE ABS(s.saldo_unidade) > 0
                 AND (
                   (s.tipo = 'CP' AND s.saldo_ajustado > 0.005)
                   OR (
                     d._dados->>'SITU_REC' = 'A'
                     AND d._dados->>'SITU_CBR' = 'A'
                     AND (
                       (s.natureza_tipo_documento = 'D' AND s.saldo_ajustado > 0)
                       OR (s.natureza_tipo_documento = 'C' AND s.saldo_ajustado < 0)
                     )
                   )
                 )
             )::INT AS parcelas_abertas,
             SUM(s.saldo_ajustado) FILTER (
               WHERE ABS(s.saldo_unidade) > 0
                 AND (
                   (s.tipo = 'CP' AND s.saldo_ajustado > 0.005)
                   OR (
                     d._dados->>'SITU_REC' = 'A'
                     AND d._dados->>'SITU_CBR' = 'A'
                     AND (
                       (s.natureza_tipo_documento = 'D' AND s.saldo_ajustado > 0)
                       OR (s.natureza_tipo_documento = 'C' AND s.saldo_ajustado < 0)
                     )
                   )
                 )
             ) AS saldo_aberto
      FROM raw.financeiro_saldos_local s
      LEFT JOIN raw.duplicatas d ON s.tipo = 'CR' AND d.id = s.parcela_id
      GROUP BY s.tipo
      ORDER BY s.tipo
    `);
    console.log('[financeiro_saldos_local]', totals.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { sincronizar };
