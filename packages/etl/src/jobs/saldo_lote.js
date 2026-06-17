'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync } = require('../upsert');
const pg = require('../db/postgres');

// Snapshot diário de saldo por lote.
// Usa a função Oracle SALDO_LOTE(EMP, PSV, LOTE, DATA, 'F', NULL) — mesmo nome
// que a versão Firebird. Uma única query Oracle retorna todos os resultados.
//
// Estratégia: REPLACE (truncate + insert) porque é um snapshot point-in-time.
// Não faz sentido incremental — o saldo de qualquer lote pode subir ou descer.
async function sincronizar() {
  console.log('[saldo_lote] calculando snapshot diário via SALDO_LOTE()...');

  // Uma única query que percorre DADOSPRO × LOTE e chama SALDO_LOTE para cada par.
  // Oracle executa as 30k chamadas internamente — muito mais eficiente do que
  // chamar uma a uma via Node.
  const sql = `
    SELECT
      D.CODI_EMP,
      D.CODI_PSV,
      P.DESC_PSV,
      G.CODI_GPR,
      G.DESC_GPR,
      L.LOTE_LOT,
      L.VALG_LOT,
      L.DTFA_LOT,
      L.TPRO_LOT,
      SYSDATE           AS DATA_REF,
      (SELECT QTDE FROM TABLE(SALDO_LOTE(
        D.CODI_EMP, D.CODI_PSV, L.LOTE_LOT, SYSDATE, 'F', NULL
      )))               AS SALDO
    FROM SULGOIANO.DADOSPRO D
    JOIN SULGOIANO.PRODSERV P ON P.CODI_PSV = D.CODI_PSV
    JOIN SULGOIANO.GRUPO    G ON G.CODI_GPR = P.CODI_GPR
    JOIN SULGOIANO.LOTE     L ON L.CODI_PSV = D.CODI_PSV
    WHERE L.SITU_LOT   = 'A'
      AND L.VALG_LOT   IS NOT NULL
      AND (SELECT QTDE FROM TABLE(SALDO_LOTE(
            D.CODI_EMP, D.CODI_PSV, L.LOTE_LOT, SYSDATE, 'F', NULL
          ))) > 0
  `;

  const result = await oracle.query(sql, {});
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[saldo_lote] nenhum lote com saldo positivo encontrado');
    return;
  }

  // Snapshot: limpa o dia anterior antes de inserir
  await pg.query('TRUNCATE TABLE raw.saldo_lote');

  const hoje = new Date().toISOString().slice(0, 10);

  const registros = rows.map((row) => ({
    id:              `${row.CODI_EMP}_${row.CODI_PSV}_${row.LOTE_LOT}`,
    filial_id:       String(row.CODI_EMP),
    produto_id:      String(row.CODI_PSV),
    produto_desc:    row.DESC_PSV || null,
    grupo_id:        row.CODI_GPR ? String(row.CODI_GPR) : null,
    grupo_desc:      row.DESC_GPR || null,
    lote:            String(row.LOTE_LOT),
    data_validade:   row.VALG_LOT || null,
    data_fabricacao: row.DTFA_LOT || null,
    tipo_lote:       row.TPRO_LOT ? String(row.TPRO_LOT).trim() : null,
    saldo:           row.SALDO ?? 0,
    data_referencia: hoje,
    _source:         'siagri',
  }));

  await upsertRaw('raw.saldo_lote', registros);
  await atualizarSync('saldo_lote');
  console.log(`[saldo_lote] ${registros.length} posições de lote com saldo positivo`);
}

module.exports = { sincronizar };
