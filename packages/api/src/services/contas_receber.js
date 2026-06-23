'use strict';
/**
 * Dataset de Contas a Receber para dashboard, Excel e Power BI.
 *
 * Granularidade: uma linha por parcela em aberto do snapshot
 * raw.duplicatas_saldo. Esse snapshot é calculado pela função oficial
 * VALOR_ABERTO_RECEBER_DATA do Oracle e preserva a unidade dos contratos
 * indexados (R$, SJ$, US$ ou ER).
 */
const db = require('../db/postgres');

const CONTAS_RECEBER_BASE = `
  WITH recebimentos AS (
    SELECT
      parcela_id,
      COUNT(*)::INT AS qtd_baixas,
      MIN(data_pagamento) AS primeira_baixa,
      MAX(data_pagamento) AS ultima_baixa,
      SUM(valor) AS valor_baixado,
      SUM(multa) AS multa,
      SUM(juros) AS juros,
      SUM(desconto) AS desconto,
      SUM(acrescimo) AS acrescimo,
      SUM(COALESCE(valor_complementar, 0)) AS valor_complementar
    FROM raw.recebimentos
    WHERE status = 'N' AND data_pagamento <= CURRENT_DATE
    GROUP BY parcela_id
  ),
  fatos AS (
    SELECT
      s.id AS parcela_id,
      s.nf_id AS titulo_id,
      s.filial_id,
      COALESCE(fil_cli.razao_social, fil_forn.razao_social, fil._dados->>'FANT_EMP')
        AS filial_nome,
      fil._dados->>'FANT_EMP' AS filial_fantasia,
      fil._dados->>'IDEN_EMP' AS filial_identificacao,
      s.cliente_id,
      cli.razao_social AS cliente_nome,
      cli.cgc_cnpj AS cliente_cnpj_cpf,
      d._dados->>'COD1_PES' AS vendedor_id,
      vend._dados->>'NOME_PES' AS vendedor_nome,
      CASE
        WHEN NULLIF(d._dados->>'COD1_PES', '') IS NULL
          THEN 'NAO_INFORMADO_NO_TITULO'
        WHEN vend.id IS NULL
          THEN 'CADASTRO_NAO_SINCRONIZADO'
        ELSE 'INFORMADO'
      END AS vendedor_status,
      s.tipo_documento,
      td.descricao AS tipo_documento_descricao,
      s.natureza_tipo_documento,
      d._dados->>'HISTORICO' AS historico,
      COALESCE(d._dados->>'HISTORICO' ILIKE '%FIDC%' OR d._dados->>'HISTORICO' ILIKE '%FIDIC%', FALSE) AS fidc,
      s.numero_documento,
      s.serie_documento,
      s.parcela_nr,
      s.data_emissao,
      s.data_vencimento,
      (d._dados->>'TOTA_CBR')::NUMERIC AS valor_titulo,
      s.valor_parcela,
      s.saldo_funcao,
      s.saldo_ajustado AS saldo_parcela,
      COALESCE(l.indexador_abreviatura, 'R$') AS unidade_saldo,
      l.indexador_id,
      idx.descricao AS indexador_descricao,
      l.valor_indexador_origem,
      l.valor_indexador_atual,
      l.saldo_convertido_atual,
      l.saldo_ajustado AS saldo_local,
      l.saldo_ajustado - s.saldo_ajustado AS diferenca_saldo_local,
      COALESCE(r.qtd_baixas, 0) AS qtd_baixas,
      COALESCE(r.valor_baixado, 0) AS valor_baixado,
      COALESCE(r.multa, 0) AS multa,
      COALESCE(r.juros, 0) AS juros,
      COALESCE(r.desconto, 0) AS desconto,
      COALESCE(r.acrescimo, 0) AS acrescimo,
      COALESCE(r.valor_complementar, 0) AS valor_complementar,
      COALESCE(r.valor_baixado, 0)
        + COALESCE(r.multa, 0)
        + COALESCE(r.juros, 0)
        + COALESCE(r.acrescimo, 0)
        - COALESCE(r.desconto, 0) AS valor_liquido_baixas,
      r.primeira_baixa,
      r.ultima_baixa,
      CASE
        WHEN s.saldo_ajustado < -0.01 THEN 'CREDITO_EM_ABERTO'
        WHEN s.data_vencimento < s.data_calculo THEN 'VENCIDA'
        WHEN s.data_vencimento = s.data_calculo THEN 'VENCE_HOJE'
        ELSE 'A_VENCER'
      END AS situacao,
      GREATEST(s.data_calculo - s.data_vencimento, 0) AS dias_atraso,
      CASE
        WHEN s.saldo_ajustado < -0.01 THEN 'CREDITO_EM_ABERTO'
        WHEN s.data_vencimento < s.data_calculo - 90 THEN 'VENCIDO_ACIMA_90_DIAS'
        WHEN s.data_vencimento < s.data_calculo - 30 THEN 'VENCIDO_31_A_90_DIAS'
        WHEN s.data_vencimento < s.data_calculo THEN 'VENCIDO_1_A_30_DIAS'
        WHEN s.data_vencimento = s.data_calculo THEN 'VENCE_HOJE'
        WHEN s.data_vencimento <= s.data_calculo + 7 THEN 'VENCE_EM_1_A_7_DIAS'
        WHEN s.data_vencimento <= s.data_calculo + 30 THEN 'VENCE_EM_8_A_30_DIAS'
        WHEN s.data_vencimento <= s.data_calculo + 60 THEN 'VENCE_EM_31_A_60_DIAS'
        WHEN s.data_vencimento <= s.data_calculo + 90 THEN 'VENCE_EM_61_A_90_DIAS'
        ELSE 'VENCE_ACIMA_90_DIAS'
      END AS faixa_vencimento,
      d._dados->>'SITU_REC' AS status_parcela,
      d._dados->>'SITU_CBR' AS status_titulo,
      d._dados->>'ACDU_REC' AS flag_assinatura_digital,
      s.data_calculo,
      s._sync_at
    FROM raw.duplicatas_saldo s
    JOIN raw.duplicatas d ON d.id = s.id
    LEFT JOIN raw.financeiro_saldos_local l
      ON l.tipo = 'CR' AND l.parcela_id = s.id
    LEFT JOIN recebimentos r ON r.parcela_id = s.id
    LEFT JOIN raw.clientes cli ON cli.id = s.cliente_id
    LEFT JOIN raw.tipos_documento td ON td.id = s.tipo_documento
    LEFT JOIN raw.indexadores idx ON idx.id = l.indexador_id
    LEFT JOIN raw.vendedores vend ON vend.id = d._dados->>'COD1_PES'
    LEFT JOIN raw.filiais fil ON fil.id = s.filial_id
    LEFT JOIN raw.clientes fil_cli ON fil_cli.id = fil._dados->>'COD1_TRA'
    LEFT JOIN raw.fornecedores fil_forn ON fil_forn.id = fil._dados->>'COD1_TRA'
  )
`;

