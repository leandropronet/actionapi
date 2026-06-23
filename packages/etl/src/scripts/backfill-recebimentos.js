'use strict';
/**
 * Carrega o histórico completo de baixas de Contas a Receber (CRCBAIXA).
 * raw.recebimentos só tinha 70.554 de 181.090 baixas do Oracle (39%) — mesmo
 * padrão de bug (sincronização puramente incremental, sem carga inicial)
 * já corrigido em duplicatas, pedidos, financeiro_titulos e contabil_cabecalhos.
 *
 * Processa ano a ano para manter o consumo de memória sob controle.
 * O Oracle é acessado exclusivamente com SELECT.
 *
 * Uso:
 *   node src/scripts/backfill-recebimentos.js [anoInicio]
 */
const job = require('../jobs/recebimentos');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

async function main() {
  const anoInicio = Number(process.argv[2]) || 2007;
  const anoFim = new Date().getFullYear() + 1; // CRCBAIXA tem baixas futuras agendadas (até 2027)

  for (let ano = anoInicio; ano <= anoFim; ano++) {
    const dataInicio = `${ano}-01-01`;
    const dataFim = `${ano + 1}-01-01`;
    console.log(`[backfill-recebimentos] processando ${ano}...`);
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
