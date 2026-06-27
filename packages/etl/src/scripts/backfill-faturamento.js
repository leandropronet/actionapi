'use strict';
/**
 * Recarrega faturamento (NOTA + INOTA + TIPOOPER) por data de emissão.
 *
 * Uso:
 *   node src/scripts/backfill-faturamento.js [anoInicio]
 *   npm run faturamento:backfill -- 2015
 *
 * Se anoInicio for omitido, usa 2015.
 *
 * O Oracle é acessado exclusivamente com SELECT. A escrita ocorre somente no
 * PostgreSQL da ActionAPI por upsert.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const oracle = require('../db/oracle');
const pg = require('../db/postgres');
const { upsertRaw } = require('../upsert');
const cfg = require('../oracle-config').faturamento;
const cfgOp = require('../oracle-config').operacoes;

async function carregarJanela(dataInicio, dataFim) {
  const sql = `
    SELECT
      N.${cfg.campoId}          AS NPRE_NOT,
      N.${cfg.campoFilial}      AS CODI_EMP,
      N.${cfg.campoCliente}     AS CODI_TRA,
      N.${cfg.campoVendedor}    AS COD1_PES,
      N.${cfg.campoDataEmissao} AS DEMI_NOT,
      N.${cfg.campoDataSaida}   AS DSAI_NOT,
      N.${cfg.campoNumeroNF}    AS NOTA_NOT,
      N.${cfg.campoSerie}       AS SERI_NOT,
      N.${cfg.campoTotal}       AS TOTA_NOT,
      N.${cfg.campoStatus}      AS SITU_NOT,
      N.${cfg.campoOperacao}    AS CODI_TOP,
      N.${cfg.campoDataAlter}   AS DUMANUT,
      N.PEDI_PED                AS PEDI_PED,
      N.SERI_PED                AS SERI_PED,
      T.${cfgOp.campoTran}      AS TRAN_TOP,
      T.${cfgOp.campoTipo}      AS TIPO_TOP,
      T.${cfgOp.campoTemplate}  AS CODI_TPL,
      T.${cfgOp.campoDesc}      AS DESC_TOP
    FROM ${cfg.schema}.${cfg.tabela} N
    LEFT JOIN ${cfgOp.schema}.${cfgOp.tabela} T
      ON T.${cfgOp.campoId} = N.${cfg.campoOperacao}
    WHERE N.${cfg.campoDataEmissao} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
      AND N.${cfg.campoDataEmissao} <  TO_DATE(:dataFim, 'YYYY-MM-DD')
    ORDER BY N.${cfg.campoDataEmissao}
  `;

  const result = await oracle.query(sql, { dataInicio, dataFim });
  const rows = result.rows || [];
  if (!rows.length) return { notas: 0, itens: 0 };

  const registros = rows.map((row) => ({
    id: String(row.NPRE_NOT),
    filial_id: String(row.CODI_EMP ?? ''),
    data_emissao: row.DEMI_NOT || null,
    operacao_id: row.CODI_TOP ? String(row.CODI_TOP) : null,
    tran_top: row.TRAN_TOP ? String(row.TRAN_TOP).trim() : null,
    tipo_top: row.TIPO_TOP ? String(row.TIPO_TOP).trim() : null,
    pedido_id: row.PEDI_PED && row.SERI_PED ? `${row.CODI_EMP}_${row.PEDI_PED}_${row.SERI_PED}` : null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  await upsertRaw('raw.faturamento', registros);

  let totalItens = 0;
  const filialPorNf = new Map(rows.map((row) => [String(row.NPRE_NOT), row.CODI_EMP]));
  const ids = rows.map((row) => row.NPRE_NOT).filter(Boolean);
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const placeholders = chunk.map((_, j) => `:id${j}`).join(', ');
    const bindIds = Object.fromEntries(chunk.map((id, j) => [`id${j}`, id]));
    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE ${cfg.campoItemNfId} IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => {
      const filial = filialPorNf.get(String(row[cfg.campoItemNfId]));
      return {
        id: `${row[cfg.campoItemNfId]}_${row[cfg.campoItemSeq]}`,
        nf_id: String(row[cfg.campoItemNfId]),
        produto_id: row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
        pedido_id: row.PEDI_PED && row.SERI_PED ? `${filial}_${row.PEDI_PED}_${row.SERI_PED}` : null,
        _dados: JSON.stringify(row),
        _source: 'siagri',
      };
    });
    if (itens.length) {
      await upsertRaw('raw.faturamento_itens', itens);
      totalItens += itens.length;
    }
  }

  return { notas: registros.length, itens: totalItens };
}

async function main() {
  const anoInicio = Number(process.argv[2]) || 2015;
  const anoFim = new Date().getFullYear();

  let totalNotas = 0;
  let totalItens = 0;
  for (let ano = anoInicio; ano <= anoFim; ano += 1) {
    const dataInicio = `${ano}-01-01`;
    const dataFim = `${ano + 1}-01-01`;
    const result = await carregarJanela(dataInicio, dataFim);
    totalNotas += result.notas;
    totalItens += result.itens;
    console.log(
      `[backfill-faturamento] ${ano}: ${result.notas} notas / ${result.itens} itens ` +
      `(total: ${totalNotas} notas / ${totalItens} itens)`
    );
  }
}

main()
  .catch((error) => {
    console.error('[backfill-faturamento] erro:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await oracle.closePool();
    await pg.pool.end();
  });
