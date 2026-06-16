'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfgs = require('../oracle-config');

async function sincronizarTabela(cfg, dominio, tabela, mapper) {
  const ultimoSync = await lerUltimoSync(dominio);
  let sql, rows;

  if (cfg.campoDataAlter) {
    sql = `SELECT * FROM ${cfg.schema}.${cfg.tabela} WHERE ${cfg.campoDataAlter} > :ultimoSync`;
    const result = await oracle.query(sql, { ultimoSync });
    rows = result.rows || [];
  } else {
    sql = `SELECT * FROM ${cfg.schema}.${cfg.tabela}`;
    const result = await oracle.query(sql, {});
    rows = result.rows || [];
  }

  if (!rows.length) return;

  const registros = rows.map(mapper);
  await upsertRaw(tabela, registros);
  await atualizarSync(dominio);
  console.log(`[${dominio}] ${registros.length} registros sincronizados`);
}

async function sincronizar() {
  // Filiais primeiro (outras tabelas dependem delas)
  await sincronizarTabela(
    cfgs.filiais, 'filiais', 'raw.filiais',
    (row) => ({
      id:     String(row[cfgs.filiais.campoId]),
      _dados: JSON.stringify(row),
      _source:'siagri',
    })
  );

  await sincronizarTabela(
    cfgs.clientes, 'clientes', 'raw.clientes',
    (row) => ({
      id:     String(row[cfgs.clientes.campoId]),
      _dados: JSON.stringify(row),
      _source:'siagri',
    })
  );

  await sincronizarTabela(
    cfgs.produtos, 'produtos', 'raw.produtos',
    (row) => ({
      id:          String(row[cfgs.produtos.campoId]),
      descricao:   row[cfgs.produtos.campoDescricao] || null,
      tipo:        row[cfgs.produtos.campoTipo] || null,
      _dados:      JSON.stringify(row),
      _source:     'siagri',
    })
  );

  await sincronizarTabela(
    cfgs.vendedores, 'vendedores', 'raw.vendedores',
    (row) => ({
      id:     String(row[cfgs.vendedores.campoId]),
      _dados: JSON.stringify(row),
      _source:'siagri',
    })
  );

  // Tipos de operação — necessário para filtrar faturamento por tran_top
  await sincronizarTabela(
    cfgs.operacoes, 'operacoes', 'raw.operacoes',
    (row) => ({
      id:          String(row[cfgs.operacoes.campoId]),
      descricao:   row[cfgs.operacoes.campoDesc] || null,
      status:      row[cfgs.operacoes.campoStatus] ? String(row[cfgs.operacoes.campoStatus]).trim() : null,
      tran_top:    row[cfgs.operacoes.campoTran] ? String(row[cfgs.operacoes.campoTran]).trim() : null,
      tipo_top:    row[cfgs.operacoes.campoTipo] ? String(row[cfgs.operacoes.campoTipo]).trim() : null,
      template_id: row[cfgs.operacoes.campoTemplate] ? String(row[cfgs.operacoes.campoTemplate]) : null,
      data_alteracao: row[cfgs.operacoes.campoDataAlter] || null,
      _dados:      JSON.stringify(row),
      _source:     'siagri',
    })
  );

  console.log('[dimensoes] sincronização concluída');
}

module.exports = { sincronizar };
