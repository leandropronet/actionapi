'use strict';
/**
 * Gera e carrega o mapeamento gerencial usado pelo dataset de análise contábil.
 *
 * A planilha histórica possui dois layouts concatenados. Este utilitário
 * normaliza ambos e escolhe, por conta, a classificação mais frequente.
 *
 * Uso:
 *   node src/scripts/analise-contabil-mapping.js generate <arquivo.xlsx>
 *   node src/scripts/analise-contabil-mapping.js load
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pg = require('../db/postgres');

const seedPath = path.join(__dirname, '../../seeds/analise-contabil-contas.json');

function isDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function extractMappings(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });
  const counters = new Map();

  for (const row of rows.slice(1)) {
    const oldLayout = isDate(row[8]);
    const contaFormatada = String(row[1] || '').trim();
    if (!contaFormatada) continue;

    const mapping = oldLayout
      ? {
          natureza_contabil: row[4] || null,
          grupo_nivel_1: row[5] || null,
          grupo_nivel_2: row[6] || null,
          grupo_nivel_3: row[7] || null,
          classificacao_ebitda: row[12] || null,
        }
      : {
          natureza_contabil: row[5] || null,
          grupo_nivel_1: row[6] || null,
          grupo_nivel_2: row[7] || null,
          grupo_nivel_3: row[8] || null,
          classificacao_ebitda: row[13] || null,
        };

    const contaId = contaFormatada.replace(/\D/g, '');
    const key = JSON.stringify(mapping);
    if (!counters.has(contaId)) {
      counters.set(contaId, { contaFormatada, options: new Map() });
    }
    const entry = counters.get(contaId);
    entry.options.set(key, (entry.options.get(key) || 0) + 1);
  }

  return [...counters.entries()]
    .map(([conta_id, entry]) => {
      const [selected] = [...entry.options.entries()].sort((a, b) => b[1] - a[1]);
      return {
        conta_id,
        conta_formatada: entry.contaFormatada,
        ...JSON.parse(selected[0]),
      };
    })
    .sort((a, b) => a.conta_formatada.localeCompare(b.conta_formatada));
}

function generateSeed(workbookPath) {
  const mappings = extractMappings(workbookPath);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.writeFileSync(seedPath, `${JSON.stringify(mappings, null, 2)}\n`, 'utf8');
  console.log(`[analise-contabil] ${mappings.length} contas gravadas em ${seedPath}`);
}

async function loadSeed() {
  const mappings = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  await pg.transaction(async (client) => {
    for (const item of mappings) {
      await client.query(
        `INSERT INTO analytics.conta_gerencial (
           conta_id, conta_formatada, natureza_contabil, grupo_nivel_1,
           grupo_nivel_2, grupo_nivel_3, classificacao_ebitda
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (conta_id) DO UPDATE SET
           conta_formatada = EXCLUDED.conta_formatada,
           natureza_contabil = EXCLUDED.natureza_contabil,
           grupo_nivel_1 = EXCLUDED.grupo_nivel_1,
           grupo_nivel_2 = EXCLUDED.grupo_nivel_2,
           grupo_nivel_3 = EXCLUDED.grupo_nivel_3,
           classificacao_ebitda = EXCLUDED.classificacao_ebitda,
           atualizado_em = NOW()`,
        [
          item.conta_id,
          item.conta_formatada,
          item.natureza_contabil,
          item.grupo_nivel_1,
          item.grupo_nivel_2,
          item.grupo_nivel_3,
          item.classificacao_ebitda,
        ],
      );
    }
  });
  console.log(`[analise-contabil] ${mappings.length} contas carregadas`);
}

async function main() {
  const [, , action, workbookPath] = process.argv;
  if (action === 'generate') {
    if (!workbookPath) throw new Error('Informe o caminho do arquivo XLSX.');
    generateSeed(path.resolve(workbookPath));
    return;
  }
  if (action === 'load') {
    await loadSeed();
    return;
  }
  throw new Error('Use "generate <arquivo.xlsx>" ou "load".');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pg.pool.end());
}

module.exports = { extractMappings, generateSeed, loadSeed };