function buildFilters({
  filialId,
  clienteId,
  tipoDocumento,
  emissaoDe,
  emissaoAte,
  vencimentoDe,
  vencimentoAte,
  situacao,
  faixaVencimento,
  unidadeSaldo,
  vendedorId,
}) {
  const conditions = [];
  const params = [];
  const add = (value, expression) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    conditions.push(expression.replace('?', `$${params.length}`));
  };

  add(filialId, 'x.filial_id = ?');
  add(clienteId, 'x.cliente_id = ?');
  add(tipoDocumento, 'x.tipo_documento = ?');
  add(emissaoDe, 'x.data_emissao >= ?');
  add(emissaoAte, 'x.data_emissao <= ?');
  add(vencimentoDe, 'x.data_vencimento >= ?');
  add(vencimentoAte, 'x.data_vencimento <= ?');
  add(situacao, 'x.situacao = ?');
  add(faixaVencimento, 'x.faixa_vencimento = ?');
  add(unidadeSaldo, 'x.unidade_saldo = ?');
  add(vendedorId, 'x.vendedor_id = ?');

  return {
    params,
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
  };
}

async function listar(filters) {
  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 500, 1), 10000);
  const offset = (page - 1) * pageSize;
  const { params, where } = buildFilters(filters);

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `${CONTAS_RECEBER_BASE}
       SELECT * FROM fatos x
       ${where}
       ORDER BY x.data_vencimento, x.cliente_nome, x.titulo_id, x.parcela_nr
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `${CONTAS_RECEBER_BASE}
       SELECT COUNT(*)::INT AS total FROM fatos x ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function resumo(filters) {
  const { params, where } = buildFilters(filters);
  const filtrados = `${CONTAS_RECEBER_BASE}, filtrados AS (SELECT * FROM fatos x ${where})`;

  const [clientesRes, unidadesRes, totaisRes] = await Promise.all([
    db.query(
      `${filtrados}
       SELECT
         filial_id,
         filial_nome,
         filial_identificacao,
         cliente_id,
         cliente_nome,
         cliente_cnpj_cpf,
         unidade_saldo,
         COUNT(*)::INT AS qtd_parcelas,
         COUNT(DISTINCT titulo_id)::INT AS qtd_titulos,
         SUM(valor_parcela) AS valor_parcelas,
         SUM(saldo_parcela) AS saldo_aberto,
         SUM(saldo_convertido_atual) AS saldo_convertido_atual,
         SUM(saldo_parcela) FILTER (WHERE situacao = 'VENCIDA') AS saldo_vencido,
         SUM(saldo_convertido_atual) FILTER (WHERE situacao = 'VENCIDA')
           AS saldo_vencido_convertido,
         SUM(saldo_parcela) FILTER (WHERE situacao IN ('A_VENCER', 'VENCE_HOJE'))
           AS saldo_a_vencer,
         MIN(data_vencimento) AS primeiro_vencimento,
         MAX(data_vencimento) AS ultimo_vencimento,
         MAX(dias_atraso)::INT AS maior_atraso_dias
       FROM filtrados
       GROUP BY filial_id, filial_nome, filial_identificacao, cliente_id, cliente_nome,
         cliente_cnpj_cpf, unidade_saldo
       ORDER BY saldo_convertido_atual DESC NULLS LAST, cliente_nome`,
      params,
    ),
    db.query(
      `${filtrados}
       SELECT
         unidade_saldo,
         COUNT(*)::INT AS qtd_parcelas,
         COUNT(DISTINCT titulo_id)::INT AS qtd_titulos,
         COUNT(DISTINCT cliente_id)::INT AS qtd_clientes,
         SUM(saldo_parcela) AS saldo_aberto,
         SUM(saldo_convertido_atual) AS saldo_convertido_atual,
         SUM(saldo_parcela) FILTER (WHERE situacao = 'VENCIDA') AS saldo_vencido,
         SUM(saldo_convertido_atual) FILTER (WHERE situacao = 'VENCIDA')
           AS saldo_vencido_convertido
       FROM filtrados
       GROUP BY unidade_saldo
       ORDER BY unidade_saldo`,
      params,
    ),
    db.query(
      `${filtrados}
       SELECT
         COUNT(*)::INT AS qtd_parcelas,
         COUNT(DISTINCT titulo_id)::INT AS qtd_titulos,
         COUNT(DISTINCT cliente_id)::INT AS qtd_clientes,
         SUM(saldo_convertido_atual) AS saldo_convertido_atual,
         SUM(saldo_convertido_atual) FILTER (WHERE situacao = 'VENCIDA')
           AS saldo_vencido_convertido,
         SUM(saldo_convertido_atual) FILTER (
           WHERE data_vencimento BETWEEN data_calculo AND data_calculo + 7
         ) AS saldo_proximos_7_dias_convertido,
         SUM(saldo_convertido_atual) FILTER (
           WHERE data_vencimento BETWEEN data_calculo AND data_calculo + 30
         ) AS saldo_proximos_30_dias_convertido,
         COUNT(*) FILTER (WHERE situacao = 'VENCIDA')::INT AS qtd_parcelas_vencidas,
         COUNT(*) FILTER (WHERE unidade_saldo <> 'R$')::INT AS qtd_parcelas_indexadas,
         COUNT(*) FILTER (WHERE fidc)::INT AS qtd_parcelas_fidc,
         SUM(saldo_convertido_atual) FILTER (WHERE fidc) AS saldo_fidc_convertido,
         MIN(data_calculo) AS data_calculo
       FROM filtrados`,
      params,
    ),
  ]);

  return {
    data: clientesRes.rows,
    unidades: unidadesRes.rows,
    totalizadores: totaisRes.rows[0],
  };
}

module.exports = { listar, resumo };
