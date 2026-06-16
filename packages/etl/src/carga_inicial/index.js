'use strict';
require('dotenv').config();
const pg = require('../db/postgres');

// Importa os módulos de cada domínio
const faturamento = require('./faturamento');
const duplicatas  = require('./duplicatas');
const pedidos     = require('./pedidos');
const financeiro  = require('./financeiro');
const contabil    = require('./contabil');
const dimensoes   = require('./dimensoes');

const ANOS = Number(process.env.CARGA_INICIAL_ANOS) || 5;

// Gera janelas mensais a partir de hoje retroagindo N anos
function gerarJanelas(anos) {
  const janelas = [];
  const hoje = new Date();
  for (let i = 0; i < anos * 12; i++) {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const fim    = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
    janelas.push({
      inicio: inicio.toISOString().slice(0, 10),
      fim:    fim.toISOString().slice(0, 10),
    });
  }
  return janelas.reverse(); // cronológico
}

// Registra janelas pendentes em etl_carga_inicial (se ainda não existirem)
async function prepararJanelas(dominio, filiais, janelas) {
  for (const filial of filiais) {
    for (const j of janelas) {
      await pg.query(
        `INSERT INTO etl_carga_inicial (dominio, filial_id, janela_inicio, janela_fim, status)
         VALUES ($1, $2, $3, $4, 'pendente')
         ON CONFLICT (dominio, filial_id, janela_inicio) DO NOTHING`,
        [dominio, filial, j.inicio, j.fim]
      );
    }
  }
}

async function carregarFiliais() {
  const res = await pg.query(`SELECT id FROM raw.filiais`);
  if (!res.rows.length) {
    console.warn('[carga_inicial] Nenhuma filial encontrada no raw.filiais.');
    console.warn('               Rode primeiro: node src/jobs/dimensoes.js');
    return [];
  }
  return res.rows.map((r) => r.id);
}

async function executarDominio(dominio, fn) {
  const janelas_pendentes = await pg.query(
    `SELECT id, filial_id, janela_inicio, janela_fim
     FROM etl_carga_inicial
     WHERE dominio = $1 AND status = 'pendente'
     ORDER BY janela_inicio, filial_id`,
    [dominio]
  );

  const pendentes = janelas_pendentes.rows;
  if (!pendentes.length) {
    console.log(`[${dominio}] carga inicial já concluída ou sem janelas pendentes`);
    return;
  }

  console.log(`[${dominio}] ${pendentes.length} janelas pendentes`);

  for (const j of pendentes) {
    await pg.query(
      `UPDATE etl_carga_inicial SET status='em_progresso', iniciado_em=NOW() WHERE id=$1`,
      [j.id]
    );
    try {
      const count = await fn(j.filial_id, j.janela_inicio, j.janela_fim);
      await pg.query(
        `UPDATE etl_carga_inicial SET status='concluido', registros=$1, concluido_em=NOW() WHERE id=$2`,
        [count, j.id]
      );
      console.log(`[${dominio}] filial=${j.filial_id} ${j.janela_inicio}→${j.janela_fim}: ${count} registros`);
    } catch (err) {
      await pg.query(
        `UPDATE etl_carga_inicial SET status='erro', erro=$1 WHERE id=$2`,
        [err.message, j.id]
      );
      console.error(`[${dominio}] ERRO filial=${j.filial_id} ${j.janela_inicio}: ${err.message}`);
    }
  }
}

async function main() {
  console.log(`=== CARGA INICIAL (${ANOS} anos) ===`);

  // 1. Carrega dimensões primeiro (filiais, produtos, clientes, vendedores)
  console.log('\n[1/6] Carregando dimensões...');
  await dimensoes.sincronizar();

  const filiais = await carregarFiliais();
  if (!filiais.length) {
    console.error('Abortando: sem filiais.');
    process.exit(1);
  }
  console.log(`Filiais encontradas: ${filiais.join(', ')}`);

  const janelas = gerarJanelas(ANOS);

  // 2. Prepara janelas para todos os domínios
  for (const dom of ['faturamento', 'duplicatas', 'pedidos', 'financeiro_cp', 'financeiro_cr', 'contabil']) {
    await prepararJanelas(dom, filiais, janelas);
  }

  // 3. Executa carga de cada domínio
  console.log('\n[2/6] Faturamento...');
  await executarDominio('faturamento', faturamento.carregarJanela);

  console.log('\n[3/6] Duplicatas...');
  await executarDominio('duplicatas', duplicatas.carregarJanela);

  console.log('\n[4/6] Pedidos...');
  await executarDominio('pedidos', pedidos.carregarJanela);

  console.log('\n[5/6] Financeiro (CP + CR)...');
  await executarDominio('financeiro_cp', financeiro.carregarJanelaCp);
  await executarDominio('financeiro_cr', financeiro.carregarJanelaCr);

  console.log('\n[6/6] Contábil...');
  await executarDominio('contabil', contabil.carregarJanela);

  console.log('\n=== CARGA INICIAL CONCLUÍDA ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
