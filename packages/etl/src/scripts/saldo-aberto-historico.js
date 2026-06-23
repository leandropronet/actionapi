'use strict';
/**
 * Reproduz o saldo em aberto de Contas a Receber/Pagar EM UMA DATA-BASE
 * ARBITRÁRIA (passada ou futura), sem chamar o Oracle.
 *
 * Mesma fórmula validada em jobs/financeiro_saldos_local.js (zero
 * divergências contra VALOR_ABERTO_RECEBER_DATA/VALOR_ABERTO_PAGAR_DATA em
 * 2026-06-20), apenas substituindo CURRENT_DATE por uma data parametrizada.
 * Isso funciona porque o saldo em qualquer data passada só depende de fatos
 * já ocorridos até aquela data (baixas, agrupamentos, cotações) — todos
 * armazenados com suas datas originais nas tabelas raw.*.
 *
 * Uso:
 *   node src/scripts/saldo-aberto-historico.js --tipo CR --data-base 2026-03-20
 *   node src/scripts/saldo-aberto-historico.js --tipo CP --data-base 2026-03-20
 *   node src/scripts/saldo-aberto-historico.js --tipo AMBOS --data-base 2026-03-20 --saida arquivo.json
 *   node src/scripts/saldo-aberto-historico.js --tipo CP --data-base 2026-03-20 --incluir-baixadas
 *
 * --incluir-baixadas (CP e CR): além das parcelas em aberto, retorna também as
 * totalmente quitadas que tiveram baixa até a data-base, restritas aos títulos
 * que ainda têm saldo (para as abas Pagas/Recebidas e a conciliação). Os
 * totalizadores continuam refletindo apenas o em aberto.
 *
 * Sem --saida, imprime o JSON no stdout. Oracle não é acessado; PostgreSQL é
 * acessado exclusivamente com SELECT.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const pg = require('../db/postgres');

function parseArgs(argv) {
  const args = {
    tipo: 'AMBOS',
    dataBase: new Date().toISOString().slice(0, 10),
    incluirBaixadas: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--tipo') args.tipo = argv[++i];
    else if (value === '--data-base') args.dataBase = argv[++i];
    else if (value === '--saida') args.saida = argv[++i];
    else if (value === '--incluir-baixadas') args.incluirBaixadas = true;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dataBase)) {
    throw new Error(`--data-base inválida: ${args.dataBase} (use AAAA-MM-DD)`);
  }
  args.tipo = args.tipo.toUpperCase();
  if (!['CR', 'CP', 'AMBOS'].includes(args.tipo)) {
    throw new Error(`--tipo inválido: ${args.tipo} (use CR, CP ou AMBOS)`);
  }
  return args;
}

const COTACAO_NA_DATA = `
  COALESCE(
    (
      SELECT iv.valor FROM raw.indexador_valores iv
      WHERE iv.filial_id = base_indexador_filial_id AND iv.indexador_id = base_indexador_id
        AND iv.data_valor <= $1::date AND iv.valor > 0
      ORDER BY iv.data_valor DESC LIMIT 1
    ),
    (
      SELECT iv.valor FROM raw.indexador_valores iv
      WHERE iv.filial_id = base_indexador_filial_id AND iv.indexador_id = base_indexador_id
        AND iv.data_valor >= $1::date AND iv.valor > 0
      ORDER BY iv.data_valor LIMIT 1
    ),
    1
  )
`;

async function consultarCR(dataBase, incluirBaixadas = false) {
  // Corpo idêntico para "em aberto" e "recebidas"; só muda o WHERE.
  const queryBody = (whereClause) => `
    WITH baixas AS (
      SELECT
        d.id AS parcela_id,
        SUM(CASE WHEN d.indexador_id IS NOT NULL THEN b.valor / iv.valor ELSE b.valor END) AS valor_baixado,
        SUM(b.valor) AS valor_baixado_face,
        COUNT(*)::INT AS qtd_baixas,
        MIN(b.data_pagamento) AS primeira_baixa,
        MAX(b.data_pagamento) AS ultima_baixa_normal,
        SUM(b.multa) AS multa, SUM(b.juros) AS juros,
        SUM(b.desconto) AS desconto, SUM(b.acrescimo) AS acrescimo,
        SUM(COALESCE(b.valor_complementar, 0)) AS valor_complementar
      FROM raw.duplicatas d
      JOIN raw.recebimentos b
        ON b.parcela_id = d.id AND b.status = 'N' AND b.data_pagamento <= $1::date
      LEFT JOIN raw.indexador_valores iv
        ON iv.filial_id = d.indexador_filial_id AND iv.indexador_id = d.indexador_id
       AND iv.data_valor = b.data_indexador
      GROUP BY d.id
    ),
    baixas_todas AS (
      SELECT parcela_id, MAX(data_pagamento) AS ultima_baixa
      FROM raw.recebimentos WHERE data_pagamento <= $1::date
      GROUP BY parcela_id
    ),
    agrupamentos AS (
      SELECT parcela_id, SUM(COALESCE(valor, 0)) AS valor_agrupado
      FROM raw.receber_agrupamentos WHERE data_titulo_agrupador <= $1::date
      GROUP BY parcela_id
    ),
    base AS (
      SELECT
        d.id AS parcela_id, d.nf_id AS titulo_id, d.filial_id,
        d._dados->>'CODI_TRA' AS cliente_id,
        d.tipo_documento, td.tipo AS natureza_tipo_documento, td.descricao AS tipo_documento_descricao,
        COALESCE(NULLIF(d._dados->>'NUME_CBR', ''), ft.numero_documento,
          nf._dados->>'NOTA_NOT') AS numero_documento,
        COALESCE(NULLIF(d._dados->>'SERI_CBR', ''), ft.serie_documento,
          nf._dados->>'SERI_NOT') AS serie_documento,
        COALESCE(NULLIF(d._dados->>'COD1_PES', ''),
          NULLIF(nf._dados->>'COD1_PES', '')) AS vendedor_id,
        vend._dados->>'NOME_PES' AS vendedor_nome,
        CASE
          WHEN COALESCE(NULLIF(d._dados->>'COD1_PES', ''),
            NULLIF(nf._dados->>'COD1_PES', '')) IS NULL THEN 'NAO_INFORMADO'
          WHEN vend.id IS NULL THEN 'CADASTRO_NAO_SINCRONIZADO'
          WHEN vend._dados->>'SITU_PES' = 'A' THEN 'ATIVO'
          WHEN vend._dados->>'SITU_PES' = 'I' THEN 'INATIVO'
          ELSE COALESCE(vend._dados->>'SITU_PES', 'SEM_SITUACAO')
        END AS vendedor_status,
        d._dados->>'NPAR_REC' AS parcela_nr,
        d._dados->>'SITU_REC' AS situ_rec, d._dados->>'SITU_CBR' AS situ_cbr,
        d._dados->>'HISTORICO' AS historico,
        (d._dados->>'VLOR_REC')::NUMERIC AS valor_face,
        d.data_emissao, d.data_vencimento,
        d.indexador_id, d.indexador_filial_id, i.abreviatura,
        i.descricao AS indexador_descricao,
        iv0.valor AS valor_indice_origem,
        bt.ultima_baixa, p.data_base_baixa, p.valor_diferenca,
        CASE WHEN d.indexador_id IS NOT NULL THEN (d._dados->>'VLOR_REC')::NUMERIC / iv0.valor
             ELSE (d._dados->>'VLOR_REC')::NUMERIC END AS valor_titulo_unidade,
        b.valor_baixado, b.valor_baixado_face, b.qtd_baixas, b.primeira_baixa, b.multa, b.juros, b.desconto, b.acrescimo, b.valor_complementar,
        CASE WHEN d.indexador_id IS NOT NULL THEN COALESCE(a.valor_agrupado, 0) / iv0.valor
             ELSE COALESCE(a.valor_agrupado, 0) END AS valor_agrupado_unidade
        ,COALESCE(a.valor_agrupado, 0) AS valor_agrupado_face
      FROM raw.duplicatas d
      LEFT JOIN raw.faturamento nf ON nf.id = d.nf_id
      LEFT JOIN raw.financeiro_titulos ft
        ON ft.tipo = 'CR' AND ft.titulo_id = d.nf_id
      LEFT JOIN raw.vendedores vend ON vend.id = COALESCE(
        NULLIF(d._dados->>'COD1_PES', ''),
        NULLIF(nf._dados->>'COD1_PES', '')
      )
      LEFT JOIN raw.tipos_documento td ON td.id = d.tipo_documento
      LEFT JOIN raw.indexadores i ON i.id = d.indexador_id
      LEFT JOIN raw.indexador_valores iv0
        ON iv0.filial_id = d.indexador_filial_id AND iv0.indexador_id = d.indexador_id
       AND iv0.data_valor = d.data_indexador
      LEFT JOIN baixas b ON b.parcela_id = d.id
      LEFT JOIN baixas_todas bt ON bt.parcela_id = d.id
      LEFT JOIN agrupamentos a ON a.parcela_id = d.id
      LEFT JOIN raw.param_ger_financ p ON p.id = d.filial_id
    ),
    bruto AS (
      SELECT base.*,
        CASE WHEN indexador_id IS NULL AND valor_baixado IS NOT NULL
               THEN ROUND(valor_titulo_unidade - valor_baixado - valor_agrupado_unidade, 2)
             ELSE valor_titulo_unidade - COALESCE(valor_baixado, 0) - valor_agrupado_unidade
        END AS saldo_bruto
      FROM base
    ),
    calculado AS (
      SELECT bruto.*,
        CASE
          WHEN (data_base_baixa IS NULL OR ((data_emissao < data_base_baixa AND ultima_baixa IS NULL) OR ultima_baixa < data_base_baixa))
            AND saldo_bruto <= valor_diferenca THEN 0
          WHEN saldo_bruto < 0.005 THEN ROUND(saldo_bruto, 2)
          ELSE saldo_bruto
        END AS saldo_local
      FROM bruto
    ),
    cotado AS (
      SELECT calculado.*,
        COALESCE(
          (SELECT iv.valor FROM raw.indexador_valores iv
           WHERE iv.filial_id = calculado.indexador_filial_id AND iv.indexador_id = calculado.indexador_id
             AND iv.data_valor <= $1::date AND iv.valor > 0
           ORDER BY iv.data_valor DESC LIMIT 1),
          (SELECT iv.valor FROM raw.indexador_valores iv
           WHERE iv.filial_id = calculado.indexador_filial_id AND iv.indexador_id = calculado.indexador_id
             AND iv.data_valor >= $1::date AND iv.valor > 0
           ORDER BY iv.data_valor LIMIT 1),
          1
        ) AS cotacao_na_data
      FROM calculado
    ),
    ajustado AS (
      SELECT cotado.*,
        ROUND(CASE WHEN natureza_tipo_documento = 'C' THEN -saldo_local ELSE saldo_local END, 2) AS saldo_ajustado,
        CASE WHEN indexador_id IS NULL THEN 1 ELSE cotacao_na_data END AS cotacao_aplicada
      FROM cotado
    )
    SELECT
      a.parcela_id, a.titulo_id, a.filial_id,
      fil._dados->>'IDEN_EMP' AS filial_identificacao,
      a.cliente_id, cli.razao_social AS cliente_nome, cli.cgc_cnpj AS cliente_cnpj_cpf,
      a.vendedor_id, a.vendedor_nome, a.vendedor_status,
      a.tipo_documento, a.tipo_documento_descricao, a.natureza_tipo_documento,
      a.historico,
      COALESCE(a.historico ILIKE '%FIDC%' OR a.historico ILIKE '%FIDIC%', FALSE) AS fidc,
      a.numero_documento, a.serie_documento, a.parcela_nr,
      a.data_emissao, a.data_vencimento,
      a.valor_face AS valor_parcela,
      a.saldo_ajustado AS saldo_parcela,
      COALESCE(a.abreviatura, 'R$') AS unidade_saldo,
      a.indexador_id,
      a.indexador_descricao,
      a.valor_indice_origem AS valor_indexador_origem,
      a.cotacao_aplicada AS valor_indexador_atual,
      ROUND(
        CASE WHEN a.natureza_tipo_documento = 'C' THEN -1 ELSE 1 END
        * CASE
            WHEN a.indexador_id IS NULL THEN ABS(a.saldo_ajustado)
            ELSE a.valor_face
              - COALESCE(a.valor_baixado_face, 0)
              - COALESCE(a.valor_agrupado_face, 0)
          END,
        2
      ) AS valor_em_aberto_controller,
      ROUND(a.saldo_ajustado * a.cotacao_aplicada, 2) AS saldo_convertido_atual,
      a.qtd_baixas, a.valor_baixado_face AS valor_baixado, a.primeira_baixa, a.ultima_baixa,
      a.juros, a.multa, a.desconto, a.acrescimo, a.valor_complementar,
      CASE
        WHEN a.saldo_ajustado < -0.01 THEN 'CREDITO_EM_ABERTO'
        WHEN a.data_vencimento < $1::date THEN 'VENCIDA'
        WHEN a.data_vencimento = $1::date THEN 'VENCE_HOJE'
        ELSE 'A_VENCER'
      END AS situacao,
      GREATEST($1::date - a.data_vencimento, 0) AS dias_atraso,
      CASE
        WHEN a.saldo_ajustado < -0.01 THEN 'CREDITO_EM_ABERTO'
        WHEN a.data_vencimento < $1::date - 360 THEN 'VENCIDO_ACIMA_360_DIAS'
        WHEN a.data_vencimento < $1::date - 180 THEN 'VENCIDO_181_A_360_DIAS'
        WHEN a.data_vencimento < $1::date - 120 THEN 'VENCIDO_121_A_180_DIAS'
        WHEN a.data_vencimento < $1::date - 90 THEN 'VENCIDO_91_A_120_DIAS'
        WHEN a.data_vencimento < $1::date - 60 THEN 'VENCIDO_61_A_90_DIAS'
        WHEN a.data_vencimento < $1::date - 30 THEN 'VENCIDO_31_A_60_DIAS'
        WHEN a.data_vencimento < $1::date THEN 'VENCIDO_1_A_30_DIAS'
        WHEN a.data_vencimento = $1::date THEN 'VENCE_HOJE'
        WHEN a.data_vencimento <= $1::date + 30 THEN 'VENCE_EM_1_A_30_DIAS'
        WHEN a.data_vencimento <= $1::date + 60 THEN 'VENCE_EM_31_A_60_DIAS'
        WHEN a.data_vencimento <= $1::date + 90 THEN 'VENCE_EM_61_A_90_DIAS'
        WHEN a.data_vencimento <= $1::date + 120 THEN 'VENCE_EM_91_A_120_DIAS'
        WHEN a.data_vencimento <= $1::date + 180 THEN 'VENCE_EM_121_A_180_DIAS'
        WHEN a.data_vencimento <= $1::date + 360 THEN 'VENCE_EM_181_A_360_DIAS'
        ELSE 'VENCE_ACIMA_360_DIAS'
      END AS faixa_vencimento
    FROM ajustado a
    LEFT JOIN raw.clientes cli ON cli.id = a.cliente_id
    LEFT JOIN raw.filiais fil ON fil.id = a.filial_id
    ${whereClause}
  `;

  // Parcelas EM ABERTO na data-base (= relatório do controller).
  const whereAberto = `
    WHERE ABS(a.saldo_ajustado) > 0.01
      AND a.situ_rec = 'A' AND a.situ_cbr = 'A'
      AND a.data_emissao <= $1::date
      AND ((a.natureza_tipo_documento = 'D' AND a.saldo_ajustado > 0) OR (a.natureza_tipo_documento = 'C' AND a.saldo_ajustado < 0))
  `;
  const abertos = (await pg.query(queryBody(whereAberto), [dataBase])).rows;
  if (!incluirBaixadas) return abertos;

  // Parcelas já RECEBIDAS (saldo ≈ 0) com baixa até a data-base, restritas aos
  // títulos que ainda têm parcela em aberto — assim a conciliação fecha por
  // título sem despejar todo o histórico recebido.
  const tituloIds = [...new Set(abertos.map((r) => r.titulo_id).filter(Boolean))];
  if (tituloIds.length === 0) return abertos;
  const whereRecebidas = `
    WHERE ABS(a.saldo_ajustado) <= 0.01
      AND COALESCE(a.valor_baixado_face, 0) > 0
      AND a.data_emissao <= $1::date
      AND a.titulo_id = ANY($2::text[])
  `;
  const recebidas = (await pg.query(queryBody(whereRecebidas), [dataBase, tituloIds])).rows;
  return [...abertos, ...recebidas];
}

async function consultarCP(dataBase, incluirBaixadas = false) {
  // O corpo da consulta é idêntico para "em aberto" e "pagas"; só muda o WHERE.
  const queryBody = (whereClause) => `
    WITH baixas AS (
      SELECT
        f.id AS parcela_id,
        SUM(CASE WHEN f.indexador_id IS NOT NULL THEN b.valor / iv.valor ELSE b.valor END) AS valor_baixado,
        SUM(b.valor) AS valor_baixado_face,
        COUNT(*)::INT AS qtd_baixas,
        MIN(b.data_pagamento) AS primeira_baixa,
        SUM(b.multa) AS multa, SUM(b.juros) AS juros,
        SUM(b.desconto) AS desconto, SUM(b.acrescimo) AS acrescimo
      FROM raw.financeiro_cp f
      JOIN raw.pagamentos b
        ON b.parcela_id = f.id AND b.status = 'N' AND b.data_pagamento <= $1::date
      LEFT JOIN raw.indexador_valores iv
        ON iv.filial_id = f.filial_id AND iv.indexador_id = f.indexador_id AND iv.data_valor = b.data_indexador
      GROUP BY f.id
    ),
    baixas_todas AS (
      SELECT parcela_id, MAX(data_pagamento) AS ultima_baixa
      FROM raw.pagamentos WHERE data_pagamento <= $1::date
      GROUP BY parcela_id
    ),
    agrupamentos AS (
      SELECT parcela_id,
        SUM(CASE WHEN a.indexador_id IS NOT NULL THEN a.valor / iv.valor ELSE a.valor END) AS valor_agrupado
      FROM raw.pagar_agrupamentos a
      LEFT JOIN raw.indexador_valores iv
        ON iv.filial_id = a.indexador_filial_id AND iv.indexador_id = a.indexador_id AND iv.data_valor = a.data_indexador
      WHERE data_titulo_agrupador <= $1::date
      GROUP BY parcela_id
    ),
    base AS (
      SELECT
        f.id AS parcela_id, f._dados->>'CAB_ID' AS titulo_id, f.filial_id, f.parceiro_id,
        f.tipo_documento, td.tipo AS natureza_tipo_documento, td.descricao AS tipo_documento_descricao,
        f._dados->>'HISTORICO' AS historico,
        f._dados->>'NPAR_PAG' AS parcela_nr,
        (f._dados->>'VLOR')::NUMERIC AS valor_face,
        f.data_emissao, f.data_vencimento,
        f.indexador_id, f.filial_id AS indexador_filial_id, i.abreviatura,
        iv0.valor AS valor_indice_origem,
        bt.ultima_baixa, p.data_base_baixa, p.valor_diferenca,
        CASE WHEN f.indexador_id IS NOT NULL THEN (f._dados->>'VLOR')::NUMERIC / iv0.valor
             ELSE (f._dados->>'VLOR')::NUMERIC END AS valor_titulo_unidade,
        b.valor_baixado, b.valor_baixado_face, b.qtd_baixas, b.primeira_baixa, b.multa, b.juros, b.desconto, b.acrescimo,
        COALESCE(a.valor_agrupado, 0) AS valor_agrupado
      FROM raw.financeiro_cp f
      LEFT JOIN raw.tipos_documento td ON td.id = f.tipo_documento
      LEFT JOIN raw.indexadores i ON i.id = f.indexador_id
      LEFT JOIN raw.indexador_valores iv0
        ON iv0.filial_id = f.filial_id AND iv0.indexador_id = f.indexador_id AND iv0.data_valor = f.data_indexador
      LEFT JOIN baixas b ON b.parcela_id = f.id
      LEFT JOIN baixas_todas bt ON bt.parcela_id = f.id
      LEFT JOIN agrupamentos a ON a.parcela_id = f.id
      LEFT JOIN raw.param_ger_financ p ON p.id = f.filial_id
    ),
    bruto AS (
      SELECT base.*,
        CASE
          WHEN valor_baixado IS NULL OR valor_baixado + valor_agrupado = 0 THEN valor_titulo_unidade
          WHEN indexador_id IS NULL THEN ROUND(valor_titulo_unidade - valor_baixado - valor_agrupado, 2)
          ELSE valor_titulo_unidade - valor_baixado - valor_agrupado
        END AS saldo_bruto
      FROM base
    ),
    calculado AS (
      SELECT bruto.*,
        CASE
          WHEN (data_base_baixa IS NULL OR ((data_emissao < data_base_baixa AND ultima_baixa IS NULL) OR ultima_baixa < data_base_baixa))
            AND saldo_bruto <= valor_diferenca THEN 0
          WHEN saldo_bruto < 0.005 THEN ROUND(saldo_bruto, 2)
          ELSE saldo_bruto
        END AS saldo_local
      FROM bruto
    ),
    cotado AS (
      SELECT calculado.*,
        COALESCE(
          (SELECT iv.valor FROM raw.indexador_valores iv
           WHERE iv.filial_id = calculado.indexador_filial_id AND iv.indexador_id = calculado.indexador_id
             AND iv.data_valor <= $1::date AND iv.valor > 0
           ORDER BY iv.data_valor DESC LIMIT 1),
          (SELECT iv.valor FROM raw.indexador_valores iv
           WHERE iv.filial_id = calculado.indexador_filial_id AND iv.indexador_id = calculado.indexador_id
             AND iv.data_valor >= $1::date AND iv.valor > 0
           ORDER BY iv.data_valor LIMIT 1),
          1
        ) AS cotacao_na_data
      FROM calculado
    )
    SELECT
      c.parcela_id, c.titulo_id, c.filial_id,
      fil._dados->>'IDEN_EMP' AS filial_identificacao,
      fil._dados->>'FANT_EMP' AS filial_nome,
      c.parceiro_id AS fornecedor_id,
      COALESCE(forn.razao_social, cli.razao_social) AS fornecedor_nome,
      COALESCE(forn.cgc_cnpj, cli.cgc_cnpj) AS fornecedor_cnpj_cpf,
      c.tipo_documento, c.tipo_documento_descricao, c.natureza_tipo_documento,
      c.historico,
      COALESCE(c.historico ILIKE '%FIDC%' OR c.historico ILIKE '%FIDIC%', FALSE) AS fidc,
      c.parcela_nr, c.data_emissao, c.data_vencimento,
      c.valor_face AS valor_parcela,
      ROUND(saldo_ajustado.valor, 2) AS saldo_parcela,
      COALESCE(c.abreviatura, 'R$') AS unidade_saldo,
      ROUND(saldo_ajustado.valor * (CASE WHEN c.indexador_id IS NULL THEN 1 ELSE c.cotacao_na_data END), 2) AS saldo_convertido_atual,
      c.qtd_baixas, c.valor_baixado_face AS valor_baixado, c.primeira_baixa,
      c.juros, c.multa, c.desconto, c.acrescimo,
      CASE
        WHEN ABS(saldo_ajustado.valor) <= 0.01 THEN 'BAIXADA'
        WHEN COALESCE(c.valor_baixado, 0) > 0 THEN 'PARCIAL'
        ELSE 'ABERTA'
      END AS situacao,
      CASE WHEN ABS(saldo_ajustado.valor) <= 0.01 THEN 0
           WHEN c.data_vencimento < $1::date THEN $1::date - c.data_vencimento
           ELSE 0 END AS dias_atraso,
      CASE
        WHEN ABS(saldo_ajustado.valor) <= 0.01 THEN 'BAIXADA'
        WHEN c.data_vencimento < $1::date - 90 THEN 'VENCIDO_ACIMA_90_DIAS'
        WHEN c.data_vencimento < $1::date - 30 THEN 'VENCIDO_31_A_90_DIAS'
        WHEN c.data_vencimento < $1::date THEN 'VENCIDO_1_A_30_DIAS'
        WHEN c.data_vencimento = $1::date THEN 'VENCE_HOJE'
        WHEN c.data_vencimento <= $1::date + 7 THEN 'VENCE_EM_1_A_7_DIAS'
        WHEN c.data_vencimento <= $1::date + 30 THEN 'VENCE_EM_8_A_30_DIAS'
        WHEN c.data_vencimento <= $1::date + 60 THEN 'VENCE_EM_31_A_60_DIAS'
        WHEN c.data_vencimento <= $1::date + 90 THEN 'VENCE_EM_61_A_90_DIAS'
        ELSE 'VENCE_ACIMA_90_DIAS'
      END AS faixa_vencimento
    FROM cotado c
    CROSS JOIN LATERAL (
      SELECT CASE WHEN c.natureza_tipo_documento = 'C' THEN -c.saldo_local ELSE c.saldo_local END AS valor
    ) AS saldo_ajustado
    LEFT JOIN raw.fornecedores forn ON forn.id = c.parceiro_id
    LEFT JOIN raw.clientes cli ON cli.id = c.parceiro_id
    LEFT JOIN raw.filiais fil ON fil.id = c.filial_id
    ${whereClause}
  `;

  // Parcelas EM ABERTO na data-base (= relatório do controller).
  const whereAberto = `
    WHERE c.data_emissao <= $1::date
      AND ABS(saldo_ajustado.valor) > 0.01
      AND (
        (c.natureza_tipo_documento = 'D' AND saldo_ajustado.valor > 0)
        OR (c.natureza_tipo_documento = 'C' AND saldo_ajustado.valor < 0)
        OR c.natureza_tipo_documento IS NULL
      )
  `;
  const abertos = (await pg.query(queryBody(whereAberto), [dataBase])).rows;
  if (!incluirBaixadas) return abertos;

  // Parcelas já QUITADAS (saldo ≈ 0) com baixa até a data-base, restritas aos
  // títulos que ainda têm parcela em aberto — assim a conciliação fecha por
  // título (Valor = Pago + Em aberto) sem despejar todo o histórico pago.
  const tituloIds = [...new Set(abertos.map((r) => r.titulo_id).filter(Boolean))];
  if (tituloIds.length === 0) return abertos;
  const wherePagas = `
    WHERE c.data_emissao <= $1::date
      AND ABS(saldo_ajustado.valor) <= 0.01
      AND COALESCE(c.valor_baixado_face, 0) > 0
      AND c.titulo_id = ANY($2::text[])
  `;
  const pagas = (await pg.query(queryBody(wherePagas), [dataBase, tituloIds])).rows;
  return [...abertos, ...pagas];
}

function numero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resumoCR(rows, dataBase) {
  const limite7 = new Date(dataBase); limite7.setDate(limite7.getDate() + 7);
  const limite30 = new Date(dataBase); limite30.setDate(limite30.getDate() + 30);
  const totais = {
    qtd_parcelas: rows.length,
    qtd_titulos: new Set(rows.map((r) => r.titulo_id)).size,
    qtd_clientes: new Set(rows.map((r) => r.cliente_id)).size,
    saldo_convertido_atual: 0, saldo_vencido_convertido: 0,
    saldo_proximos_7_dias_convertido: 0, saldo_proximos_30_dias_convertido: 0,
    qtd_parcelas_vencidas: 0, qtd_parcelas_indexadas: 0, data_calculo: dataBase,
    qtd_parcelas_fidc: 0, saldo_fidc_convertido: 0,
  };
  const porCliente = new Map();
  const porUnidade = new Map();
  for (const row of rows) {
    const saldoConv = numero(row.saldo_convertido_atual);
    totais.saldo_convertido_atual += saldoConv;
    if (row.situacao === 'VENCIDA') {
      totais.saldo_vencido_convertido += saldoConv;
      totais.qtd_parcelas_vencidas += 1;
    }
    if (row.fidc) {
      totais.qtd_parcelas_fidc += 1;
      totais.saldo_fidc_convertido += saldoConv;
    }
    const venc = row.data_vencimento ? new Date(row.data_vencimento) : null;
    if (venc && venc >= new Date(dataBase) && venc <= limite7) totais.saldo_proximos_7_dias_convertido += saldoConv;
    if (venc && venc >= new Date(dataBase) && venc <= limite30) totais.saldo_proximos_30_dias_convertido += saldoConv;
    if (row.unidade_saldo !== 'R$') totais.qtd_parcelas_indexadas += 1;

    const chaveCliente = `${row.filial_id}|${row.cliente_id}|${row.unidade_saldo}`;
    const cli = porCliente.get(chaveCliente) || {
      filial_id: row.filial_id, filial_identificacao: row.filial_identificacao,
      cliente_id: row.cliente_id, cliente_nome: row.cliente_nome, cliente_cnpj_cpf: row.cliente_cnpj_cpf,
      unidade_saldo: row.unidade_saldo, qtd_parcelas: 0, titulos: new Set(),
      valor_parcelas: 0, valor_baixado: 0, saldo_aberto: 0, saldo_convertido_atual: 0,
      saldo_vencido: 0, saldo_vencido_convertido: 0, saldo_a_vencer: 0,
      primeiro_vencimento: null, ultimo_vencimento: null, maior_atraso_dias: 0,
    };
    cli.qtd_parcelas += 1;
    cli.titulos.add(row.titulo_id);
    cli.valor_parcelas += numero(row.valor_parcela);
    cli.valor_baixado += numero(row.valor_baixado);
    cli.saldo_aberto += numero(row.saldo_parcela);
    cli.saldo_convertido_atual += saldoConv;
    if (row.situacao === 'VENCIDA') { cli.saldo_vencido += numero(row.saldo_parcela); cli.saldo_vencido_convertido += saldoConv; }
    if (row.situacao === 'A_VENCER' || row.situacao === 'VENCE_HOJE') cli.saldo_a_vencer += numero(row.saldo_parcela);
    if (!cli.primeiro_vencimento || row.data_vencimento < cli.primeiro_vencimento) cli.primeiro_vencimento = row.data_vencimento;
    if (!cli.ultimo_vencimento || row.data_vencimento > cli.ultimo_vencimento) cli.ultimo_vencimento = row.data_vencimento;
    cli.maior_atraso_dias = Math.max(cli.maior_atraso_dias, numero(row.dias_atraso));
    porCliente.set(chaveCliente, cli);

    const unid = porUnidade.get(row.unidade_saldo) || {
      unidade_saldo: row.unidade_saldo, qtd_parcelas: 0, titulos: new Set(), clientes: new Set(),
      saldo_aberto: 0, saldo_convertido_atual: 0, saldo_vencido: 0, saldo_vencido_convertido: 0,
    };
    unid.qtd_parcelas += 1;
    unid.titulos.add(row.titulo_id);
    unid.clientes.add(row.cliente_id);
    unid.saldo_aberto += numero(row.saldo_parcela);
    unid.saldo_convertido_atual += saldoConv;
    if (row.situacao === 'VENCIDA') { unid.saldo_vencido += numero(row.saldo_parcela); unid.saldo_vencido_convertido += saldoConv; }
    porUnidade.set(row.unidade_saldo, unid);
  }
  const data = [...porCliente.values()]
    .map((c) => ({ ...c, qtd_titulos: c.titulos.size }))
    .sort((a, b) => b.saldo_convertido_atual - a.saldo_convertido_atual);
  const unidades = [...porUnidade.values()].map((u) => ({
    ...u, qtd_titulos: u.titulos.size, qtd_clientes: u.clientes.size,
  }));
  return { data, unidades, totalizadores: totais };
}

function resumoCP(rows, dataBase) {
  const limite7 = new Date(dataBase); limite7.setDate(limite7.getDate() + 7);
  const limite30 = new Date(dataBase); limite30.setDate(limite30.getDate() + 30);
  const totais = {
    qtd_parcelas: rows.length,
    qtd_titulos: new Set(rows.map((r) => r.titulo_id)).size,
    qtd_fornecedores: new Set(rows.map((r) => r.fornecedor_id)).size,
    valor_parcelas: 0, valor_baixado: 0, saldo: 0, saldo_vencido: 0,
    saldo_proximos_7_dias: 0, saldo_proximos_30_dias: 0,
    qtd_parcelas_com_pedido: 0, qtd_parcelas_sem_pedido: rows.length, qtd_divergencias_pedido: 0,
    qtd_parcelas_fidc: 0, saldo_fidc: 0,
  };
  const porFornecedor = new Map();
  for (const row of rows) {
    const saldo = numero(row.saldo_parcela);
    totais.valor_parcelas += numero(row.valor_parcela);
    totais.valor_baixado += numero(row.valor_baixado);
    totais.saldo += saldo;
    if (row.fidc) {
      totais.qtd_parcelas_fidc += 1;
      totais.saldo_fidc += saldo;
    }
    const venc = row.data_vencimento ? new Date(row.data_vencimento) : null;
    if (venc && venc < new Date(dataBase)) totais.saldo_vencido += saldo;
    if (venc && venc >= new Date(dataBase) && venc <= limite7) totais.saldo_proximos_7_dias += saldo;
    if (venc && venc >= new Date(dataBase) && venc <= limite30) totais.saldo_proximos_30_dias += saldo;

    const chave = `${row.filial_id}|${row.fornecedor_id}`;
    const forn = porFornecedor.get(chave) || {
      filial_id: row.filial_id, filial_nome: row.filial_nome,
      fornecedor_id: row.fornecedor_id, fornecedor_nome: row.fornecedor_nome,
      fornecedor_cnpj_cpf: row.fornecedor_cnpj_cpf, qtd_parcelas: 0, titulos: new Set(),
      valor_parcelas: 0, valor_baixado: 0, saldo: 0, saldo_vencido: 0,
      saldo_proximos_7_dias: 0, saldo_proximos_30_dias: 0,
      qtd_parcelas_com_pedido: 0, qtd_parcelas_sem_pedido: 0, qtd_divergencias_pedido: 0,
      primeiro_vencimento: null, ultimo_vencimento: null,
    };
    forn.qtd_parcelas += 1;
    forn.titulos.add(row.titulo_id);
    forn.valor_parcelas += numero(row.valor_parcela);
    forn.valor_baixado += numero(row.valor_baixado);
    forn.saldo += saldo;
    forn.qtd_parcelas_sem_pedido += 1;
    if (venc && venc < new Date(dataBase)) forn.saldo_vencido += saldo;
    if (venc && venc >= new Date(dataBase) && venc <= limite7) forn.saldo_proximos_7_dias += saldo;
    if (venc && venc >= new Date(dataBase) && venc <= limite30) forn.saldo_proximos_30_dias += saldo;
    if (!forn.primeiro_vencimento || row.data_vencimento < forn.primeiro_vencimento) forn.primeiro_vencimento = row.data_vencimento;
    if (!forn.ultimo_vencimento || row.data_vencimento > forn.ultimo_vencimento) forn.ultimo_vencimento = row.data_vencimento;
    porFornecedor.set(chave, forn);
  }
  const data = [...porFornecedor.values()]
    .map((f) => ({ ...f, qtd_titulos: f.titulos.size }))
    .sort((a, b) => b.saldo - a.saldo);
  return { data, totalizadores: totais };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const saida = { dataBase: args.dataBase, geradoEm: new Date().toISOString() };

  if (args.tipo === 'CR' || args.tipo === 'AMBOS') {
    const rows = await consultarCR(args.dataBase, args.incluirBaixadas);
    // Totalizadores e quebras refletem apenas o em aberto (= controller); as
    // recebidas vêm em `rows` para as abas Recebidas/conciliação.
    const emAberto = rows.filter((r) => Math.abs(numero(r.saldo_parcela)) > 0.01);
    const resumo = resumoCR(emAberto, args.dataBase);
    saida.cr = { rows, ...resumo };
  }
  if (args.tipo === 'CP' || args.tipo === 'AMBOS') {
    const rows = await consultarCP(args.dataBase, args.incluirBaixadas);
    // Totalizadores e quebra por fornecedor refletem apenas o que está EM ABERTO
    // (= relatório do controller). As parcelas quitadas vêm em `rows` para as
    // abas "Pagas"/conciliação, mas não entram no saldo.
    const emAberto = rows.filter((r) => Math.abs(numero(r.saldo_parcela)) > 0.01);
    const resumo = resumoCP(emAberto, args.dataBase);
    saida.cp = { rows, ...resumo };
  }

  const json = JSON.stringify(saida, (_key, value) => (value instanceof Set ? [...value] : value), 2);
  if (args.saida) {
    fs.writeFileSync(path.resolve(args.saida), json);
    console.error(`[saldo-aberto-historico] gravado em ${args.saida}`);
  } else {
    process.stdout.write(json);
  }
}

main()
  .catch((error) => {
    console.error('[saldo-aberto-historico] erro:', error);
    process.exitCode = 1;
  })
  .finally(() => pg.pool.end());
