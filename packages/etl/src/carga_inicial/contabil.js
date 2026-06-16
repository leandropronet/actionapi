'use strict';
const oracle = require('../db/oracle');
const { upsertRaw } = require('../upsert');
const cfg = require('../oracle-config').contabil;

async function carregarJanela(filialId, dataInicio, dataFim) {
  const sql = `
    SELECT *
    FROM ${cfg.tabela}
    WHERE ${cfg.campoFilial} = :filialId
      AND ${cfg.campoData} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
      AND ${cfg.campoData} <  TO_DATE(:dataFim,   'YYYY-MM-DD') + 1
    ORDER BY ${cfg.campoData}
  `;

  const result = await oracle.query(sql, { filialId, dataInicio, dataFim });
  const rows = result.rows || [];
  if (!rows.length) return 0;

  const registros = rows.map((row) => {
    const comp = row[cfg.campoCompetencia];
    let competencia = null;
    if (comp instanceof Date) {
      competencia = `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
    } else if (typeof comp === 'string' && comp.length >= 6) {
      competencia = `${comp.slice(0, 4)}-${comp.slice(4, 6)}`;
    }
    return {
      id:              String(row[cfg.campoId]),
      filial_id:       String(row[cfg.campoFilial] ?? filialId),
      data_lancamento: row[cfg.campoData] || null,
      competencia,
      data_alteracao:  row[cfg.campoDataAlter] || null,
      _dados:          JSON.stringify(row),
      _source:         'siagri',
    };
  });

  await upsertRaw('raw.contabil', registros);
  return registros.length;
}

module.exports = { carregarJanela };
