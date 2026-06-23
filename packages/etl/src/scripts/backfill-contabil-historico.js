'use strict';
/**
 * Backfill histórico de raw.contabil (CABLANCTB + LANCONTAB).
 *
 * O sync incremental (jobs/contabil.js) filtra por CAB.DUMANUT > ultimo_sync,
 * ou seja, só pega lançamentos TOCADOS depois do checkpoint. Lançamentos
 * antigos cujo DUMANUT nunca mudou (planos de contas encerrados, ex.: '1' e
 * '1000001', e a parte mais antiga do plano atual '1000002') nunca entraram
 * no Postgres por esse caminho — não é um problema de checkpoint, é estrutural.
 *
 * Este script ignora DUMANUT e busca por DATA_CLC (data do lançamento), em
 * janelas mensais, cobrindo qualquer plano de contas. Idempotente (upsert por
 * id) — pode ser interrompido e retomado informando --desde.
 *
 * Uso:
 *   node src/scripts/backfill-contabil-historico.js [--desde 2008-01-01] [--ate 2019-01-18]
 */
const oracle = require('../db/oracle');
const pg = require('../db/postgres');
const { upsertRawBatch } = require('../upsert');
const cfg = require('../oracle-config').contabil;

function parseArgs() {
  const args = { desde: '2008-01-01', ate: '2019-01-19' };
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--desde') args.desde = process.argv[++i];
    if (process.argv[i] === '--ate') args.ate = process.argv[++i];
  }
  return args;
}

function gerarJanelasMensais(desde, ate) {
  const janelas = [];
  let cursor = new Date(`${desde}T00:00:00Z`);
  const fim = new Date(`${ate}T00:00:00Z`);
  while (cursor < fim) {
    const inicio = cursor;
    const proximo = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 1));
    const limite = proximo < fim ? proximo : fim;
    janelas.push({
      inicio: inicio.toISOString().slice(0, 10),
      fim: limite.toISOString().slice(0, 10),
    });
    cursor = proximo;
  }
  return janelas;
}

async function carregarJanela(dataInicio, dataFimExclusiva) {
  const sql = `
    SELECT
      CAB.${cfg.campoCabId}     AS SEQU_CLC,
      CAB.${cfg.campoCabFilial} AS CODI_EMP,
      CAB.${cfg.campoCabData}   AS DATA_CLC,
      CAB.${cfg.campoCabValor}  AS VCON_CLC,
      CAB.${cfg.campoCabDoc}    AS CTRL_CLC,
      CAB.${cfg.campoCabTipo}   AS TIPO_CLC,
      LCT.${cfg.campoLancId}     AS SEQU_LCT,
      LCT.${cfg.campoLancFilial} AS CODI_EMP_LCT,
      LCT.${cfg.campoLancConta} AS CODI_CPC,
      LCT.${cfg.campoLancPlano} AS CODI_PLC,
      LCT.${cfg.campoLancValor} AS VLOR_LCT,
      LCT.${cfg.campoLancTipo}  AS TIPO_LCT,
      LCT.${cfg.campoLancHist}  AS HIST_HIS,
      CAB.${cfg.campoCabDataAlter} AS DUMANUT
    FROM ${cfg.schema}.${cfg.tabelaCab} CAB
    JOIN ${cfg.schema}.${cfg.tabelaLanc} LCT
      ON LCT.${cfg.campoLancCabId} = CAB.${cfg.campoCabId}
    WHERE CAB.${cfg.campoCabData} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
      AND CAB.${cfg.campoCabData} <  TO_DATE(:dataFim, 'YYYY-MM-DD')
    ORDER BY CAB.${cfg.campoCabData}
  `;

  const result = await oracle.query(sql, { dataInicio, dataFim: dataFimExclusiva });
  const rows = result.rows || [];
  if (!rows.length) return 0;

  const registros = rows.map((row) => {
    const dt = row.DATA_CLC;
    const competencia = dt instanceof Date
      ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
      : null;
    return {
      id: `${row.SEQU_CLC}_${row.SEQU_LCT}`,
      filial_id: String(row.CODI_EMP_LCT ?? row.CODI_EMP ?? ''),
      data_lancamento: row.DATA_CLC || null,
      competencia,
      data_alteracao: row.DUMANUT || null,
      _dados: JSON.stringify(row),
      _source: 'siagri',
    };
  });

  await upsertRawBatch('raw.contabil', registros, { chunkSize: 1000 });
  return registros.length;
}

async function main() {
  const { desde, ate } = parseArgs();
  const janelas = gerarJanelasMensais(desde, ate);
  console.log(`[backfill-contabil-historico] ${janelas.length} janelas mensais, ${desde} a ${ate}`);

  let total = 0;
  for (const janela of janelas) {
    const qtd = await carregarJanela(janela.inicio, janela.fim);
    total += qtd;
    console.log(`[backfill-contabil-historico] ${janela.inicio} a ${janela.fim}: ${qtd} partidas (total acumulado: ${total})`);
  }
  console.log(`[backfill-contabil-historico] concluído: ${total} partidas carregadas/atualizadas`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await oracle.closePool();
    await pg.pool.end();
  });
