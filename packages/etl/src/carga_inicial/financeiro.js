'use strict';
const oracle = require('../db/oracle');
const { upsertRaw } = require('../upsert');
const cfgCp = require('../oracle-config').financeiro_cp;
const cfgCr = require('../oracle-config').financeiro_cr;

async function carregarJanela(cfg, tabela, filialId, dataInicio, dataFim) {
  const sql = `
    SELECT *
    FROM ${cfg.tabela}
    WHERE ${cfg.campoFilial} = :filialId
      AND ${cfg.campoDataEmissao} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
      AND ${cfg.campoDataEmissao} <  TO_DATE(:dataFim,   'YYYY-MM-DD') + 1
    ORDER BY ${cfg.campoDataEmissao}
  `;

  const result = await oracle.query(sql, { filialId, dataInicio, dataFim });
  const rows = result.rows || [];
  if (!rows.length) return 0;

  const registros = rows.map((row) => ({
    id:              String(row[cfg.campoId]),
    filial_id:       String(row[cfg.campoFilial] ?? filialId),
    data_emissao:    row[cfg.campoDataEmissao] || null,
    data_vencimento: row[cfg.campoDataVenc] || null,
    data_alteracao:  row[cfg.campoDataAlter] || null,
    _dados:          JSON.stringify(row),
    _source:         'siagri',
  }));

  await upsertRaw(tabela, registros);
  return registros.length;
}

const carregarJanelaCp = (filialId, dataInicio, dataFim) =>
  carregarJanela(cfgCp, 'raw.financeiro_cp', filialId, dataInicio, dataFim);

const carregarJanelaCr = (filialId, dataInicio, dataFim) =>
  carregarJanela(cfgCr, 'raw.financeiro_cr', filialId, dataInicio, dataFim);

module.exports = { carregarJanelaCp, carregarJanelaCr };
