'use strict';
/**
 * Carrega o histórico completo de Duplicatas / Contas a Receber (CABREC + RECEBER).
 * raw.duplicatas só tinha 68.224 de 161.989 parcelas do Oracle — a sincronização
 * incremental por DUMANUT nunca recebeu carga inicial (mesmo padrão de bug já
 * corrigido em pedidos, financeiro_titulos e contabil_cabecalhos).
 *
 * Processa ano a ano para manter o consumo de memória sob controle.
 * O Oracle é acessado exclusivamente com SELECT.
 *
 * Uso:
 *   node src/scripts/backfill-duplicatas.js [anoInicio]
 */
const job = require('../jobs/duplicatas');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

async function main() {
  const anoInicio = Number(process.argv[2]) || 2007;
  const anoFim = new Date().getFullYear();

  for (let ano = anoInicio; ano <= anoFim; ano++) {
    const dataInicio = `${ano}-01-01`;
    const dataFim = `${ano + 1}-01-01`;
    console.log(`[backfill-duplicatas] processando ${ano}...`);
    await job.sincronizar({ dataInicio, dataFim });
  }
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
