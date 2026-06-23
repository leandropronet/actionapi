'use strict';
/**
 * Exporta o dataset de análise contábil gerencial (mesma regra de
 * packages/api/src/services/bi.js#analiseContabil) para um arquivo .xlsx.
 *
 * Uso:
 *   node src/scripts/export-analise-contabil.js [dataInicio] [dataFim] [arquivo.xlsx]
 *   (padrão: 2020-01-01 até hoje)
 */
const path = require('path');
const XLSX = require('xlsx');
const bi = require('../../../api/src/services/bi');
const pg = require('../../../api/src/db/postgres');

const PAGE_SIZE = 200000;

async function buscarTudo(dataInicio, dataFim) {
  const linhas = [];
  let page = 1;
  for (;;) {
    const { data, total } = await bi.analiseContabil({ dataInicio, dataFim, page, pageSize: PAGE_SIZE });
    linhas.push(...data);
    if (linhas.length >= total || !data.length) break;
    page += 1;
  }
  return linhas;
}

async function main() {
  const dataInicio = process.argv[2] || '2020-01-01';
  const dataFim = process.argv[3] || new Date().toISOString().slice(0, 10);
  const arquivo = process.argv[4]
    || path.join(__dirname, '../../../../', `analise-contabil-${dataInicio}-a-${dataFim}.xlsx`);

  console.log(`[export-analise-contabil] consultando ${dataInicio} a ${dataFim}...`);
  const linhas = await buscarTudo(dataInicio, dataFim);
  console.log(`[export-analise-contabil] ${linhas.length} linhas`);

  const planilha = XLSX.utils.json_to_sheet(linhas);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, 'analise-contabil');
  XLSX.writeFile(workbook, arquivo);

  console.log(`[export-analise-contabil] gerado em ${arquivo}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.pool.end();
  });
