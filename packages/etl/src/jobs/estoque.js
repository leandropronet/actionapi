'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync } = require('../upsert');
const cfg = require('../oracle-config').estoque;

// CCSALDO é uma view realtime — não tem DUMANUT, então carregamos tudo a cada ciclo.
// A tabela raw.estoque usa ON CONFLICT DO UPDATE, então é seguro rodar a cada 10 min.
async function sincronizar() {
  console.log('[estoque] carregando saldo atual do CCSALDO...');

  const sql = `
    SELECT
      ${cfg.campoFilial}   AS CODI_EMP,
      ${cfg.campoProduto}  AS CODI_PSV,
      ${cfg.campoTipoCtrl} AS CODI_CTR,
      ${cfg.campoSaldo}    AS QTDE_CCS,
      ${cfg.campoData}     AS DATA_CCS
    FROM ${cfg.schema}.${cfg.tabela}
    WHERE ${cfg.campoSaldo} <> 0
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
