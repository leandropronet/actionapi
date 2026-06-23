'use strict';
const oracle = require('../db/oracle');
const { upsertRawBatch } = require('../upsert');
const { abrirJanela, concluirJanela } = require('../incremental');
const cfg = require('../oracle-config').duplicatas;

// Sincroniza CABREC (cabeçalho) + RECEBER (parcelas).
// A linha gravada em raw.duplicatas = 1 parcela (RECEBER) com dados do CABREC embutidos no _dados.
async function sincronizar({ dataInicio, dataFim } = {}) {
  const incremental = !dataInicio && !dataFim;
  const janela = incremental ? await abrirJanela('duplicatas') : null;
  const condicoes = [];
  const binds = {};
  if (dataInicio) {
    condicoes.push(`CAB.${cfg.campoCabData} >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`);
    binds.dataInicio = dataInicio;
  }
  if (dataFim) {
    condicoes.push(`CAB.${cfg.campoCabData} < TO_DATE(:dataFim, 'YYYY-MM-DD')`);
    binds.dataFim = dataFim;
  }
  if (incremental) {
    condicoes.push(`(
      (
        CAB.${cfg.campoCabDataAlter} > :limiteInferior
        AND CAB.${cfg.campoCabDataAlter} <= :limiteSuperior
      )
      OR (
        REC.${cfg.campoParcelaDataAlter} > :limiteInferior
        AND REC.${cfg.campoParcelaDataAlter} <= :limiteSuperior
      )
    )`);
    binds.limiteInferior = janela.limiteInferior;
    binds.limiteSuperior = janela.limiteSuperior;
  }
  const where = condicoes.join(' AND ');
  console.log(
    `[duplicatas] ${incremental
      ? `janela ${janela.limiteInferior.toISOString()} a ${janela.limiteSuperior.toISOString()}`
      : `carga de ${dataInicio || 'início'} a ${dataFim || 'hoje'}`}`,
  );

  // Captura tudo que mudou no CABREC OU no RECEBER desde o último sync
  const sql = `
    SELECT
      CAB.${cfg.campoCabId}     AS CTRL_CBR,
      CAB.${cfg.campoCabFilial} AS CODI_EMP,
      CAB.${cfg.campoCabCliente} AS CODI_TRA,
      CAB.${cfg.campoCabData}   AS DATA_CBR,
      CAB.${cfg.campoCabTotal}  AS TOTA_CBR,
      CAB.${cfg.campoCabStatus} AS SITU_CBR,
      CAB.CODI_TDO,
      REC.${cfg.campoParcelaId} AS CTRL_REC,
      REC.${cfg.campoParcelaNr} AS NPAR_REC,
      REC.${cfg.campoParcelaVenc}   AS VENC_REC,
      REC.${cfg.campoParcelaValor}  AS VLOR_REC,
      REC.${cfg.campoParcelaStatus} AS SITU_REC,
      REC.${cfg.campoFlagAssina}    AS ACDU_REC,
      REC.${cfg.campoVendedor1}     AS COD1_PES,
      REC.CODI_IND,
      REC.EMPR_VLR,
      REC.DATA_VLR,
      REC.${cfg.campoHistorico} AS HISTORICO,
      GREATEST(
        NVL(CAB.${cfg.campoCabDataAlter}, DATE '2000-01-01'),
        NVL(REC.${cfg.campoParcelaDataAlter}, DATE '2000-01-01')
      ) AS DT_ALTER
    FROM ${cfg.schema}.${cfg.tabelaCab} CAB
    JOIN ${cfg.schema}.${cfg.tabelaParcela} REC
      ON REC.${cfg.campoParcelaCabId} = CAB.${cfg.campoCabId}
    WHERE ${where}
    ORDER BY DT_ALTER
  `;

  const result = await oracle.query(sql, binds);
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[duplicatas] sem registros novos');
    if (incremental) await concluirJanela('duplicatas', janela);
    return { registros: 0 };
  }

  const registros = rows.map((row) => ({
    id:              String(row.CTRL_REC),
    filial_id:       String(row.CODI_EMP ?? ''),
    nf_id:           row.CTRL_CBR ? String(row.CTRL_CBR) : null,
    tipo_documento:  row.CODI_TDO != null ? String(row.CODI_TDO) : null,
    data_emissao:    row.DATA_CBR || null,
    data_vencimento: row.VENC_REC || null,
    indexador_id: row.CODI_IND != null ? String(row.CODI_IND) : null,
    indexador_filial_id: row.EMPR_VLR != null ? String(row.EMPR_VLR) : null,
    data_indexador: row.DATA_VLR || null,
    data_alteracao:  row.DT_ALTER || null,
    _dados:          JSON.stringify(row),
    _source:         'siagri',
  }));

  await upsertRawBatch('raw.duplicatas', registros);
  if (incremental) await concluirJanela('duplicatas', janela);
  console.log(`[duplicatas] ${registros.length} parcelas sincronizadas`);
  return { registros: registros.length };
}

module.exports = { sincronizar };
