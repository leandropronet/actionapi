'use strict';
/**
 * Recarrega NF-e de entrada (NFENTRA + INFENTRA) por data de emissão.
 *
 * Uso:
 *   node src/scripts/backfill-nfe-entrada.js [anoInicio]
 *   npm run nfe-entrada:backfill -- 2015
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
const cfg = require('../oracle-config').nfentra;
const cfgOp = require('../oracle-config').operacoes;

async function carregarJanela(dataInicio, dataFim) {
  const sql = `
    SELECT
      N.${cfg.campoId}          AS CTRL_NFE,
      N.${cfg.campoFilial}      AS CODI_EMP,
      N.${cfg.campoParceiro}    AS CODI_TRA,
      N.${cfg.campoOperacao}    AS CODI_TOP,
      N.${cfg.campoModelo}      AS CODI_MDF,
      N.${cfg.campoNumero}      AS NUME_NFE,
      N.${cfg.campoSerie}       AS SERI_NFE,
      N.${cfg.campoDataEmissao} AS DEMI_NFE,
      N.${cfg.campoDataReceb}   AS DREC_NFE,
      N.${cfg.campoTotal}       AS TPRO_NFE,
      N.${cfg.campoChave}       AS CHAV_NFE,
      N.${cfg.campoVendedor}    AS COD1_PES,
      N.TOTA_NFE,
      N.FRET_NFE,
      N.FRE2_NFE,
      N.DSAC_NFE,
      N.BICM_NFE,
      N.VICM_NFE,
      N.TIPI_NFE,
      N.VRCS_NFE,
      N.VLIR_NFE,
      N.VISS_NFE,
      N.PROP_PRO,
      N.${cfg.campoDataAlter}   AS DUMANUT,
      T.${cfgOp.campoTran}      AS TRAN_TOP,
      T.${cfgOp.campoTipo}      AS TIPO_TOP,
      T.${cfgOp.campoDesc}      AS DESC_TOP,
      T.${cfgOp.campoTemplate}  AS CODI_TPL
    FROM ${cfg.schema}.${cfg.tabela} N
    LEFT JOIN ${cfgOp.schema}.${cfgOp.tabela} T
      ON T.${cfgOp.campoId} = N.${cfg.campoOperacao}
    WHERE N.${cfg.campoDataEmissao} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
      AND N.${cfg.campoDataEmissao} <  TO_DATE(:dataFim, 'YYYY-MM-DD')
    ORDER BY N.${cfg.campoDataEmissao}
  `;

  const result = await oracle.query(sql, { dataInicio, dataFim });
  const rows = result.rows || [];
  if (!rows.length) return { cabecalhos: 0, itens: 0 };

  const registros = rows.map((row) => ({
    id: String(row.CTRL_NFE),
    filial_id: String(row.CODI_EMP ?? ''),
    operacao_id: row.CODI_TOP ? String(row.CODI_TOP) : null,
    data_emissao: row.DEMI_NFE || null,
    data_recebimento: row.DREC_NFE || null,
    data_alteracao: row.DUMANUT || null,
    _dados: JSON.stringify(row),
    _source: 'siagri',
  }));

  await upsertRaw('raw.nfe_entrada', registros);

  let totalItens = 0;
  const ids = rows.map((row) => row.CTRL_NFE).filter(Boolean);
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const placeholders = chunk.map((_, j) => `:id${j}`).join(', ');
    const bindIds = Object.fromEntries(chunk.map((id, j) => [`id${j}`, id]));

    const sqlItens = `
      SELECT *
      FROM ${cfg.schema}.${cfg.tabelaItens}
      WHERE ${cfg.campoItemNfeId} IN (${placeholders})
    `;
    const resultItens = await oracle.query(sqlItens, bindIds);
    const itens = (resultItens.rows || []).map((row) => ({
      id: `${row[cfg.campoItemNfeId]}_${row[cfg.campoItemSeq]}`,
      nfe_entrada_id: String(row[cfg.campoItemNfeId]),
      produto_id: row[cfg.campoItemProduto] ? String(row[cfg.campoItemProduto]) : null,
      operacao_id: row[cfg.campoItemOperacao] ? String(row[cfg.campoItemOperacao]) : null,
      data_recebimento: row[cfg.campoItemDrec] || null,
      _dados: JSON.stringify(row),
      _source: 'siagri',
    }));
    if (itens.length) {
      await upsertRaw('raw.nfe_entrada_itens', itens);
      totalItens += itens.length;
    }
  }

  return { cabecalhos: registros.length, itens: totalItens };
}

async function main() {
  const anoInicio = Number(process.argv[2]) || 2015;
  const anoFim = new Date().getFullYear();

  let totalCabecalhos = 0;
  let totalItens = 0;
  for (let ano = anoInicio; ano <= anoFim; ano += 1) {
    const dataInicio = `${ano}-01-01`;
    const dataFim = `${ano + 1}-01-01`;
    const result = await carregarJanela(dataInicio, dataFim);
    totalCabecalhos += result.cabecalhos;
    totalItens += result.itens;
    console.log(
      `[backfill-nfe-entrada] ${ano}: ${result.cabecalhos} NF-e / ${result.itens} itens ` +
      `(total: ${totalCabecalhos} NF-e / ${totalItens} itens)`
    );
  }
}

main()
  .catch((error) => {
    console.error('[backfill-nfe-entrada] erro:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await oracle.closePool();
    await pg.pool.end();
  });
