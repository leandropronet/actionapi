'use strict';
/**
 * Datasets executivos para CEO/CFO.
 *
 * Todos os cálculos usam somente dados já replicados no PostgreSQL. O Oracle
 * permanece restrito ao ETL em modo de leitura.
 */
const db = require('../db/postgres');

function periodFilters({ dataInicio, dataFim, filialId }, dateExpression, alias = '') {
  const conditions = [];
  const params = [];
  const column = alias ? `${alias}.${dateExpression}` : dateExpression;
  const add = (value, sql) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };
  add(dataInicio, `${column} >= ?`);
  add(dataFim, `${column} <= ?`);
  if (filialId) {
    params.push(filialId);
    conditions.push(`${alias ? `${alias}.` : ''}filial_id = $${params.length}`);
  }
  return {
    params,
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    conditions,
  };
}

function pagination(page, pageSize) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeSize = Math.min(Math.max(Number(pageSize) || 1000, 1), 10000);
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

async function faturamentoDetalhes({
  dataInicio, dataFim, filialId, clienteId, vendedorId, grupoId,
  paramId = '102', page, pageSize,
}) {
  const conditions = [
    `pod.param_id = $1`,
    `pod.funcao = 'A'`,
    `f._dados->>'SITU_NOT' = '5'`,
  ];
  const params = [paramId];
  const add = (value, expression) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    conditions.push(expression.replace('?', `$${params.length}`));
  };
  add(dataInicio, 'f.data_emissao >= ?');
  add(dataFim, 'f.data_emissao <= ?');
  add(filialId, 'f.filial_id = ?');
  add(clienteId, `f._dados->>'CODI_TRA' = ?`);
  add(vendedorId, `f._dados->>'COD1_PES' = ?`);
  add(grupoId, `p._dados->>'CODI_GPR' = ?`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const paging = pagination(page, pageSize);

  const base = `
    FROM raw.faturamento_itens i
    JOIN raw.faturamento f ON f.id = i.nf_id
    JOIN raw.param_oper_detalhe pod ON pod.operacao_id = f.operacao_id
    LEFT JOIN raw.clientes cli ON cli.id = f._dados->>'CODI_TRA'
    LEFT JOIN raw.vendedores vend ON vend.id = f._dados->>'COD1_PES'
    LEFT JOIN raw.produtos p ON p.id = i.produto_id
    LEFT JOIN raw.grupos g ON g.id = p._dados->>'CODI_GPR'
    LEFT JOIN raw.filiais fil ON fil.id = f.filial_id
  `;
  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         f.id AS nf_id,
         f.filial_id,
         fil._dados->>'IDEN_EMP' AS filial_identificacao,
         f.data_emissao,
         NULLIF(f._dados->>'DSAI_NOT', '')::DATE AS data_saida,
         f._dados->>'NOTA_NOT' AS numero_nf,
         f._dados->>'SERI_NOT' AS serie,
         f.operacao_id,
         f._dados->>'DESC_TOP' AS operacao_descricao,
         f._dados->>'CODI_TRA' AS cliente_id,
         cli.razao_social AS cliente_nome,
         cli.cgc_cnpj AS cliente_cnpj_cpf,
         f._dados->>'COD1_PES' AS vendedor_id,
         vend._dados->>'NOME_PES' AS vendedor_nome,
         (f._dados->>'TOTA_NOT')::NUMERIC AS valor_nf,
         i.id AS item_id,
         i.produto_id,
         p.descricao AS produto_descricao,
         p._dados->>'UNID_PSV' AS unidade,
         p._dados->>'CODI_GPR' AS grupo_id,
         g.descricao AS grupo_descricao,
         (i._dados->>'QTDE_INO')::NUMERIC AS quantidade,
         (i._dados->>'VLOR_INO')::NUMERIC AS valor_unitario,
         (i._dados->>'QTDE_INO')::NUMERIC
           * (i._dados->>'VLOR_INO')::NUMERIC AS valor_item
       ${base}
       ${where}
       ORDER BY f.data_emissao, f.id, (i._dados->>'ITEM_INO')::INT NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, paging.pageSize, paging.offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total ${base} ${where}`, params),
  ]);
  return {
    data: dataRes.rows,
    total: countRes.rows[0].total,
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

async function faturamentoResumo({
  dataInicio, dataFim, filialId, paramId = '102',
}) {
  const params = [paramId];
  const notaConditions = [
    `pod.param_id = $1`,
    `f._dados->>'SITU_NOT' = '5'`,
  ];
  const entradaConditions = [`pod.param_id = $1`];
  const addShared = (value, notaSql, entradaSql) => {
    if (!value) return;
    params.push(value);
    notaConditions.push(notaSql.replace('?', `$${params.length}`));
    entradaConditions.push(entradaSql.replace('?', `$${params.length}`));
  };
  addShared(dataInicio, 'f.data_emissao >= ?', 'n.data_emissao >= ?');
  addShared(dataFim, 'f.data_emissao <= ?', 'n.data_emissao <= ?');
  addShared(filialId, 'f.filial_id = ?', 'n.filial_id = ?');

  const componentBase = `
    WITH componentes AS (
      SELECT
        DATE_TRUNC('month', f.data_emissao)::DATE AS periodo,
        f.filial_id,
        'NOTA'::TEXT AS origem,
        pod.funcao,
        COUNT(DISTINCT f.id)::INT AS quantidade_documentos,
        SUM((f._dados->>'TOTA_NOT')::NUMERIC) AS valor
      FROM raw.faturamento f
      JOIN raw.param_oper_detalhe pod ON pod.operacao_id = f.operacao_id
      WHERE ${notaConditions.join(' AND ')}
      GROUP BY periodo, f.filial_id, pod.funcao

      UNION ALL

      SELECT
        DATE_TRUNC('month', n.data_emissao)::DATE AS periodo,
        n.filial_id,
        'NFENTRA'::TEXT AS origem,
        pod.funcao,
        COUNT(DISTINCT n.id)::INT AS quantidade_documentos,
        SUM(
          COALESCE((i._dados->>'QUAN_INF')::NUMERIC, 0)
          * COALESCE((i._dados->>'VLIQ_INF')::NUMERIC, 0)
        ) AS valor
      FROM raw.nfe_entrada n
      JOIN raw.nfe_entrada_itens i ON i.nfe_entrada_id = n.id
      JOIN raw.param_oper_detalhe pod ON pod.operacao_id = i.operacao_id
      WHERE ${entradaConditions.join(' AND ')}
      GROUP BY periodo, n.filial_id, pod.funcao
    )
  `;

  const detailConditions = [
    `pod.param_id = $1`,
    `pod.funcao = 'A'`,
    `f._dados->>'SITU_NOT' = '5'`,
  ];
  const detailParams = [paramId];
  const addDetail = (value, expression) => {
    if (!value) return;
    detailParams.push(value);
    detailConditions.push(expression.replace('?', `$${detailParams.length}`));
  };
  addDetail(dataInicio, 'f.data_emissao >= ?');
  addDetail(dataFim, 'f.data_emissao <= ?');
  addDetail(filialId, 'f.filial_id = ?');
  const detailWhere = `WHERE ${detailConditions.join(' AND ')}`;

  const [monthlyRes, totalsRes, statsRes, filialRes, clientsRes, sellersRes, groupsRes] =
    await Promise.all([
      db.query(
        `${componentBase}
         SELECT
           periodo,
           SUM(CASE WHEN funcao = 'A' THEN valor ELSE -valor END) AS faturamento_liquido,
           SUM(valor) FILTER (WHERE origem = 'NOTA' AND funcao = 'A') AS vendas_brutas,
           SUM(valor) FILTER (WHERE origem = 'NOTA' AND funcao = 'S') AS deducoes_saida,
           SUM(valor) FILTER (WHERE origem = 'NFENTRA' AND funcao = 'S') AS devolucoes,
           SUM(quantidade_documentos) AS documentos
         FROM componentes
         GROUP BY periodo
         ORDER BY periodo`,
        params,
      ),
      db.query(
        `SELECT
           COUNT(DISTINCT f.id)::INT AS notas_venda,
           COUNT(DISTINCT f._dados->>'CODI_TRA')::INT AS clientes_ativos,
           COUNT(DISTINCT f._dados->>'COD1_PES')::INT AS vendedores_ativos,
           SUM((f._dados->>'TOTA_NOT')::NUMERIC) AS valor_notas_saida
         FROM raw.faturamento f
         JOIN raw.param_oper_detalhe pod ON pod.operacao_id = f.operacao_id
         ${detailWhere}`,
        detailParams,
      ),
      db.query(
        `${componentBase}
         SELECT
           SUM(CASE WHEN funcao = 'A' THEN valor ELSE -valor END) AS faturamento_liquido,
           SUM(valor) FILTER (WHERE origem = 'NOTA' AND funcao = 'A') AS vendas_brutas,
           SUM(valor) FILTER (WHERE origem = 'NOTA' AND funcao = 'S') AS deducoes_saida,
           SUM(valor) FILTER (WHERE origem = 'NFENTRA' AND funcao = 'S') AS devolucoes,
           SUM(quantidade_documentos) AS documentos
         FROM componentes`,
        params,
      ),
      db.query(
        `${componentBase}
         SELECT
           c.filial_id,
           fil._dados->>'IDEN_EMP' AS filial_identificacao,
           SUM(CASE WHEN c.funcao = 'A' THEN c.valor ELSE -c.valor END)
             AS faturamento_liquido,
           SUM(c.valor) FILTER (WHERE c.origem = 'NOTA' AND c.funcao = 'A')
             AS vendas_brutas,
           SUM(c.valor) FILTER (WHERE c.origem = 'NFENTRA' AND c.funcao = 'S')
             AS devolucoes
         FROM componentes c
         LEFT JOIN raw.filiais fil ON fil.id = c.filial_id
         GROUP BY c.filial_id, fil._dados->>'IDEN_EMP'
         ORDER BY faturamento_liquido DESC NULLS LAST`,
        params,
      ),
      db.query(
        `SELECT
           f._dados->>'CODI_TRA' AS cliente_id,
           cli.razao_social AS cliente_nome,
           COUNT(DISTINCT f.id)::INT AS quantidade_nf,
           SUM((f._dados->>'TOTA_NOT')::NUMERIC) AS vendas_brutas
         FROM raw.faturamento f
         JOIN raw.param_oper_detalhe pod ON pod.operacao_id = f.operacao_id
         LEFT JOIN raw.clientes cli ON cli.id = f._dados->>'CODI_TRA'
         ${detailWhere}
         GROUP BY f._dados->>'CODI_TRA', cli.razao_social
         ORDER BY vendas_brutas DESC NULLS LAST
         LIMIT 100`,
        detailParams,
      ),
      db.query(
        `SELECT
           f._dados->>'COD1_PES' AS vendedor_id,
           vend._dados->>'NOME_PES' AS vendedor_nome,
           COUNT(DISTINCT f.id)::INT AS quantidade_nf,
           SUM((f._dados->>'TOTA_NOT')::NUMERIC) AS vendas_brutas
         FROM raw.faturamento f
         JOIN raw.param_oper_detalhe pod ON pod.operacao_id = f.operacao_id
         LEFT JOIN raw.vendedores vend ON vend.id = f._dados->>'COD1_PES'
         ${detailWhere}
         GROUP BY f._dados->>'COD1_PES', vend._dados->>'NOME_PES'
         ORDER BY vendas_brutas DESC NULLS LAST`,
        detailParams,
      ),
      db.query(
        `SELECT
           p._dados->>'CODI_GPR' AS grupo_id,
           g.descricao AS grupo_descricao,
           COUNT(DISTINCT f.id)::INT AS quantidade_nf,
           SUM((i._dados->>'QTDE_INO')::NUMERIC) AS quantidade,
           SUM(
             (i._dados->>'QTDE_INO')::NUMERIC
             * (i._dados->>'VLOR_INO')::NUMERIC
           ) AS valor_itens
         FROM raw.faturamento_itens i
         JOIN raw.faturamento f ON f.id = i.nf_id
         JOIN raw.param_oper_detalhe pod ON pod.operacao_id = f.operacao_id
         LEFT JOIN raw.produtos p ON p.id = i.produto_id
         LEFT JOIN raw.grupos g ON g.id = p._dados->>'CODI_GPR'
         ${detailWhere}
         GROUP BY p._dados->>'CODI_GPR', g.descricao
         ORDER BY valor_itens DESC NULLS LAST`,
        detailParams,
      ),
    ]);

  const totals = totalsRes.rows[0] || {};
  Object.assign(totals, statsRes.rows[0] || {});
  const clients = clientsRes.rows;
  const sellers = sellersRes.rows;
  totals.ticket_medio = Number(totals.notas_venda || 0)
    ? Number(totals.faturamento_liquido || 0) / Number(totals.notas_venda)
    : 0;
  return {
    periodo: { dataInicio, dataFim },
    totalizadores: totals,
    evolucao_mensal: monthlyRes.rows,
    por_filial: filialRes.rows,
    por_cliente: clients,
    por_vendedor: sellers,
    por_grupo: groupsRes.rows,
  };
}

function movimentoConfig(tipo) {
  if (tipo === 'recebimentos') {
    return {
      table: 'raw.recebimentos',
      date: 'data_pagamento',
      partnerColumn: 'cliente_id',
      partnerAlias: 'cliente',
      partnerJoin: 'raw.clientes',
      detailJoin: `
        LEFT JOIN raw.duplicatas d ON d.id = m.parcela_id
        LEFT JOIN raw.financeiro_titulos t
          ON t.tipo = 'CR' AND t.titulo_id = d.nf_id
      `,
      document: 't.numero_documento',
      title: 'd.nf_id',
      issueDate: 'd.data_emissao',
      dueDate: 'd.data_vencimento',
    };
  }
  return {
    table: 'raw.pagamentos',
    date: 'data_pagamento',
    partnerColumn: 'COALESCE(cp.parceiro_id, t.parceiro_id)',
    partnerAlias: 'fornecedor',
    partnerJoin: 'raw.fornecedores',
    detailJoin: `
      LEFT JOIN raw.financeiro_cp cp ON cp.id = m.parcela_id
      LEFT JOIN raw.financeiro_titulos t
        ON t.tipo = 'CP' AND t.titulo_id = cp._dados->>'CAB_ID'
    `,
    document: 't.numero_documento',
    title: `COALESCE(t.titulo_id, cp._dados->>'CAB_ID')`,
    issueDate: 'cp.data_emissao',
    dueDate: 'cp.data_vencimento',
  };
}

async function movimentosDetalhes(tipo, {
  dataInicio, dataFim, filialId, parceiroId, status, pontualidade, page, pageSize,
}) {
  const cfg = movimentoConfig(tipo);
  const conditions = [];
  const params = [];
  const add = (value, expression) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    conditions.push(expression.replace('?', `$${params.length}`));
  };
  add(dataInicio, `m.${cfg.date} >= ?`);
  add(dataFim, `m.${cfg.date} <= ?`);
  add(filialId, 'm.filial_id = ?');
  add(parceiroId, `${cfg.partnerColumn} = ?`);
  add(status, 'm.status = ?');
  if (pontualidade === 'ATRASADO') {
    conditions.push(`m.status = 'N' AND ${cfg.dueDate} IS NOT NULL
      AND m.${cfg.date} > ${cfg.dueDate}`);
  } else if (pontualidade === 'ANTECIPADO') {
    conditions.push(`m.status = 'N' AND ${cfg.dueDate} IS NOT NULL
      AND m.${cfg.date} < ${cfg.dueDate}`);
  } else if (pontualidade === 'NO_VENCIMENTO') {
    conditions.push(`m.status = 'N' AND ${cfg.dueDate} IS NOT NULL
      AND m.${cfg.date} = ${cfg.dueDate}`);
  } else if (pontualidade === 'SEM_VENCIMENTO') {
    conditions.push(`m.status = 'N' AND ${cfg.dueDate} IS NULL`);
  } else if (pontualidade === 'ESTORNADO') {
    conditions.push(`m.status = 'E'`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const paging = pagination(page, pageSize);
  const base = `
    FROM ${cfg.table} m
    ${cfg.detailJoin}
    LEFT JOIN ${cfg.partnerJoin} p ON p.id = ${cfg.partnerColumn}
    LEFT JOIN raw.clientes pc ON pc.id = ${cfg.partnerColumn}
    LEFT JOIN raw.filiais fil ON fil.id = m.filial_id
  `;
  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         m.id AS movimento_id,
         m.parcela_id,
         ${cfg.title} AS titulo_id,
         ${cfg.document} AS numero_documento,
         m.filial_id,
         fil._dados->>'IDEN_EMP' AS filial_identificacao,
         ${cfg.partnerColumn} AS ${cfg.partnerAlias}_id,
         COALESCE(p.razao_social, pc.razao_social) AS ${cfg.partnerAlias}_nome,
         COALESCE(p.cgc_cnpj, pc.cgc_cnpj) AS ${cfg.partnerAlias}_cnpj_cpf,
         ${cfg.issueDate} AS data_emissao,
         ${cfg.dueDate} AS data_vencimento,
         m.${cfg.date} AS data_movimento,
         m.${cfg.date} - ${cfg.dueDate} AS dias_em_relacao_vencimento,
         CASE
           WHEN m.status = 'E' THEN 'ESTORNADO'
           WHEN ${cfg.dueDate} IS NULL THEN 'SEM_VENCIMENTO'
           WHEN m.${cfg.date} < ${cfg.dueDate} THEN 'ANTECIPADO'
           WHEN m.${cfg.date} = ${cfg.dueDate} THEN 'NO_VENCIMENTO'
           ELSE 'ATRASADO'
         END AS pontualidade,
         m.valor,
         m.multa,
         m.juros,
         m.desconto,
         m.acrescimo,
         COALESCE(m.valor_complementar, 0) AS valor_complementar,
         m.valor + m.multa + m.juros + m.acrescimo - m.desconto
           AS valor_liquido,
         m.status,
         CASE m.status WHEN 'N' THEN 'NORMAL' WHEN 'E' THEN 'ESTORNADO'
           ELSE 'OUTRO' END AS situacao,
         m._sync_at
       ${base}
       ${where}
       ORDER BY m.${cfg.date}, m.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, paging.pageSize, paging.offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total ${base} ${where}`, params),
  ]);
  return {
    data: dataRes.rows,
    total: countRes.rows[0].total,
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

async function movimentosResumo(tipo, { dataInicio, dataFim, filialId }) {
  const cfg = movimentoConfig(tipo);
  const conditions = [];
  const params = [];
  const add = (value, expression) => {
    if (!value) return;
    params.push(value);
    conditions.push(expression.replace('?', `$${params.length}`));
  };
  add(dataInicio, `m.${cfg.date} >= ?`);
  add(dataFim, `m.${cfg.date} <= ?`);
  add(filialId, 'm.filial_id = ?');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const base = `
    FROM ${cfg.table} m
    ${cfg.detailJoin}
    LEFT JOIN ${cfg.partnerJoin} p ON p.id = ${cfg.partnerColumn}
    LEFT JOIN raw.clientes pc ON pc.id = ${cfg.partnerColumn}
    LEFT JOIN raw.filiais fil ON fil.id = m.filial_id
  `;
  const aggregates = `
    COUNT(*)::INT AS quantidade_movimentos,
    COUNT(*) FILTER (WHERE m.status = 'N')::INT AS quantidade_normais,
    COUNT(*) FILTER (WHERE m.status = 'E')::INT AS quantidade_estornados,
    SUM(m.valor) FILTER (WHERE m.status = 'N') AS valor_principal,
    SUM(m.multa) FILTER (WHERE m.status = 'N') AS multa,
    SUM(m.juros) FILTER (WHERE m.status = 'N') AS juros,
    SUM(m.desconto) FILTER (WHERE m.status = 'N') AS desconto,
    SUM(m.acrescimo) FILTER (WHERE m.status = 'N') AS acrescimo,
    SUM(m.valor + m.multa + m.juros + m.acrescimo - m.desconto)
      FILTER (WHERE m.status = 'N') AS valor_liquido,
    SUM(m.valor) FILTER (WHERE m.status = 'E') AS valor_estornado,
    COUNT(*) FILTER (
      WHERE m.status = 'N' AND ${cfg.dueDate} IS NOT NULL
        AND m.${cfg.date} <= ${cfg.dueDate}
    )::INT AS quantidade_no_prazo,
    COUNT(*) FILTER (
      WHERE m.status = 'N' AND ${cfg.dueDate} IS NOT NULL
        AND m.${cfg.date} > ${cfg.dueDate}
    )::INT AS quantidade_em_atraso,
    COUNT(*) FILTER (
      WHERE m.status = 'N' AND ${cfg.dueDate} IS NULL
    )::INT AS quantidade_sem_vencimento,
    SUM(m.valor + m.multa + m.juros + m.acrescimo - m.desconto)
      FILTER (
        WHERE m.status = 'N' AND ${cfg.dueDate} IS NOT NULL
          AND m.${cfg.date} > ${cfg.dueDate}
      ) AS valor_liquido_em_atraso,
    AVG(m.${cfg.date} - ${cfg.dueDate})
      FILTER (
        WHERE m.status = 'N' AND ${cfg.dueDate} IS NOT NULL
          AND m.${cfg.date} > ${cfg.dueDate}
      ) AS media_dias_atraso
  `;
  const [totalsRes, monthlyRes, filialRes, partnerRes] = await Promise.all([
    db.query(`SELECT ${aggregates} ${base} ${where}`, params),
    db.query(
      `SELECT DATE_TRUNC('month', m.${cfg.date})::DATE AS periodo,
         ${aggregates}
       ${base} ${where}
       GROUP BY periodo ORDER BY periodo`,
      params,
    ),
    db.query(
      `SELECT m.filial_id, fil._dados->>'IDEN_EMP' AS filial_identificacao,
         ${aggregates}
       ${base} ${where}
       GROUP BY m.filial_id, fil._dados->>'IDEN_EMP'
       ORDER BY valor_liquido DESC NULLS LAST`,
      params,
    ),
    db.query(
      `SELECT ${cfg.partnerColumn} AS parceiro_id,
         COALESCE(p.razao_social, pc.razao_social) AS parceiro_nome,
         COALESCE(p.cgc_cnpj, pc.cgc_cnpj) AS parceiro_cnpj_cpf,
         ${aggregates}
       ${base} ${where}
       GROUP BY ${cfg.partnerColumn}, COALESCE(p.razao_social, pc.razao_social),
         COALESCE(p.cgc_cnpj, pc.cgc_cnpj)
       ORDER BY valor_liquido DESC NULLS LAST
       LIMIT 200`,
      params,
    ),
  ]);
  const totals = totalsRes.rows[0] || {};
  totals.ticket_medio = Number(totals.quantidade_normais || 0)
    ? Number(totals.valor_liquido || 0) / Number(totals.quantidade_normais)
    : 0;
  totals.indice_pontualidade = Number(totals.quantidade_normais || 0)
    ? Number(totals.quantidade_no_prazo || 0) / Number(totals.quantidade_normais)
    : 0;
  return {
    periodo: { dataInicio, dataFim },
    totalizadores: totals,
    evolucao_mensal: monthlyRes.rows,
    por_filial: filialRes.rows,
    por_parceiro: partnerRes.rows,
  };
}

async function contabilidadeResumo({ dataInicio, dataFim, filialId }) {
  const conditions = [];
  const params = [];
  const add = (value, expression) => {
    if (!value) return;
    params.push(value);
    conditions.push(expression.replace('?', `$${params.length}`));
  };
  add(dataInicio, 'c.data_lancamento >= ?');
  add(dataFim, 'c.data_lancamento <= ?');
  add(filialId, 'c.filial_id = ?');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const aggregates = `
    COUNT(DISTINCT c._dados->>'SEQU_CLC')::INT AS quantidade_lancamentos,
    COUNT(*)::INT AS quantidade_partidas,
    SUM((c._dados->>'VLOR_LCT')::NUMERIC)
      FILTER (WHERE c._dados->>'TIPO_LCT' = 'D') AS debitos,
    SUM((c._dados->>'VLOR_LCT')::NUMERIC)
      FILTER (WHERE c._dados->>'TIPO_LCT' = 'C') AS creditos,
    COALESCE(SUM((c._dados->>'VLOR_LCT')::NUMERIC)
      FILTER (WHERE c._dados->>'TIPO_LCT' = 'D'), 0)
    - COALESCE(SUM((c._dados->>'VLOR_LCT')::NUMERIC)
      FILTER (WHERE c._dados->>'TIPO_LCT' = 'C'), 0) AS diferenca_dc
  `;
  const [totalsRes, monthlyRes, groupsRes, accountsRes] = await Promise.all([
    db.query(`SELECT ${aggregates} FROM raw.contabil c ${where}`, params),
    db.query(
      `SELECT DATE_TRUNC('month', c.data_lancamento)::DATE AS periodo,
         ${aggregates}
       FROM raw.contabil c ${where}
       GROUP BY periodo ORDER BY periodo`,
      params,
    ),
    db.query(
      `SELECT
         SUBSTRING(c._dados->>'CODI_CPC', 1, 1) AS grupo,
         CASE SUBSTRING(c._dados->>'CODI_CPC', 1, 1)
           WHEN '1' THEN 'Ativo'
           WHEN '2' THEN 'Passivo'
           WHEN '3' THEN 'Receitas'
           WHEN '4' THEN 'Custos e Despesas'
           WHEN '6' THEN 'Compensações'
           WHEN '9' THEN 'Movimentos Transitórios'
           ELSE 'Outros'
         END AS grupo_descricao,
         ${aggregates}
       FROM raw.contabil c ${where}
       GROUP BY SUBSTRING(c._dados->>'CODI_CPC', 1, 1)
       ORDER BY grupo`,
      params,
    ),
    db.query(
      `SELECT
         c._dados->>'CODI_PLC' AS plano_contas,
         c._dados->>'CODI_CPC' AS conta,
         cp.descricao AS conta_descricao,
         ${aggregates}
       FROM raw.contabil c
       LEFT JOIN raw.contaspl cp
         ON cp.plano_id = c._dados->>'CODI_PLC'
        AND cp.conta_id = c._dados->>'CODI_CPC'
       ${where}
       GROUP BY c._dados->>'CODI_PLC', c._dados->>'CODI_CPC', cp.descricao
       ORDER BY GREATEST(
         ABS(COALESCE(SUM((c._dados->>'VLOR_LCT')::NUMERIC)
           FILTER (WHERE c._dados->>'TIPO_LCT' = 'D'), 0)),
         ABS(COALESCE(SUM((c._dados->>'VLOR_LCT')::NUMERIC)
           FILTER (WHERE c._dados->>'TIPO_LCT' = 'C'), 0))
       ) DESC
       LIMIT 500`,
      params,
    ),
  ]);
  return {
    periodo: { dataInicio, dataFim },
    totalizadores: totalsRes.rows[0],
    evolucao_mensal: monthlyRes.rows,
    por_grupo: groupsRes.rows,
    por_conta: accountsRes.rows,
  };
}

async function contabilidadeSintetico({ dataInicio, dataFim, filialId }) {
  const conditions = [];
  const params = [];
  const add = (value, expression) => {
    if (!value) return;
    params.push(value);
    conditions.push(expression.replace('?', `$${params.length}`));
  };
  add(dataInicio, 'c.data_lancamento >= ?');
  add(dataFim, 'c.data_lancamento <= ?');
  add(filialId, 'c.filial_id = ?');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query(
    `WITH analitico AS (
       SELECT
         c._dados->>'CODI_PLC' AS plano_id,
         c._dados->>'CODI_CPC' AS conta_id,
         SUM((c._dados->>'VLOR_LCT')::NUMERIC)
           FILTER (WHERE c._dados->>'TIPO_LCT' = 'D') AS debitos,
         SUM((c._dados->>'VLOR_LCT')::NUMERIC)
           FILTER (WHERE c._dados->>'TIPO_LCT' = 'C') AS creditos
       FROM raw.contabil c
       ${where}
       GROUP BY 1, 2
     )
     SELECT
       cp.conta_id,
       cp.descricao,
       LENGTH(cp.conta_id) AS tamanho_codigo,
       COALESCE(SUM(a.debitos), 0) AS debitos,
       COALESCE(SUM(a.creditos), 0) AS creditos,
       COALESCE(SUM(a.debitos), 0) - COALESCE(SUM(a.creditos), 0) AS saldo,
       (LENGTH(cp.conta_id) = 10) AS analitica
     FROM raw.contaspl cp
     LEFT JOIN analitico a
       ON a.plano_id = cp.plano_id AND a.conta_id LIKE cp.conta_id || '%'
     WHERE cp.plano_id = '1000002'
     GROUP BY cp.conta_id, cp.descricao
     ORDER BY cp.conta_id`,
    params,
  );
  return { periodo: { dataInicio, dataFim }, contas: result.rows };
}

async function visao360({ dataInicio, dataFim, filialId }) {
  const [fat, rec, pag, cont] = await Promise.all([
    faturamentoResumo({ dataInicio, dataFim, filialId }),
    movimentosResumo('recebimentos', { dataInicio, dataFim, filialId }),
    movimentosResumo('pagamentos', { dataInicio, dataFim, filialId }),
    contabilidadeResumo({ dataInicio, dataFim, filialId }),
  ]);
  const balanceParams = [];
  const balanceConditions = [];
  if (filialId) {
    balanceParams.push(filialId);
    balanceConditions.push(`filial_id = $${balanceParams.length}`);
  }
  const balanceWhere = balanceConditions.length
    ? `AND ${balanceConditions.join(' AND ')}`
    : '';
  const balances = await db.query(
    `SELECT
       'CR'::TEXT AS tipo,
       SUM(l.saldo_convertido_atual) AS saldo_aberto,
       COUNT(*)::INT AS parcelas_abertas
     FROM raw.duplicatas_saldo s
     JOIN raw.financeiro_saldos_local l
       ON l.tipo = 'CR' AND l.parcela_id = s.id
     WHERE 1=1 ${balanceWhere.replaceAll('filial_id', 's.filial_id')}

     UNION ALL

     SELECT
       'CP'::TEXT AS tipo,
       SUM(saldo_convertido_atual) FILTER (WHERE cp_aberta) AS saldo_aberto,
       COUNT(*) FILTER (WHERE cp_aberta)::INT AS parcelas_abertas
     FROM (
       SELECT *,
         (
           (natureza_tipo_documento = 'D' AND saldo_ajustado > 0.01)
           OR (natureza_tipo_documento = 'C' AND saldo_ajustado < -0.01)
           OR (natureza_tipo_documento IS NULL AND saldo_ajustado > 0.01)
         ) AS cp_aberta
       FROM raw.financeiro_saldos_local
       WHERE tipo = 'CP'
     ) cp
     WHERE 1=1 ${balanceWhere}`,
    balanceParams,
  );
  const byType = Object.fromEntries(balances.rows.map((row) => [row.tipo, row]));
  const received = Number(rec.totalizadores.valor_liquido || 0);
  const paid = Number(pag.totalizadores.valor_liquido || 0);
  return {
    periodo: { dataInicio, dataFim },
    indicadores: {
      faturamento_liquido: Number(fat.totalizadores.faturamento_liquido || 0),
      vendas_brutas: Number(fat.totalizadores.vendas_brutas || 0),
      devolucoes: Number(fat.totalizadores.devolucoes || 0),
      valor_recebido: received,
      valor_pago: paid,
      geracao_caixa_financeira: received - paid,
      contas_receber_aberto: Number(byType.CR?.saldo_aberto || 0),
      contas_pagar_aberto: Number(byType.CP?.saldo_aberto || 0),
      capital_giro_liquido_financeiro:
        Number(byType.CR?.saldo_aberto || 0) - Number(byType.CP?.saldo_aberto || 0),
      parcelas_receber_abertas: Number(byType.CR?.parcelas_abertas || 0),
      parcelas_pagar_abertas: Number(byType.CP?.parcelas_abertas || 0),
      debitos_contabeis: Number(cont.totalizadores.debitos || 0),
      creditos_contabeis: Number(cont.totalizadores.creditos || 0),
      diferenca_debito_credito: Number(cont.totalizadores.diferenca_dc || 0),
    },
    faturamento: fat,
    recebimentos: rec,
    pagamentos: pag,
    contabilidade: cont,
  };
}

module.exports = {
  faturamentoDetalhes,
  faturamentoResumo,
  movimentosDetalhes,
  movimentosResumo,
  contabilidadeResumo,
  contabilidadeSintetico,
  visao360,
};
