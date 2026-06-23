'use strict';
/**
 * jobs/contabil.js
 *
 * Sincroniza lançamentos contábeis e as tabelas de desdobramento vinculadas.
 *
 * Tabelas sincronizadas:
 *   raw.contabil    — CABLANCTB + LANCONTAB (uma linha por partida D/C)
 *   raw.ccustolan   — CCUSTOLAN (desdobramento por centro de custo)
 *   raw.corlanpes   — CORLANPES (desdobramento por pessoa — custo de RH)
 *
 * Frequência padrão: diária às 01:00 (CRON_CONTABIL)
 *
 * Reconciliação automática (executada após o sync incremental):
 *   Compara IDs Oracle × PostgreSQL para o ano corrente e o anterior.
 *   Registros em PG que não existem mais no Oracle são excluídos automaticamente.
 *   Isso garante fidelidade mesmo quando o ERP deleta ou renumera lançamentos.
 */
const oracle = require('../db/oracle');
const pg     = require('../db/postgres');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfg    = require('../oracle-config').contabil;
const cfgCC  = require('../oracle-config').ccustolan;
const cfgPes = require('../oracle-config').corlanpes;

// CABLANCTB (cabeçalho) + LANCONTAB (partidas D/C)
// Uma linha em raw.contabil = uma partida contábil com dados do cabeçalho embutidos.
async function sincronizar() {
  const ultimoSync = await lerUltimoSync('contabil');
  console.log(`[contabil] sync incremental desde ${ultimoSync.toISOString()}`);

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
    WHERE CAB.${cfg.campoCabDataAlter} > :ultimoSync
    ORDER BY CAB.${cfg.campoCabDataAlter}
  `;

  const result = await oracle.query(sql, { ultimoSync });
  const rows = result.rows || [];

  if (!rows.length) {
    console.log('[contabil] sem registros novos');
    return;
  }

  const registros = rows.map((row) => {
    // Competência derivada da data do lançamento
    const dt = row.DATA_CLC;
    let competencia = null;
    if (dt instanceof Date) {
      competencia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }

    return {
      // PK = cabeçalho + partida (um lançamento pode ter várias partidas)
      id:              `${row.SEQU_CLC}_${row.SEQU_LCT}`,
      // CABLANCTB.CODI_EMP fica vazio em ~98% dos lançamentos; LANCONTAB.CODI_EMP
      // é preenchido em 100% das partidas desde 2020 e nunca diverge do cabeçalho
      // quando este também está preenchido (validado em 2026-06) — por isso prevalece.
      filial_id:       String(row.CODI_EMP_LCT ?? row.CODI_EMP ?? ''),
      data_lancamento: row.DATA_CLC || null,
      competencia,
      data_alteracao:  row.DUMANUT || null,
      _dados:          JSON.stringify(row),
      _source:         'siagri',
    };
  });

  await upsertRaw('raw.contabil', registros);
  await atualizarSync('contabil');
  console.log(`[contabil] ${registros.length} partidas sincronizadas`);

  // ── CCUSTOLAN: desdobramento por centro de custo ──────────────────────────
  // Cada partida pode ser rateada em vários CCs — PK composta SEQU_LCT + CODI_CCU
  const ultimoSyncCC = await lerUltimoSync('ccustolan');
  console.log(`[ccustolan] sync incremental desde ${ultimoSyncCC.toISOString()}`);

  const sqlCC = `
    SELECT
      ${cfgCC.campoLancId}     AS SEQU_LCT,
      ${cfgCC.campoCCusto}     AS CODI_CCU,
      ${cfgCC.campoPlanoConta} AS CODI_PLC,
      ${cfgCC.campoValor}      AS VLOR_LCT,
      ${cfgCC.campoDataAlter}  AS DUMANUT
    FROM ${cfgCC.schema}.${cfgCC.tabela}
    WHERE ${cfgCC.campoDataAlter} > :ultimoSync
    ORDER BY ${cfgCC.campoDataAlter}
  `;

  const resCC = await oracle.query(sqlCC, { ultimoSync: ultimoSyncCC });
  const rowsCC = resCC.rows || [];

  if (rowsCC.length) {
    const registrosCC = rowsCC.map((row) => ({
      id:            `${row.SEQU_LCT}_${row.CODI_CCU}`,
      lancamento_id: String(row.SEQU_LCT),
      ccusto_id:     String(row.CODI_CCU),
      plano_id:      row.CODI_PLC ? String(row.CODI_PLC) : null,
      valor:         row.VLOR_LCT ?? null,
      data_alteracao: row.DUMANUT || null,
      _source:       'siagri',
    }));
    await upsertRaw('raw.ccustolan', registrosCC);
    await atualizarSync('ccustolan');
    console.log(`[ccustolan] ${registrosCC.length} rateios por CC sincronizados`);
  } else {
    console.log('[ccustolan] sem alterações');
  }

  // ── CORLANPES: desdobramento por pessoa (custo de RH) ────────────────────
  // Vincula o lançamento de folha ao colaborador — PK composta SEQU_LCT + CODI_PES
  const ultimoSyncPes = await lerUltimoSync('corlanpes');
  console.log(`[corlanpes] sync incremental desde ${ultimoSyncPes.toISOString()}`);

  const sqlPes = `
    SELECT
      ${cfgPes.campoLancId}    AS SEQU_LCT,
      ${cfgPes.campoPessoa}    AS CODI_PES,
      ${cfgPes.campoValor}     AS VLOR_LCT,
      ${cfgPes.campoDataAlter} AS DUMANUT
    FROM ${cfgPes.schema}.${cfgPes.tabela}
    WHERE ${cfgPes.campoDataAlter} > :ultimoSync
    ORDER BY ${cfgPes.campoDataAlter}
  `;

  const resPes = await oracle.query(sqlPes, { ultimoSync: ultimoSyncPes });
  const rowsPes = resPes.rows || [];

  if (rowsPes.length) {
    const registrosPes = rowsPes.map((row) => ({
      id:            `${row.SEQU_LCT}_${row.CODI_PES}`,
      lancamento_id: String(row.SEQU_LCT),
      pessoa_id:     String(row.CODI_PES),
      valor:         row.VLOR_LCT ?? null,
      data_alteracao: row.DUMANUT || null,
      _source:       'siagri',
    }));
    await upsertRaw('raw.corlanpes', registrosPes);
    await atualizarSync('corlanpes');
    console.log(`[corlanpes] ${registrosPes.length} rateios por pessoa sincronizados`);
  } else {
    console.log('[corlanpes] sem alterações');
  }
}

/**
 * reconciliar()
 *
 * Compara IDs entre Oracle e PostgreSQL para o ano corrente e o anterior.
 * Exclui do PG qualquer partida que não existe mais no Oracle — cobre casos
 * de deleção direta, renumeração de lançamentos e refazimento de encerramentos.
 *
 * Executada automaticamente após sincronizar(). Pode ser chamada manualmente
 * para forçar uma conferência pontual.
 */
async function reconciliar() {
  const anoAtual    = new Date().getFullYear();
  const anoAnterior = anoAtual - 1;
  // Janela: 1/Jan do ano anterior até hoje (cobre ajustes de encerramento tardio).
  // Usa string ISO para evitar conversão de timezone no bind Oracle: ambos os lados
  // usam exatamente a mesma data-limite, sem buffer.
  const dataCorteStr = `${anoAnterior}-01-01`;

  console.log(`[contabil] reconciliando ${anoAnterior}–${anoAtual}...`);

  // ── 1. Buscar todos os IDs do Oracle para a janela ────────────────────────
  const resOracle = await oracle.query(
    `SELECT TO_CHAR(CAB.${cfg.campoCabId}) || '_' || TO_CHAR(LCT.${cfg.campoLancId}) AS ID
     FROM ${cfg.schema}.${cfg.tabelaCab} CAB
     JOIN ${cfg.schema}.${cfg.tabelaLanc} LCT
       ON LCT.${cfg.campoLancCabId} = CAB.${cfg.campoCabId}
     WHERE CAB.${cfg.campoCabData} >= TO_DATE(:dataCorte, 'YYYY-MM-DD')`,
    { dataCorte: dataCorteStr },
  );
  const oracleIds = new Set(resOracle.rows.map((r) => r.ID));

  // ── 2. Buscar todos os IDs do PG para a mesma janela ─────────────────────
  // Mesma data-limite de ambos os lados — sem buffer — para não deletar
  // registros legítimos com data_lancamento = último dia do ano anterior.
  const resPg = await pg.query(
    `SELECT id FROM raw.contabil WHERE data_lancamento >= $1`,
    [dataCorteStr],
  );

  // ── 3. Identificar órfãos (IDs em PG que não existem mais no Oracle) ──────
  const orfaos = resPg.rows.map((r) => r.id).filter((id) => !oracleIds.has(id));

  if (!orfaos.length) {
    console.log('[contabil] reconciliação: nenhum registro órfão');
    return;
  }

  // ── 4. Excluir órfãos do PG em lotes de 1000 ─────────────────────────────
  const LOTE = 1000;
  let totalExcluidos = 0;
  for (let i = 0; i < orfaos.length; i += LOTE) {
    const lote = orfaos.slice(i, i + LOTE);
    await pg.query('DELETE FROM raw.contabil WHERE id = ANY($1)', [lote]);
    totalExcluidos += lote.length;
  }
  console.log(`[contabil] reconciliação: ${totalExcluidos} registros órfãos excluídos`);
}

async function sincronizarComReconciliacao() {
  await sincronizar();
  await reconciliar();
}

module.exports = { sincronizar: sincronizarComReconciliacao, reconciliar };
