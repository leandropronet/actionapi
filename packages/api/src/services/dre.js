'use strict';
/**
 * services/dre.js
 *
 * DRE (Demonstrativo de Resultado do Exercício).
 *
 * Fontes de dados:
 *   raw.idre       — estrutura hierárquica das linhas da DRE (IDRE)
 *   raw.contasdre  — mapeamento conta contábil → linha da DRE (CONTASDRE)
 *   raw.contabil   — lançamentos contábeis (CABLANCTB + LANCONTAB)
 *
 * Campos relevantes de raw.idre:
 *   id, descricao, nivel, posicao_pai, tipo (V=Valor C=Cálculo), grupo
 *
 * Campos relevantes de raw.contasdre:
 *   idre_id, conta_id (CODI_CPC), soma_subtrai (A=Adicionar S=Subtrair)
 *
 * Lógica de cálculo por linha:
 *   - Linhas tipo 'V': somam os lançamentos contábeis das contas mapeadas em contasdre
 *     soma_subtrai='A' → valor += D - C
 *     soma_subtrai='S' → valor += C - D
 *   - Linhas tipo 'C': calculadas pelo frontend a partir das linhas filhas
 *     (a API retorna hierarquia completa para o frontend montar o cálculo)
 *
 * Funções exportadas:
 *   calcular()   — DRE consolidada por período (sem desdobramento por conta)
 *   estrutura()  — hierarquia das linhas sem valores (útil para montagem de tela)
 */
const db = require('../db/postgres');

async function calcular({ dataInicio, dataFim, filialId, dreId = '1' }) {
  const conds = [`c.data_lancamento BETWEEN $1 AND $2`];
  const params = [dataInicio, dataFim];

  if (filialId) { params.push(filialId); conds.push(`c.filial_id = $${params.length}`); }
  params.push(dreId);
  const dreParam = `$${params.length}`;

  const contabilWhere = conds.join(' AND ');

  const res = await db.query(
    `SELECT
       i.id                AS idre_id,
       i.descricao,
       i.nivel,
       i.pai_id AS posicao_pai,
       i.tipo,
       i.grupo,
       COALESCE(
         SUM(
           CASE WHEN cd.soma_subtrai = '-'
             THEN CASE WHEN c._dados->>'TIPO_LCT' = 'C'
               THEN (c._dados->>'VLOR_LCT')::NUMERIC
               ELSE -(c._dados->>'VLOR_LCT')::NUMERIC
             END
             ELSE CASE WHEN c._dados->>'TIPO_LCT' = 'D'
               THEN (c._dados->>'VLOR_LCT')::NUMERIC
               ELSE -(c._dados->>'VLOR_LCT')::NUMERIC
             END
           END
         ), 0
       ) AS valor
     FROM raw.idre i
     LEFT JOIN raw.contasdre cd ON cd.idre_id = i.id
     LEFT JOIN raw.contabil  c
      ON c._dados->>'CODI_CPC' = cd.conta_id
      AND ${contabilWhere}
     WHERE i._dados->>'CODI_DRE' = ${dreParam}
     GROUP BY i.id, i.descricao, i.nivel, i.pai_id, i.tipo, i.grupo
     ORDER BY i.nivel NULLS FIRST, i.pai_id NULLS FIRST, i.id`,
    params,
  );

  return {
    dataInicio,
    dataFim,
    linhas: res.rows,
  };
}

async function estrutura({ dreId = '1' } = {}) {
  const res = await db.query(
    `SELECT id, descricao, nivel, pai_id AS posicao_pai, tipo, grupo
     FROM raw.idre
     WHERE _dados->>'CODI_DRE' = $1
     ORDER BY nivel NULLS FIRST, posicao_pai NULLS FIRST, id`,
    [dreId],
  );
  return { linhas: res.rows };
}

module.exports = { calcular, estrutura };
