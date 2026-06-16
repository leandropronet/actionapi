'use strict';
const oracle = require('../db/oracle');
const { upsertRaw } = require('../upsert');
const cfg = require('../oracle-config').faturamento;

async function carregarJanela(filialId, dataInicio, dataFim) {
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
    id:             String(row[cfg.campoId]),
    filial_id:      String(row[cfg.campoFilial] ?? filialId),
    data_emissao:   row[cfg.campoDataEmissao] || null,
    data_alteracao: row[cfg.campoDataAlter] || null,
    _dados:         JSON.stringify(row),
    _source:        'siagri',
  }));

  await upsertRaw('raw.faturamento', registros);
  return registros.length;
}

module.exports = { carregarJanela };
