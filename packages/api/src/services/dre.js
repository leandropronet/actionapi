'use strict';
/**
 * services/dre.js
 *
 * DRE (Demonstrativo de Resultado do Exercício).
 *
 * Histórico do bug: a implementação original recalculava o valor de cada
 * linha a partir de raw.contabil + raw.contasdre, usando contasdre.idre_id
 * como "pai_id" (errado — POSI_IDR é só a posição/sequência da própria
 * linha, igual ao id) e contasdre.conta_id como conta contábil. Investigado
 * em 2026-06-23: para o CODI_DRE='1' (default antigo), contasdre.conta_id
 * não referencia contas reais nas linhas de detalhe — a maioria das linhas
 * não tem nenhum vínculo em contasdre. Para os CODI_DRE mais recentes
 * (ex.: 308–314, um por período/fechamento), os vínculos existem e referenciam
 * uma mistura de códigos sintéticos e analíticos do plano de contas, mas
 * somar raw.contabil por esses códigos (testado com prefixo e com igualdade
 * exata, em várias janelas de data) não reconciliou com o TOTA_IDR já
 * calculado pelo SiAGRI — a regra exata de composição usada pelo motor do
 * SiAGRI (provavelmente envolve rateios/ajustes que não estão só em
 * LANCONTAB) não pôde ser confirmada sem um DRE impresso de referência.
 *
 * Solução adotada: em vez de recalcular, expor o valor que o próprio SiAGRI
 * já calculou e gravou em IDRE.TOTA_IDR para aquele fechamento. É um
 * snapshot (não aceita dataInicio/dataFim arbitrários como o resto da API),
 * mas é o número oficial do ERP — mais confiável do que uma reconstrução
 * não validada. Cada fechamento de período gera um novo CODI_DRE; use
 * listarPeriodos() para descobrir qual usar.
 *
 * Fontes de dados:
 *   raw.idre — uma linha por linha do DRE, já com o total calculado em
 *              _dados->>'TOTA_IDR' (gravado pelo SiAGRI no fechamento)
 */
const db = require('../db/postgres');

async function listarPeriodos() {
  const res = await db.query(
    `SELECT
       _dados->>'CODI_DRE' AS dre_id,
       COUNT(*)::INT AS linhas,
       MAX(data_alteracao) AS fechado_em
     FROM raw.idre
     GROUP BY _dados->>'CODI_DRE'
     HAVING MAX(data_alteracao) IS NOT NULL
     ORDER BY fechado_em DESC`,
  );
  return { periodos: res.rows };
}

async function dreIdMaisRecente() {
  const res = await db.query(
    `SELECT _dados->>'CODI_DRE' AS dre_id
     FROM raw.idre
     WHERE data_alteracao IS NOT NULL
     GROUP BY _dados->>'CODI_DRE'
     ORDER BY MAX(data_alteracao) DESC
     LIMIT 1`,
  );
  return res.rows[0]?.dre_id || '1';
}

async function calcular({ dreId } = {}) {
  const idUsado = dreId || await dreIdMaisRecente();
  const res = await db.query(
    `SELECT
       id AS idre_id,
       descricao,
       nivel,
       _dados->>'TIPO_IDR' AS tipo,
       grupo,
       (_dados->>'TOTA_IDR')::NUMERIC AS valor,
       data_alteracao AS fechado_em
     FROM raw.idre
     WHERE _dados->>'CODI_DRE' = $1
     ORDER BY id::INT`,
    [idUsado],
  );
  return {
    dreId: idUsado,
    fechadoEm: res.rows[0]?.fechado_em || null,
    linhas: res.rows,
  };
}

async function estrutura({ dreId } = {}) {
  const idUsado = dreId || await dreIdMaisRecente();
  const res = await db.query(
    `SELECT id, descricao, nivel, _dados->>'TIPO_IDR' AS tipo, grupo
     FROM raw.idre
     WHERE _dados->>'CODI_DRE' = $1
     ORDER BY id::INT`,
    [idUsado],
  );
  return { dreId: idUsado, linhas: res.rows };
}

module.exports = { calcular, estrutura, listarPeriodos };
