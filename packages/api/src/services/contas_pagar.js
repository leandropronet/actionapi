'use strict';
/**
 * Dataset de Contas a Pagar para dashboard, Excel e Power BI.
 *
 * Granularidade: uma linha por parcela de PAGAR. Pedidos e produtos são
 * agregados por título antes do JOIN, impedindo que os valores financeiros
 * sejam multiplicados quando uma nota possui vários itens.
 *
 * Vínculo de compra:
 * CABPAGAR <- NOTACPG -> INFENTRA -> PEDCOM.
 */
const db = require('../db/postgres');

const CONTAS_PAGAR_BASE = `
  WITH pagamentos AS (
    SELECT
      parcela_id,
      COUNT(*)::INT AS qtd_baixas,
      MIN(data_pagamento) AS primeira_baixa,
      MAX(data_pagamento) AS ultima_baixa,
      SUM(valor) AS valor_baixado,
      SUM(multa) AS multa,
      SUM(juros) AS juros,
      SUM(desconto) AS desconto,
      SUM(acrescimo) AS acrescimo
    FROM raw.pagamentos
    WHERE status = 'N' AND data_pagamento <= CURRENT_DATE
    GROUP BY parcela_id
  ),
  vinculos AS (
    SELECT
      v.titulo_id,
      COUNT(DISTINCT v.pedido_id)::INT AS qtd_pedidos,
      COUNT(DISTINCT v.produto_id)::INT AS qtd_produtos,
      ARRAY_AGG(DISTINCT v.pedido_id ORDER BY v.pedido_id) AS pedido_ids_array,
      ARRAY_AGG(DISTINCT v.numero_pedido ORDER BY v.numero_pedido)
        FILTER (WHERE v.numero_pedido IS NOT NULL) AS pedido_numeros_array,
      ARRAY_AGG(DISTINCT v.produto_id ORDER BY v.produto_id)
        FILTER (WHERE v.produto_id IS NOT NULL) AS produto_ids_array,
      ARRAY_AGG(DISTINCT v.nf_entrada_id ORDER BY v.nf_entrada_id) AS nf_entrada_ids_array,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.fornecedor_id), NULL) AS fornecedor_pedido_ids,
      ARRAY_REMOVE(
        ARRAY_AGG(
          DISTINCT LEFT(REGEXP_REPLACE(COALESCE(pf.cgc_cnpj, pc.cgc_cnpj, ''), '[^0-9]', '', 'g'), 8)
        ),
        ''
      ) AS fornecedor_pedido_raizes_cnpj,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.filial_id), NULL) AS filial_pedido_ids,
      STRING_AGG(DISTINCT p.fornecedor_id, ' | ' ORDER BY p.fornecedor_id)
        FILTER (WHERE p.fornecedor_id IS NOT NULL) AS fornecedores_pedido_ids,
      STRING_AGG(
        DISTINCT COALESCE(pf.razao_social, pc.razao_social),
        ' | ' ORDER BY COALESCE(pf.razao_social, pc.razao_social)
      ) FILTER (WHERE COALESCE(pf.razao_social, pc.razao_social) IS NOT NULL)
        AS fornecedores_pedido_nomes,
      STRING_AGG(
        DISTINCT COALESCE(pf.cgc_cnpj, pc.cgc_cnpj),
        ' | ' ORDER BY COALESCE(pf.cgc_cnpj, pc.cgc_cnpj)
      ) FILTER (WHERE COALESCE(pf.cgc_cnpj, pc.cgc_cnpj) IS NOT NULL)
        AS fornecedores_pedido_cnpjs,
      STRING_AGG(DISTINCT p.filial_id, ' | ' ORDER BY p.filial_id)
        FILTER (WHERE p.filial_id IS NOT NULL) AS filiais_pedido_ids,
      STRING_AGG(DISTINCT v.pedido_id, ' | ' ORDER BY v.pedido_id) AS pedidos_ids,
      STRING_AGG(DISTINCT v.numero_pedido, ' | ' ORDER BY v.numero_pedido)
        FILTER (WHERE v.numero_pedido IS NOT NULL) AS pedidos_numeros,
      STRING_AGG(DISTINCT p._dados->>'NUFO_PEC', ' | ' ORDER BY p._dados->>'NUFO_PEC')
        FILTER (WHERE NULLIF(TRIM(p._dados->>'NUFO_PEC'), '') IS NOT NULL)
        AS pedidos_fornecedor_numeros,
      STRING_AGG(DISTINCT v.produto_id, ' | ' ORDER BY v.produto_id)
        FILTER (WHERE v.produto_id IS NOT NULL) AS produtos_ids,
      STRING_AGG(DISTINCT v.produto_descricao, ' | ' ORDER BY v.produto_descricao)
        FILTER (WHERE v.produto_descricao IS NOT NULL) AS produtos_descricoes,
      STRING_AGG(DISTINCT v.nf_entrada_id, ' | ' ORDER BY v.nf_entrada_id) AS nf_entrada_ids,
      MIN(p.data_pedido) AS primeira_data_pedido,
      MAX(p.data_pedido) AS ultima_data_pedido
    FROM raw.financeiro_titulo_pedidos v
    LEFT JOIN raw.pedidos_compra p ON p.id = v.pedido_id
    LEFT JOIN raw.fornecedores pf ON pf.id = p.fornecedor_id
    LEFT JOIN raw.clientes pc ON pc.id = p.fornecedor_id
    GROUP BY v.titulo_id
  ),
  fatos AS (
    SELECT
      f.id AS parcela_id,
      COALESCE(t.titulo_id, f._dados->>'CAB_ID') AS titulo_id,
      f._dados->>'NPAR' AS parcela_nr,
      f.filial_id,
      COALESCE(fil_forn.razao_social, fil_cli.razao_social, fil._dados->>'FANT_EMP')
        AS filial_nome,
      fil._dados->>'FANT_EMP' AS filial_fantasia,
      fil._dados->>'IDEN_EMP' AS filial_identificacao,
      COALESCE(t.parceiro_id, f.parceiro_id) AS fornecedor_id,
      COALESCE(forn.razao_social, cli.razao_social) AS fornecedor_nome,
      COALESCE(forn.cgc_cnpj, cli.cgc_cnpj) AS fornecedor_cnpj_cpf,
      COALESCE(t.tipo_documento, f.tipo_documento) AS tipo_documento,
      td.descricao AS tipo_documento_descricao,
      td.tipo AS natureza_tipo_documento,
      f._dados->>'HISTORICO' AS historico,
      COALESCE(f._dados->>'HISTORICO' ILIKE '%FIDC%' OR f._dados->>'HISTORICO' ILIKE '%FIDIC%', FALSE) AS fidc,
      t.numero_documento,
      COALESCE(t.data_emissao, f.data_emissao) AS data_emissao,
      f.data_vencimento,
      COALESCE(t.valor_total, (f._dados->>'TOTA_DOC')::NUMERIC) AS valor_titulo,
      (f._dados->>'VLOR')::NUMERIC AS valor_parcela,
      COALESCE(pg.valor_baixado, 0) AS valor_baixado,
      COALESCE(pg.multa, 0) AS multa,
      COALESCE(pg.juros, 0) AS juros,
      COALESCE(pg.desconto, 0) AS desconto,
      COALESCE(pg.acrescimo, 0) AS acrescimo,
      COALESCE(pg.valor_baixado, 0)
        + COALESCE(pg.multa, 0)
        + COALESCE(pg.juros, 0)
        + COALESCE(pg.acrescimo, 0)
        - COALESCE(pg.desconto, 0) AS valor_liquido_baixa,
      sl.saldo_ajustado AS saldo_parcela,
      sl.indexador_abreviatura AS unidade_saldo,
      sl.indexador_id,
      sl.valor_indexador_origem,
      sl.valor_indexador_atual,
      sl.saldo_convertido_atual,
      CASE
        WHEN ABS(sl.saldo_ajustado) <= 0.01
          THEN 'BAIXADA'
        WHEN COALESCE(pg.valor_baixado, 0) > 0 THEN 'PARCIAL'
        ELSE 'ABERTA'
      END AS situacao,
      CASE
        WHEN ABS(sl.saldo_ajustado) <= 0.01
          THEN 0
        WHEN f.data_vencimento < CURRENT_DATE
          THEN CURRENT_DATE - f.data_vencimento
        ELSE 0
      END AS dias_atraso,
      CASE
        WHEN ABS(sl.saldo_ajustado) <= 0.01
          THEN 'BAIXADA'
        WHEN f.data_vencimento < CURRENT_DATE - 90 THEN 'VENCIDO_ACIMA_90_DIAS'
        WHEN f.data_vencimento < CURRENT_DATE - 30 THEN 'VENCIDO_31_A_90_DIAS'
        WHEN f.data_vencimento < CURRENT_DATE THEN 'VENCIDO_1_A_30_DIAS'
        WHEN f.data_vencimento = CURRENT_DATE THEN 'VENCE_HOJE'
        WHEN f.data_vencimento <= CURRENT_DATE + 7 THEN 'VENCE_EM_1_A_7_DIAS'
        WHEN f.data_vencimento <= CURRENT_DATE + 30 THEN 'VENCE_EM_8_A_30_DIAS'
        WHEN f.data_vencimento <= CURRENT_DATE + 60 THEN 'VENCE_EM_31_A_60_DIAS'
        WHEN f.data_vencimento <= CURRENT_DATE + 90 THEN 'VENCE_EM_61_A_90_DIAS'
        ELSE 'VENCE_ACIMA_90_DIAS'
      END AS faixa_vencimento,
      COALESCE(pg.qtd_baixas, 0) AS qtd_baixas,
      pg.primeira_baixa,
      pg.ultima_baixa,
      COALESCE(v.qtd_pedidos, 0) AS qtd_pedidos,
      COALESCE(v.qtd_produtos, 0) AS qtd_produtos,
      v.pedido_ids_array,
      v.pedido_numeros_array,
      v.produto_ids_array,
      COALESCE(
        v.nf_entrada_ids_array,
        CASE WHEN t.nf_entrada_id IS NOT NULL THEN ARRAY[t.nf_entrada_id] END
      ) AS nf_entrada_ids_array,
      v.pedidos_ids,
      v.pedidos_numeros,
      v.pedidos_fornecedor_numeros,
      v.fornecedores_pedido_ids,
      v.fornecedores_pedido_nomes,
      v.fornecedores_pedido_cnpjs,
      v.filiais_pedido_ids,
      v.produtos_ids,
      v.produtos_descricoes,
      COALESCE(v.nf_entrada_ids, t.nf_entrada_id) AS nf_entrada_ids,
      v.primeira_data_pedido,
      v.ultima_data_pedido,
      CASE
        WHEN v.titulo_id IS NOT NULL THEN 'COM_PEDIDO'
        WHEN t.nf_entrada_id IS NOT NULL THEN 'COM_NF_SEM_PEDIDO'
        ELSE 'SEM_NF_E_SEM_PEDIDO'
      END AS status_vinculo_pedido,
      CASE
        WHEN v.titulo_id IS NULL THEN 'NAO_APLICAVEL'
        WHEN CARDINALITY(v.fornecedor_pedido_ids) > 0
          AND CARDINALITY(v.filial_pedido_ids) > 0
          AND (
            NOT (v.fornecedor_pedido_ids <@ ARRAY[COALESCE(t.parceiro_id, f.parceiro_id)]::TEXT[])
            AND NOT (v.filial_pedido_ids <@ ARRAY[f.filial_id]::TEXT[])
          ) THEN 'FORNECEDOR_E_FILIAL_DIVERGENTES'
        WHEN CARDINALITY(v.fornecedor_pedido_ids) > 0
          AND NOT (v.fornecedor_pedido_ids <@ ARRAY[COALESCE(t.parceiro_id, f.parceiro_id)]::TEXT[])
          AND CARDINALITY(v.fornecedor_pedido_raizes_cnpj) > 0
          AND v.fornecedor_pedido_raizes_cnpj <@ ARRAY[
            LEFT(
              REGEXP_REPLACE(COALESCE(forn.cgc_cnpj, cli.cgc_cnpj, ''), '[^0-9]', '', 'g'),
              8
            )
          ]::TEXT[]
          THEN 'MESMA_RAIZ_CNPJ_ESTABELECIMENTO_DIFERENTE'
        WHEN CARDINALITY(v.fornecedor_pedido_ids) > 0
          AND NOT (v.fornecedor_pedido_ids <@ ARRAY[COALESCE(t.parceiro_id, f.parceiro_id)]::TEXT[])
          THEN 'FORNECEDOR_DIVERGENTE'
        WHEN CARDINALITY(v.filial_pedido_ids) > 0
          AND NOT (v.filial_pedido_ids <@ ARRAY[f.filial_id]::TEXT[])
          THEN 'FILIAL_DIVERGENTE'
        ELSE 'OK'
      END AS conferencia_pedido,
      CASE
        WHEN v.titulo_id IS NULL THEN 'Sem pedido vinculado para conferir.'
        WHEN CARDINALITY(v.fornecedor_pedido_ids) > 0
          AND CARDINALITY(v.filial_pedido_ids) > 0
          AND (
            NOT (v.fornecedor_pedido_ids <@ ARRAY[COALESCE(t.parceiro_id, f.parceiro_id)]::TEXT[])
            AND NOT (v.filial_pedido_ids <@ ARRAY[f.filial_id]::TEXT[])
          )
          THEN 'Fornecedor e filial do pedido diferem do título financeiro.'
        WHEN CARDINALITY(v.fornecedor_pedido_ids) > 0
          AND NOT (v.fornecedor_pedido_ids <@ ARRAY[COALESCE(t.parceiro_id, f.parceiro_id)]::TEXT[])
          AND CARDINALITY(v.fornecedor_pedido_raizes_cnpj) > 0
          AND v.fornecedor_pedido_raizes_cnpj <@ ARRAY[
            LEFT(
              REGEXP_REPLACE(COALESCE(forn.cgc_cnpj, cli.cgc_cnpj, ''), '[^0-9]', '', 'g'),
              8
            )
          ]::TEXT[]
          THEN 'Fornecedor do pedido usa outro código/estabelecimento da mesma raiz de CNPJ.'
        WHEN CARDINALITY(v.fornecedor_pedido_ids) > 0
          AND NOT (v.fornecedor_pedido_ids <@ ARRAY[COALESCE(t.parceiro_id, f.parceiro_id)]::TEXT[])
          THEN 'Fornecedor do pedido difere do fornecedor do título financeiro.'
        WHEN CARDINALITY(v.filial_pedido_ids) > 0
          AND NOT (v.filial_pedido_ids <@ ARRAY[f.filial_id]::TEXT[])
          THEN 'Filial do pedido difere da filial do título financeiro.'
        ELSE 'Dados do pedido conferem com o título financeiro.'
      END AS divergencia_resumo,
      CASE
        WHEN v.titulo_id IS NULL THEN NULL
        WHEN (
          CARDINALITY(v.fornecedor_pedido_ids) > 0
          AND NOT (v.fornecedor_pedido_ids <@ ARRAY[COALESCE(t.parceiro_id, f.parceiro_id)]::TEXT[])
        ) OR (
          CARDINALITY(v.filial_pedido_ids) > 0
          AND NOT (v.filial_pedido_ids <@ ARRAY[f.filial_id]::TEXT[])
        )
        THEN CONCAT(
          'Título/NF: fornecedor ',
          COALESCE(t.parceiro_id, f.parceiro_id, '(não informado)'),
          ' - ', COALESCE(forn.razao_social, cli.razao_social, '(nome não encontrado)'),
          ' - CNPJ/CPF ', COALESCE(forn.cgc_cnpj, cli.cgc_cnpj, '(não informado)'),
          ' - filial ', COALESCE(f.filial_id, '(não informada)'),
          '. Pedido interno SiAGRI: ', COALESCE(v.pedidos_numeros, '(não informado)'),
          '; pedido do fornecedor: ', COALESCE(v.pedidos_fornecedor_numeros, '(não informado)'),
          '; fornecedor do pedido: ', COALESCE(v.fornecedores_pedido_ids, '(não informado)'),
          ' - ', COALESCE(v.fornecedores_pedido_nomes, '(nome não encontrado)'),
          ' - CNPJ/CPF ', COALESCE(v.fornecedores_pedido_cnpjs, '(não informado)'),
          ' - filial ', COALESCE(v.filiais_pedido_ids, '(não informada)'),
          '.'
        )
        ELSE NULL
      END AS divergencia_detalhe,
      t.status AS status_titulo,
      f._sync_at
    FROM raw.financeiro_cp f
    LEFT JOIN raw.financeiro_titulos t
      ON t.tipo = 'CP' AND t.titulo_id = f._dados->>'CAB_ID'
    LEFT JOIN pagamentos pg ON pg.parcela_id = f.id
    INNER JOIN raw.financeiro_saldos_local sl
      ON sl.tipo = 'CP' AND sl.parcela_id = f.id
    LEFT JOIN vinculos v ON v.titulo_id = f._dados->>'CAB_ID'
    LEFT JOIN raw.fornecedores forn ON forn.id = COALESCE(t.parceiro_id, f.parceiro_id)
    LEFT JOIN raw.clientes cli ON cli.id = COALESCE(t.parceiro_id, f.parceiro_id)
    LEFT JOIN raw.tipos_documento td ON td.id = COALESCE(t.tipo_documento, f.tipo_documento)
    LEFT JOIN raw.filiais fil ON fil.id = f.filial_id
    LEFT JOIN raw.fornecedores fil_forn ON fil_forn.id = fil._dados->>'COD1_TRA'
    LEFT JOIN raw.clientes fil_cli ON fil_cli.id = fil._dados->>'COD1_TRA'
  )
`;

