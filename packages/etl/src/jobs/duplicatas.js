'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg = require('../oracle-config').duplicatas;

// Sincroniza CABREC (cabeçalho) + RECEBER (parcelas).
// A linha gravada em raw.duplicatas = 1 parcela (RECEBER) com dados do CABREC embutidos no _dados.
async function sincronizar() {
  const ultimoSync = await lerUltimoSync('duplicatas');
  console.log(`[duplicatas] sync incremental desde ${ultimoSync.toISOString()}`);

  // Captura tudo que mudou no CABREC OU no RECEBER desde o último sync
  const sql = `
    SELECT
      CAB.${cfg.campoCabId}     AS CTRL_CBR,
      CAB.${cfg.campoCabFilial} AS CODI_EMP,
      CAB.${cfg.campoCabCliente}AS CODI_TRA,
      CAB.${cfg.campoCabData}   AS DATA_CBR,
      CAB.${cfg.campoCabTotal}  AS TOTA_CBR,
      CAB.${cfg.campoCabStatus} AS SITU_CBR,
      REC.${cfg.campoParcelaId} AS CTRL_REC,
      REC.${cfg.campoParcelaNr} AS NPAR_REC,
      REC.${cfg.campoParcelaVenc}   AS VENC_REC,
      REC.${cfg.campoParcelaValor}  AS VLOR_REC,
      REC.${cfg.campoParcelaStatus} AS SITU_REC,
      REC.${cfg.campoFlagAssina}    AS ACDU_REC,
      REC.${cfg.campoVendedor1}     AS COD1_PES,
      GREATEST(
        NVL(CAB.${cfg.campoCabDataAlter}, DATE '2000-01-01'),
        NVL(REC.${cfg.campoParcelaDataAlter}, DATE '2000-01-01')
      ) AS DT_ALTER
    FROM ${cfg.schema}.${cfg.tabelaCab} CAB
    JOIN ${cfg.schema}.${cfg.tabelaParcela} REC
      ON REC.${cfg.campoParcelaCabId} = CAB.${cfg.campoCabId}
    WHERE CAB.${cfg.campoCabDataAlter} > :ultimoSync
       OR REC.${cfg.campoParcelaDataAlter} > :ultimoSync
    ORDER BY DT_ALTER
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[duplicatas] sem registros novos');
    return;
  }

  const registros = rows.map((row) => ({
    id:              String(row.CTRL_REC),
    filial_id:       String(row.CODI_EMP ?? ''),
    nf_id:           row.CTRL_CBR ? String(row.CTRL_CBR) : null,
    data_emissao:    row.DATA_CBR || null,
    data_vencimento: row.VENC_REC || null,
    data_alteracao:  row.DT_ALTER || null,
    _dados:          JSON.stringify(row),
    _source:         'siagri',
  }));

  await upsertRaw('raw.duplicatas', registros);
  await atualizarSync('duplicatas');
  console.log(`[duplicatas] ${registros.length} parcelas sincronizadas`);
}

module.exports = { sincronizar };
