'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync } = require('../upsert');
const cfg = require('../oracle-config').estoque;

// CCSALDO NÃO é uma foto do saldo atual — é um histórico de saldo por data
// (315.648 linhas para só 5.720 combinações filial+produto+tipo, com
// registros voltando a 2008). Sem filtrar pela DATA_CCS mais recente por
// combinação, o saldo carregado é arbitrário/desatualizado (achado real:
// um produto carregado com saldo de 2020 quando o saldo real era de 2021,
// validado em 2026-06-19). ROW_NUMBER() pega só a linha mais recente; o
// filtro de saldo <> 0 é aplicado DEPOIS do ranking, nunca antes — senão um
// produto zerado mais recentemente poderia "voltar" para um saldo antigo
// não-zero por engano.
async function sincronizar() {
  console.log('[estoque] carregando saldo mais recente do CCSALDO...');

  const sql = `
    SELECT CODI_EMP, CODI_PSV, CODI_CTR, QTDE_CCS, DATA_CCS
    FROM (
      SELECT
        ${cfg.campoFilial}   AS CODI_EMP,
        ${cfg.campoProduto}  AS CODI_PSV,
        ${cfg.campoTipoCtrl} AS CODI_CTR,
        ${cfg.campoSaldo}    AS QTDE_CCS,
        ${cfg.campoData}     AS DATA_CCS,
        ROW_NUMBER() OVER (
          PARTITION BY ${cfg.campoFilial}, ${cfg.campoProduto}, ${cfg.campoTipoCtrl}
          ORDER BY ${cfg.campoData} DESC
        ) AS RN
      FROM ${cfg.schema}.${cfg.tabela}
    )
    WHERE RN = 1 AND QTDE_CCS <> 0
  `;

  const result = await oracle.query(sql, {});
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[estoque] sem registros');
    return;
  }

  const registros = rows.map((row) => ({
    // PK: filial + produto + tipo de controle
    id:           `${row.CODI_EMP}_${row.CODI_PSV}_${row.CODI_CTR}`,
    filial_id:    String(row.CODI_EMP ?? ''),
    produto_id:   row.CODI_PSV ? String(row.CODI_PSV) : null,
    deposito_id:  String(row.CODI_CTR ?? ''),
    data_posicao: row.DATA_CCS || new Date(),
    data_alteracao: row.DATA_CCS || new Date(),
    _dados:       JSON.stringify(row),
    _source:      'siagri',
  }));

  await upsertRaw('raw.estoque', registros);
  await atualizarSync('estoque');
  console.log(`[estoque] ${registros.length} posições de saldo sincronizadas`);
}

module.exports = { sincronizar };