function buildFilters({
  filialId,
  fornecedorId,
  tipoDocumento,
  emissaoDe,
  emissaoAte,
  vencimentoDe,
  vencimentoAte,
  pedidoId,
  produtoId,
  situacao,
  faixaVencimento,
  statusVinculo,
  conferenciaPedido,
  somenteEmAberto = true,
  incluirPagasDeAbertos = false,
}) {
  const conditions = [];
  const params = [];
  const add = (value, expression) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    conditions.push(expression.replace('?', `$${params.length}`));
  };

  add(filialId, 'x.filial_id = ?');
  add(fornecedorId, 'x.fornecedor_id = ?');
  add(tipoDocumento, 'x.tipo_documento = ?');
  add(emissaoDe, 'x.data_emissao >= ?');
  add(emissaoAte, 'x.data_emissao <= ?');
  add(vencimentoDe, 'x.data_vencimento >= ?');
  add(vencimentoAte, 'x.data_vencimento <= ?');
  add(pedidoId, '? = ANY(x.pedido_ids_array)');
  add(produtoId, '? = ANY(x.produto_ids_array)');
  add(situacao, 'x.situacao = ?');
  add(faixaVencimento, 'x.faixa_vencimento = ?');
  add(statusVinculo, 'x.status_vinculo_pedido = ?');
  add(conferenciaPedido, 'x.conferencia_pedido = ?');

  // Documentos de natureza crédito (ex.: ADIANTAMENTO A FORNECEDOR) reduzem o
  // saldo devido ao fornecedor — saldo_parcela já vem com sinal invertido
  // (negativo) de raw.financeiro_saldos_local. Mantemos essas linhas no
  // "em aberto" para netarem corretamente o saldo por fornecedor, igual ao CR.
  const emAberto = (alias) =>
    `((${alias}.natureza_tipo_documento = 'D' AND ${alias}.saldo_parcela > 0.01) OR ` +
    `(${alias}.natureza_tipo_documento = 'C' AND ${alias}.saldo_parcela < -0.01) OR ` +
    `(${alias}.natureza_tipo_documento IS NULL AND ${alias}.saldo_parcela > 0.01))`;

  if (incluirPagasDeAbertos) {
    // Para o relatório unificado "a pagar + pagas": além das parcelas em aberto,
    // inclui as já quitadas (saldo ≈ 0, com baixa) cujo título ainda tem alguma
    // parcela em aberto — assim a conciliação fecha por título sem despejar todo
    // o histórico de parcelas pagas.
    conditions.push(
      `(${emAberto('x')} OR (` +
        'ABS(x.saldo_parcela) <= 0.01 AND x.valor_baixado > 0 AND ' +
        `x.titulo_id IN (SELECT f2.titulo_id FROM fatos f2 WHERE ${emAberto('f2')})` +
      '))',
    );
  } else if (somenteEmAberto) {
    conditions.push(emAberto('x'));
  }

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
      `${CONTAS_PAGAR_BASE}
       SELECT * FROM fatos x
       ${where}
       ORDER BY x.data_vencimento, x.fornecedor_nome, x.titulo_id, x.parcela_nr
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `${CONTAS_PAGAR_BASE}
       SELECT COUNT(*)::INT AS total FROM fatos x ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function resumo(filters) {
  const { params, where } = buildFilters(filters);
  const filtrados = `${CONTAS_PAGAR_BASE}, filtrados AS (SELECT * FROM fatos x ${where})`;

  const [gruposRes, totaisRes] = await Promise.all([
    db.query(
      `${filtrados}
       SELECT
         filial_id,
         filial_nome,
         fornecedor_id,
         fornecedor_nome,
         fornecedor_cnpj_cpf,
         COUNT(*)::INT AS qtd_parcelas,
         COUNT(DISTINCT titulo_id)::INT AS qtd_titulos,
         SUM(valor_parcela) AS valor_parcelas,
         SUM(valor_baixado) AS valor_baixado,
         SUM(saldo_parcela) AS saldo,
         SUM(saldo_parcela) FILTER (
           WHERE saldo_parcela > 0.01 AND data_vencimento < CURRENT_DATE
         ) AS saldo_vencido,
         SUM(saldo_parcela) FILTER (
           WHERE saldo_parcela > 0.01
             AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
         ) AS saldo_proximos_7_dias,
         SUM(saldo_parcela) FILTER (
           WHERE saldo_parcela > 0.01
             AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
         ) AS saldo_proximos_30_dias,
         COUNT(*) FILTER (WHERE status_vinculo_pedido = 'COM_PEDIDO')::INT
           AS qtd_parcelas_com_pedido,
         COUNT(*) FILTER (WHERE status_vinculo_pedido <> 'COM_PEDIDO')::INT
           AS qtd_parcelas_sem_pedido,
         COUNT(*) FILTER (
           WHERE conferencia_pedido NOT IN ('OK', 'NAO_APLICAVEL')
         )::INT AS qtd_divergencias_pedido,
         MIN(data_vencimento) FILTER (WHERE saldo_parcela > 0.01) AS primeiro_vencimento,
         MAX(data_vencimento) FILTER (WHERE saldo_parcela > 0.01) AS ultimo_vencimento
       FROM filtrados
       GROUP BY filial_id, filial_nome, fornecedor_id, fornecedor_nome, fornecedor_cnpj_cpf
       ORDER BY saldo DESC NULLS LAST, fornecedor_nome`,
      params,
    ),
    db.query(
      `${filtrados}
       SELECT
         COUNT(*)::INT AS qtd_parcelas,
         COUNT(DISTINCT titulo_id)::INT AS qtd_titulos,
         COUNT(DISTINCT fornecedor_id)::INT AS qtd_fornecedores,
         SUM(valor_parcela) AS valor_parcelas,
         SUM(valor_baixado) AS valor_baixado,
         SUM(saldo_parcela) AS saldo,
         SUM(saldo_parcela) FILTER (
           WHERE saldo_parcela > 0.01 AND data_vencimento < CURRENT_DATE
         ) AS saldo_vencido,
         SUM(saldo_parcela) FILTER (
           WHERE saldo_parcela > 0.01
             AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
         ) AS saldo_proximos_7_dias,
         SUM(saldo_parcela) FILTER (
           WHERE saldo_parcela > 0.01
             AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
         ) AS saldo_proximos_30_dias,
         COUNT(*) FILTER (WHERE status_vinculo_pedido = 'COM_PEDIDO')::INT
           AS qtd_parcelas_com_pedido,
         COUNT(*) FILTER (WHERE status_vinculo_pedido <> 'COM_PEDIDO')::INT
           AS qtd_parcelas_sem_pedido,
         COUNT(*) FILTER (
           WHERE conferencia_pedido NOT IN ('OK', 'NAO_APLICAVEL')
         )::INT AS qtd_divergencias_pedido,
         COUNT(*) FILTER (WHERE fidc)::INT AS qtd_parcelas_fidc,
         SUM(saldo_parcela) FILTER (WHERE fidc) AS saldo_fidc
       FROM filtrados`,
      params,
    ),
  ]);

  return { data: gruposRes.rows, totalizadores: totaisRes.rows[0] };
}

module.exports = { listar, resumo };
