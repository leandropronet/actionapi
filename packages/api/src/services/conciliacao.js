'use strict';
/**
 * Conciliação automática entre títulos financeiros e cabeçalhos contábeis.
 *
 * Regras confirmadas no Oracle:
 *   CP: ORIG_CLC='DP' e CTRL_CLC=CTRL_CPG.
 *   CR: ORIG_CLC='NE' e número+série+filial+parceiro do documento.
 */
const db = require('../db/postgres');

const BASE = `
  WITH candidatos AS (
    SELECT
      t.tipo,
      t.titulo_id,
      t.filial_id,
      t.parceiro_id,
      cli.razao_social AS parceiro_nome,
      t.tipo_documento,
      t.numero_documento,
      t.serie_documento,
      t.data_emissao,
      t.valor_total AS valor_financeiro,
      t.status AS status_titulo,
      c.lancamento_id,
      c.data_lancamento,
      c.valor_contabil,
      c.qtd_lancamentos,
      CASE
        WHEN NOT (
          (t.tipo = 'CP' AND t.status = 'NN')
          OR (t.tipo = 'CR' AND t.status = 'A' AND t.tipo_documento = '101')
        ) THEN 'NAO_APLICAVEL_REGRA_AUTOMATICA'
        WHEN c.lancamento_id IS NULL THEN 'SEM_LANCAMENTO_CONTABIL'
        WHEN c.qtd_lancamentos > 1 THEN 'MULTIPLOS_LANCAMENTOS'
        WHEN ABS(COALESCE(c.valor_contabil, 0) - COALESCE(t.valor_total, 0)) > $1
          THEN 'VALOR_DIVERGENTE'
        ELSE 'OK'
      END AS status_conciliacao,
      ROUND(COALESCE(c.valor_contabil, 0) - COALESCE(t.valor_total, 0), 2) AS diferenca_valor,
      CASE t.tipo
        WHEN 'CP' THEN 'DP: CTRL_CLC = CTRL_CPG'
        ELSE 'NE: numero + serie + filial + parceiro'
      END AS regra_vinculo,
      CASE
        WHEN t.tipo = 'CP' AND t.status = 'NN' THEN TRUE
        WHEN t.tipo = 'CR' AND t.status = 'A' AND t.tipo_documento = '101' THEN TRUE
        ELSE FALSE
      END AS regra_automatica_aplicavel
    FROM raw.financeiro_titulos t
    LEFT JOIN raw.clientes cli ON cli.id = t.parceiro_id
    LEFT JOIN LATERAL (
      SELECT
        MIN(h.id) AS lancamento_id,
        MIN(h.data_lancamento) AS data_lancamento,
        SUM(h.valor) AS valor_contabil,
        COUNT(*)::INT AS qtd_lancamentos
      FROM raw.contabil_cabecalhos h
      WHERE (
        t.tipo = 'CP'
        AND h.origem = 'DP'
        AND h.documento = t.titulo_id
      ) OR (
        t.tipo = 'CR'
        AND h.origem = 'NE'
        AND h.documento = t.numero_documento
        AND COALESCE(NULLIF(LTRIM(h.serie_documento, '0'), ''), '0')
          = COALESCE(NULLIF(LTRIM(t.serie_documento, '0'), ''), '0')
        AND h.empresa_documento = t.filial_id
        AND h.parceiro_id = t.parceiro_id
      )
    ) c ON TRUE
  )
`;

function filtersSql(filters, startIndex = 2) {
  const conditions = [];
  const params = [];
  const add = (value, sql) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    conditions.push(sql.replace('?', `$${startIndex + params.length - 1}`));
  };
  add(filters.dataInicio, 'x.data_emissao >= ?');
  add(filters.dataFim, 'x.data_emissao <= ?');
  add(filters.filialId, 'x.filial_id = ?');
  add(filters.tipo, 'x.tipo = ?');
  add(filters.parceiroId, 'x.parceiro_id = ?');
  add(filters.statusConciliacao, 'x.status_conciliacao = ?');
  return { conditions, params };
}

async function listar({
  tolerancia = 0.01,
  somenteDivergencias = false,
  page = 1,
  pageSize = 1000,
  ...filters
}) {
  const built = filtersSql(filters);
  if (somenteDivergencias) {
    built.conditions.push(
      `x.status_conciliacao IN ('SEM_LANCAMENTO_CONTABIL', 'MULTIPLOS_LANCAMENTOS', 'VALOR_DIVERGENTE')`,
    );
  }
  const where = built.conditions.length ? `WHERE ${built.conditions.join(' AND ')}` : '';
  const params = [tolerancia, ...built.params];
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `${BASE}
       SELECT * FROM candidatos x
       ${where}
       ORDER BY x.data_emissao, x.tipo, x.titulo_id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`${BASE} SELECT COUNT(*)::INT AS total FROM candidatos x ${where}`, params),
  ]);
  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize, tolerancia };
}

async function resumo({ tolerancia = 0.01, ...filters }) {
  const built = filtersSql(filters);
  const where = built.conditions.length ? `WHERE ${built.conditions.join(' AND ')}` : '';
  const res = await db.query(
    `${BASE}
     SELECT
       x.tipo,
       x.status_conciliacao,
       COUNT(*)::INT AS quantidade,
       SUM(x.valor_financeiro) AS valor_financeiro,
       SUM(x.valor_contabil) AS valor_contabil,
       SUM(x.diferenca_valor) AS diferenca_valor
     FROM candidatos x
     ${where}
     GROUP BY x.tipo, x.status_conciliacao
     ORDER BY x.tipo, x.status_conciliacao`,
    [tolerancia, ...built.params],
  );
  return { data: res.rows, tolerancia };
}

module.exports = { listar, resumo };
