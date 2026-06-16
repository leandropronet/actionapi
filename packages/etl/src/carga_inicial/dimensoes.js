'use strict';
const oracle = require('../db/oracle');
const { upsertRaw } = require('../upsert');
const cfgs = require('../oracle-config');

async function carregarTabela(cfg, tabela, mapper) {
  const result = await oracle.query(`SELECT * FROM ${cfg.tabela}`, {});
  const rows = result.rows || [];
  if (!rows.length) return 0;
  const registros = rows.map(mapper);
  await upsertRaw(tabela, registros);
  return registros.length;
}

async function sincronizar() {
  let total = 0;

  total += await carregarTabela(cfgs.filiais, 'raw.filiais', (row) => ({
    id: String(row[cfgs.filiais.campoId]), _dados: JSON.stringify(row), _source: 'siagri',
  }));
  console.log(`[dimensoes] filiais: ${total}`);

  let n = await carregarTabela(cfgs.clientes, 'raw.clientes', (row) => ({
    id: String(row[cfgs.clientes.campoId]), _dados: JSON.stringify(row), _source: 'siagri',
  }));
  console.log(`[dimensoes] clientes: ${n}`);

  n = await carregarTabela(cfgs.produtos, 'raw.produtos', (row) => ({
    id: String(row[cfgs.produtos.campoId]), _dados: JSON.stringify(row), _source: 'siagri',
  }));
  console.log(`[dimensoes] produtos: ${n}`);

  n = await carregarTabela(cfgs.vendedores, 'raw.vendedores', (row) => ({
    id: String(row[cfgs.vendedores.campoId]), _dados: JSON.stringify(row), _source: 'siagri',
  }));
  console.log(`[dimensoes] vendedores: ${n}`);
}

module.exports = { sincronizar };
