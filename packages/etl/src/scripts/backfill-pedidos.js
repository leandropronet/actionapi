'use strict';
/**
 * Carrega o histórico completo de Pedidos de Venda (PEDIDO + IPEDIDO).
 * raw.pedidos só tinha 53.938 de 114.234 pedidos do Oracle — a sincronização
 * incremental por DUMANUT nunca recebeu carga inicial (mesmo padrão de bug
 * já corrigido em financeiro_titulos e contabil_cabecalhos).
 *
 * Processa ano a ano para manter o consumo de memória sob controle — uma
 * carga única (2001-hoje) causou OutOfMemory por carregar ~114k cabeçalhos
 * e ~260k itens de uma vez.
 *
 * O Oracle é acessado exclusivamente com SELECT.
 *
 * Uso:
 *   node src/scripts/backfill-pedidos.js [anoInicio]
 */
const job = require('../jobs/pedidos');
const oracle = require('../db/oracle');
const pg = require('../db/postgres');

async function main() {
  const anoInicio = Number(process.argv[2]) || 2001;
  const anoFim = new Date().getFullYear();

  for (let ano = anoInicio; ano <= anoFim; ano++) {
    const dataInicio = `${ano}-01-01`;
    const dataFim = `${ano + 1}-01-01`;
    console.log(`[backfill-pedidos] processando ${ano}...`);
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
