'use strict';
/**
 * Datasets tabulares para Power BI, Excel e tabelas dinâmicas.
 *
 * Cada endpoint retorna uma linha por fato, sem objetos aninhados:
 *   financeiro() — uma linha por parcela CP/CR com baixas agregadas
 *   contabil()   — uma linha por partida contábil
 */
const db = require('../db/postgres');

function buildCommonFilters({ dataInicio, dataFim, filialId, tipo, parceiroId, status }, alias = 'x') {
  const conditions = [];
  const params = [];

  if (dataInicio) { params.push(dataInicio); conditions.push(`${alias}.data_emissao >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conditions.push(`${alias}.data_emissao <= $${params.length}`); }
  if (filialId)   { params.push(filialId);  conditions.push(`${alias}.filial_id = $${params.length}`); }
  if (tipo)       { params.push(tipo);      conditions.push(`${alias}.tipo = $${params.length}`); }
  if (parceiroId) { params.push(parceiroId); conditions.push(`${alias}.parceiro_id = $${params.length}`); }
  if (status)     { params.push(status);    conditions.push(`${alias}.status_parcela = $${params.length}`); }

  return { conditions, params };
}

const FINANCEIRO_BASE = `
  WITH baixas_cp AS (
    SELECT
      parcela_id,
      COUNT(*) FILTER (WHERE status = 'N')::INT AS qtd_baixas,
      MIN(data_pagamento) FILTER (WHERE status = 'N') AS primeira_baixa,
      MAX(data_pagamento) FILTER (WHERE status = 'N') AS ultima_baixa,
      SUM(CASE WHEN status = 'E' THEN -valor ELSE valor END) AS valor_baixado,
      SUM(CASE WHEN status = 'E' THEN -multa ELSE multa END) AS multa,
      SUM(CASE WHEN status = 'E' THEN -juros ELSE juros END) AS juros,
      SUM(CASE WHEN status = 'E' THEN -desconto ELSE desconto END) AS desconto,
      SUM(CASE WHEN status = 'E' THEN -acrescimo ELSE acrescimo END) AS acrescimo
    FROM raw.pagamentos
    GROUP BY parcela_id
  ),
  baixas_cr AS (
    SELECT
      parcela_id,
      COUNT(*) FILTER (WHERE status = 'N')::INT AS qtd_baixas,
      MIN(data_pagamento) FILTER (WHERE status = 'N') AS primeira_baixa,
      MAX(data_pagamento) FILTER (WHERE status = 'N') AS ultima_baixa,
      SUM(CASE WHEN status = 'E' THEN -valor ELSE valor END) AS valor_baixado,
      SUM(CASE WHEN status = 'E' THEN -multa ELSE multa END) AS multa,
      SUM(CASE WHEN status = 'E' THEN -juros ELSE juros END) AS juros,
      SUM(CASE WHEN status = 'E' THEN -desconto ELSE desconto END) AS desconto,
      SUM(CASE WHEN status = 'E' THEN -acrescimo ELSE acrescimo END) AS acrescimo
    FROM raw.recebimentos
    GROUP BY parcela_id
  ),
  fatos AS (
    SELECT
      'CP'::TEXT AS tipo,
      t.titulo_id,
      f.id AS parcela_id,
      f._dados->>'NPAR' AS parcela_nr,
      t.filial_id,
      t.parceiro_id,
      p.razao_social AS parceiro_nome,
      t.tipo_documento,
      t.numero_documento,
      t.serie_documento,
      t.data_emissao,
      f.data_vencimento,
      t.valor_total AS valor_titulo,
      (f._dados->>'VLOR')::NUMERIC AS valor_parcela,
      t.status AS status_titulo,
      NULL::TEXT AS status_parcela,
      COALESCE(b.valor_baixado, 0) AS valor_baixado,
      COALESCE(b.multa, 0) AS multa,
      COALESCE(b.juros, 0) AS juros,
      COALESCE(b.desconto, 0) AS desconto,
      COALESCE(b.acrescimo, 0) AS acrescimo,
      COALESCE(b.valor_baixado, 0) + COALESCE(b.multa, 0)
        + COALESCE(b.juros, 0) + COALESCE(b.acrescimo, 0)
        - COALESCE(b.desconto, 0) AS valor_liquido_baixa,
      (f._dados->>'VLOR')::NUMERIC - COALESCE(b.valor_baixado, 0) AS saldo_parcela,
      CASE
        WHEN ABS((f._dados->>'VLOR')::NUMERIC - COALESCE(b.valor_baixado, 0)) <= 0.01
          THEN 'BAIXADA'
        WHEN COALESCE(b.valor_baixado, 0) > 0 THEN 'PARCIAL'
        ELSE 'ABERTA'
      END AS situacao_calculada,
      COALESCE(b.qtd_baixas, 0) AS qtd_baixas,
      b.primeira_baixa,
      b.ultima_baixa,
      f._sync_at
    FROM raw.financeiro_cp f
    JOIN raw.financeiro_titulos t
      ON t.tipo = 'CP' AND t.titulo_id = f._dados->>'CAB_ID'
    LEFT JOIN baixas_cp b ON b.parcela_id = f.id
    LEFT JOIN raw.clientes p ON p.id = t.parceiro_id

    UNION ALL

    SELECT
      'CR'::TEXT AS tipo,
      t.titulo_id,
      d.id AS parcela_id,
      d._dados->>'NPAR_REC' AS parcela_nr,
      t.filial_id,
      t.parceiro_id,
      p.razao_social AS parceiro_nome,
      t.tipo_documento,
      t.numero_documento,
      t.serie_documento,
      t.data_emissao,
      d.data_vencimento,
      t.valor_total AS valor_titulo,
      (d._dados->>'VLOR_REC')::NUMERIC AS valor_parcela,
      t.status AS status_titulo,
      d._dados->>'SITU_REC' AS status_parcela,
      COALESCE(b.valor_baixado, 0) AS valor_baixado,
      COALESCE(b.multa, 0) AS multa,
      COALESCE(b.juros, 0) AS juros,
      COALESCE(b.desconto, 0) AS desconto,
      COALESCE(b.acrescimo, 0) AS acrescimo,
      COALESCE(b.valor_baixado, 0) + COALESCE(b.multa, 0)
        + COALESCE(b.juros, 0) + COALESCE(b.acrescimo, 0)
        - COALESCE(b.desconto, 0) AS valor_liquido_baixa,
      (d._dados->>'VLOR_REC')::NUMERIC - COALESCE(b.valor_baixado, 0) AS saldo_parcela,
      CASE
        WHEN d._dados->>'SITU_REC' = 'C' THEN 'CANCELADA'
        WHEN ABS((d._dados->>'VLOR_REC')::NUMERIC - COALESCE(b.valor_baixado, 0)) <= 0.01
          THEN 'BAIXADA'
        WHEN COALESCE(b.valor_baixado, 0) > 0 THEN 'PARCIAL'
        ELSE 'ABERTA'
      END AS situacao_calculada,
      COALESCE(b.qtd_baixas, 0) AS qtd_baixas,
      b.primeira_baixa,
      b.ultima_baixa,
      d._sync_at
    FROM raw.duplicatas d
    JOIN raw.financeiro_titulos t
      ON t.tipo = 'CR' AND t.titulo_id = d.nf_id
    LEFT JOIN baixas_cr b ON b.parcela_id = d.id
    LEFT JOIN raw.clientes p ON p.id = t.parceiro_id
  )
`;

async function financeiro(filters) {
  const { page = 1, pageSize = 1000 } = filters;
  const { conditions, params } = buildCommonFilters(filters);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `${FINANCEIRO_BASE}
       SELECT * FROM fatos x
       ${where}
       ORDER BY x.data_emissao, x.tipo, x.titulo_id, x.parcela_nr
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`${FINANCEIRO_BASE} SELECT COUNT(*)::INT AS total FROM fatos x ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function contabil({
  dataInicio, dataFim, filialId, parceiroId, conta, origem, tipoPartida,
  page = 1, pageSize = 1000,
}) {
  const conditions = [];
  const params = [];
  if (dataInicio)  { params.push(dataInicio);  conditions.push(`h.data_lancamento >= $${params.length}`); }
  if (dataFim)     { params.push(dataFim);     conditions.push(`h.data_lancamento <= $${params.length}`); }
  if (filialId)    { params.push(filialId);    conditions.push(`h.filial_id = $${params.length}`); }
  if (parceiroId)  { params.push(parceiroId);  conditions.push(`h.parceiro_id = $${params.length}`); }
  if (conta)       { params.push(conta);       conditions.push(`c._dados->>'CODI_CPC' = $${params.length}`); }
  if (origem)      { params.push(origem);      conditions.push(`h.origem = $${params.length}`); }
  if (tipoPartida) { params.push(tipoPartida); conditions.push(`c._dados->>'TIPO_LCT' = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const select = `
    SELECT
      h.id AS lancamento_id,
      c._dados->>'SEQU_LCT' AS partida_id,
      h.filial_id,
      h.data_lancamento,
      h.competencia,
      h.origem,
      h.documento,
      h.serie_documento,
      h.empresa_documento,
      h.parceiro_id,
      cli.razao_social AS parceiro_nome,
      h.valor AS valor_lancamento,
      h.tipo AS tipo_contabil,
      c._dados->>'CODI_PLC' AS plano_contas,
      c._dados->>'CODI_CPC' AS conta,
      cp.descricao AS conta_descricao,
      c._dados->>'TIPO_LCT' AS tipo_partida,
      (c._dados->>'VLOR_LCT')::NUMERIC AS valor_partida,
      CASE WHEN c._dados->>'TIPO_LCT' = 'D'
        THEN (c._dados->>'VLOR_LCT')::NUMERIC ELSE 0 END AS valor_debito,
      CASE WHEN c._dados->>'TIPO_LCT' = 'C'
        THEN (c._dados->>'VLOR_LCT')::NUMERIC ELSE 0 END AS valor_credito,
      CASE WHEN c._dados->>'TIPO_LCT' = 'D'
        THEN (c._dados->>'VLOR_LCT')::NUMERIC
        ELSE -(c._dados->>'VLOR_LCT')::NUMERIC END AS valor_assinado,
      c._dados->>'HIST_HIS' AS historico_id,
      hist.descricao AS historico_descricao,
      c._sync_at
    FROM raw.contabil c
    JOIN raw.contabil_cabecalhos h ON h.id = c._dados->>'SEQU_CLC'
    LEFT JOIN raw.contaspl cp
      ON cp.plano_id = c._dados->>'CODI_PLC' AND cp.conta_id = c._dados->>'CODI_CPC'
    LEFT JOIN raw.historico hist ON hist.id = c._dados->>'HIST_HIS'
    LEFT JOIN raw.clientes cli ON cli.id = h.parceiro_id
  `;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `${select} ${where}
       ORDER BY h.data_lancamento, h.id, c._dados->>'SEQU_LCT'
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::INT AS total
       FROM raw.contabil c
       JOIN raw.contabil_cabecalhos h ON h.id = c._dados->>'SEQU_CLC'
       ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function analiseContabil({
  dataInicio, dataFim, filialId, conta, ccustoId, classificacaoEbitda,
  naturezaContabil, safra, page = 1, pageSize = 1000,
}) {
  const conditions = [
    `c._dados->>'CODI_PLC' = '1000002'`,
    `h.tipo = 'F'`,
    `COALESCE(h.origem, '') <> 'ZR'`,
  ];
  const params = [];
  if (dataInicio) {
    params.push(dataInicio);
    conditions.push(`h.data_lancamento >= $${params.length}`);
  }
  if (dataFim) {
    params.push(dataFim);
    conditions.push(`h.data_lancamento <= $${params.length}`);
  }
  if (filialId) {
    params.push(filialId);
    conditions.push(`h.filial_id = $${params.length}`);
  }
  if (conta) {
    params.push(String(conta).replace(/\D/g, ''));
    conditions.push(`cg.conta_id = $${params.length}`);
  }
  if (ccustoId) {
    params.push(ccustoId);
    conditions.push(`cl.ccusto_id = $${params.length}`);
  }
  if (classificacaoEbitda) {
    params.push(classificacaoEbitda);
    conditions.push(`cg.classificacao_ebitda = $${params.length}`);
  }
  if (naturezaContabil) {
    params.push(naturezaContabil);
    conditions.push(`cg.natureza_contabil = $${params.length}`);
  }

  const base = `
    WITH dataset AS (
      SELECT
        h.filial_id,
        CASE h.filial_id
          WHEN '1' THEN 'Goiatuba'
          WHEN '3' THEN 'Gurupi'
          WHEN '4' THEN 'Lagoa C.'
          WHEN '5' THEN 'Porto N.'
          WHEN '8' THEN 'Alvorada'
          WHEN '9' THEN 'Piracanjuba'
          ELSE COALESCE(f._dados->>'IDEN_EMP', h.filial_id)
        END AS loja,
        cg.conta_id,
        cg.conta_formatada AS cod_conta_contabil,
        INITCAP(LOWER(cp.descricao)) AS desc_conta_contabil,
        cl.ccusto_id,
        INITCAP(LOWER(cc.descricao)) AS desc_centro_custo,
        INITCAP(LOWER(cc.descricao)) AS grupo,
        cg.natureza_contabil,
        cg.grupo_nivel_1,
        cg.grupo_nivel_2,
        cg.grupo_nivel_3,
        (DATE_TRUNC('month', h.data_lancamento)
          + INTERVAL '1 month - 1 day')::DATE AS competencia,
        EXTRACT(YEAR FROM DATE_TRUNC('month', h.data_lancamento))::INT AS exercicio,
        -- Período agrícola: 01/07 do ano inicial até 30/06 do ano seguinte.
        CASE
          WHEN EXTRACT(MONTH FROM DATE_TRUNC('month', h.data_lancamento)) >= 7
            THEN 'Safra ' || EXTRACT(YEAR FROM DATE_TRUNC('month', h.data_lancamento))::INT
              || '/' || (EXTRACT(YEAR FROM DATE_TRUNC('month', h.data_lancamento))::INT + 1)
          ELSE 'Safra ' || (EXTRACT(YEAR FROM DATE_TRUNC('month', h.data_lancamento))::INT - 1)
              || '/' || EXTRACT(YEAR FROM DATE_TRUNC('month', h.data_lancamento))::INT
        END AS safra,
        ROUND(SUM(CASE
          WHEN c._dados->>'TIPO_LCT' = 'C' THEN cl.valor
          ELSE -cl.valor
        END), 2) AS valor,
        cg.classificacao_ebitda AS ebitda,
        COUNT(*)::INT AS qtd_partidas,
        MAX(c._sync_at) AS atualizado_em
      FROM raw.contabil c
      JOIN raw.contabil_cabecalhos h
        ON h.id = c._dados->>'SEQU_CLC'
      JOIN raw.ccustolan cl
        ON cl.lancamento_id = c._dados->>'SEQU_LCT'
      JOIN raw.ccusto cc
        ON cc.plano_id = cl.plano_id
       AND cc.ccusto_id = cl.ccusto_id
      JOIN analytics.conta_gerencial cg
        ON cg.conta_id = c._dados->>'CODI_CPC'
      LEFT JOIN raw.contaspl cp
        ON cp.plano_id = c._dados->>'CODI_PLC'
       AND cp.conta_id = c._dados->>'CODI_CPC'
      LEFT JOIN raw.filiais f ON f.id = h.filial_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY
        h.filial_id, f._dados->>'IDEN_EMP', cg.conta_id,
        cg.conta_formatada, cp.descricao, cl.ccusto_id, cc.descricao,
        cg.natureza_contabil, cg.grupo_nivel_1, cg.grupo_nivel_2,
        cg.grupo_nivel_3, cg.classificacao_ebitda,
        DATE_TRUNC('month', h.data_lancamento)
    )
  `;
  const finalParams = [...params];
  let finalWhere = '';
  if (safra) {
    finalParams.push(safra);
    finalWhere = `WHERE safra = $${finalParams.length}`;
  }
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `${base}
       SELECT * FROM dataset
       ${finalWhere}
       ORDER BY competencia, loja, cod_conta_contabil, desc_centro_custo
       LIMIT $${finalParams.length + 1} OFFSET $${finalParams.length + 2}`,
      [...finalParams, pageSize, offset],
    ),
    db.query(
      `${base} SELECT COUNT(*)::INT AS total FROM dataset ${finalWhere}`,
      finalParams,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

module.exports = { financeiro, contabil, analiseContabil };
