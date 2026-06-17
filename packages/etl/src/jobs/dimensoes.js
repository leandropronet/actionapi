'use strict';
const oracle = require('../db/oracle');
const { upsertRaw, atualizarSync, lerUltimoSync } = require('../upsert');
const cfgs = require('../oracle-config');

async function sincronizarTabela(cfg, dominio, tabela, mapper) {
  const ultimoSync = await lerUltimoSync(dominio);
  const extra = cfg.filtroExtra || '';
  let sql, rows;

  if (cfg.campoDataAlter) {
    sql = `SELECT * FROM ${cfg.schema}.${cfg.tabela} WHERE ${cfg.campoDataAlter} > :ultimoSync ${extra}`;
    const result = await oracle.query(sql, { ultimoSync });
    rows = result.rows || [];
  } else {
    sql = `SELECT * FROM ${cfg.schema}.${cfg.tabela} WHERE 1=1 ${extra}`;
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

  // Clientes reais = TRANSAC com JOIN em CLIENTE (exclui fornecedores, transportadoras, etc.)
  // Incremental: captura alterações em TRANSAC OU em CLIENTE via DUMANUT de ambas
  {
    const ultimoSync = await lerUltimoSync('clientes');
    const sql = `
      SELECT T.*
      FROM ${cfgs.clientes.schema}.${cfgs.clientes.tabela} T
      INNER JOIN ${cfgs.clientes.schema}.${cfgs.clientes.tabelaCliente} C
        ON C.${cfgs.clientes.campoClienteTra} = T.${cfgs.clientes.campoId}
      WHERE T.${cfgs.clientes.campoDataAlter} > :ultimoSync
         OR C.DUMANUT > :ultimoSync
    `;
    const result = await oracle.query(sql, { ultimoSync });
    const rows = result.rows || [];
    if (rows.length) {
      const registros = rows.map((row) => ({
        id:          String(row[cfgs.clientes.campoId]),
        razao_social: row[cfgs.clientes.campoRazao]    || null,
        cgc_cnpj:    row[cfgs.clientes.campoCpfCnpj]  || null,
        status:      row.SITU_TRA ? String(row.SITU_TRA).trim() : null,
        _dados:      JSON.stringify(row),
        _source:     'siagri',
      }));
      await upsertRaw('raw.clientes', registros);
      await atualizarSync('clientes');
      console.log(`[clientes] ${registros.length} registros sincronizados`);
    }
  }

  // Produtos: ativos (SITU_PSV='A') e tipo P=Produto ou K=Kit
  // B=Bem, U=Uso/Consumo, S=Serviço excluídos por ora
  await sincronizarTabela(
    { ...cfgs.produtos, filtroExtra: `AND ${cfgs.produtos.campoStatus} = 'A' AND ${cfgs.produtos.campoTipo} IN ('P','K')` },
    'produtos', 'raw.produtos',
    (row) => ({
      id:        String(row[cfgs.produtos.campoId]),
      descricao: row[cfgs.produtos.campoDescricao] || null,
      tipo:      row[cfgs.produtos.campoTipo] ? String(row[cfgs.produtos.campoTipo]).trim() : null,
      _dados:    JSON.stringify(row),
      _source:   'siagri',
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

  // Propriedades rurais (PROPRIED) — apenas ativas
  await sincronizarTabela(
    { ...cfgs.propriedades, filtroExtra: `AND ${cfgs.propriedades.campoStatus} = 'A'` },
    'propriedades', 'raw.propriedades',
    (row) => ({
      id:            String(row[cfgs.propriedades.campoId]),
      cliente_id:    row[cfgs.propriedades.campoCliente] ? String(row[cfgs.propriedades.campoCliente]) : null,
      descricao:     row[cfgs.propriedades.campoDesc] || null,
      area:          row[cfgs.propriedades.campoArea] ?? null,
      status:        row[cfgs.propriedades.campoStatus] ? String(row[cfgs.propriedades.campoStatus]).trim() : null,
      data_alteracao:row[cfgs.propriedades.campoDataAlter] || null,
      _dados:        JSON.stringify(row),
      _source:       'siagri',
    })
  );

  // Vendedor por propriedade/filial (VENDEDORPROPRIED)
  await sincronizarTabela(
    cfgs.propriedadesVendedor, 'propriedades_vendedor', 'raw.propriedades_vendedor',
    (row) => ({
      id:             `${row[cfgs.propriedadesVendedor.campoPropId]}_${row[cfgs.propriedadesVendedor.campoFilial]}`,
      propriedade_id: String(row[cfgs.propriedadesVendedor.campoPropId]),
      filial_id:      String(row[cfgs.propriedadesVendedor.campoFilial]),
      vendedor1_id:   row[cfgs.propriedadesVendedor.campoVendedor1] ? String(row[cfgs.propriedadesVendedor.campoVendedor1]) : null,
      vendedor2_id:   row[cfgs.propriedadesVendedor.campoVendedor2] ? String(row[cfgs.propriedadesVendedor.campoVendedor2]) : null,
      data_alteracao: row[cfgs.propriedadesVendedor.campoDataAlter] || null,
      _dados:         JSON.stringify(row),
      _source:        'siagri',
    })
  );

  // Princípios ativos ERP — PRINATIVOS (212 registros, full refresh)
  await sincronizarTabela(
    cfgs.prinativos, 'principios_ativos', 'raw.principios_ativos',
    (row) => ({
      id:        String(row[cfgs.prinativos.campoId]),
      descricao: row[cfgs.prinativos.campoDesc] || null,
      status:    row[cfgs.prinativos.campoStatus] ? String(row[cfgs.prinativos.campoStatus]).trim() : null,
      _dados:    JSON.stringify(row),
      _source:   'siagri',
    })
  );

  // Princípios ativos do receituário — PRINCIPIOATIVO_REC (2.352 registros, DESC_PRA é CLOB)
  await sincronizarTabela(
    cfgs.principiosAtivosRec, 'principios_ativos_rec', 'raw.principios_ativos_rec',
    (row) => ({
      id:           String(row[cfgs.principiosAtivosRec.campoId]),
      descricao:    row[cfgs.principiosAtivosRec.campoDesc] || null,
      concentracao: row[cfgs.principiosAtivosRec.campoConc] ?? null,
      status:       row[cfgs.principiosAtivosRec.campoStatus] ? String(row[cfgs.principiosAtivosRec.campoStatus]).trim() : null,
      _dados:       JSON.stringify(row),
      _source:      'siagri',
    })
  );

  // Vínculo produto ↔ PA do receituário — resolve CODI_PSV no ETL via JOIN com PRODUTO
  // Cadeia: PRODSERV.CODI_PSV → PRODUTO.CODI_PRR → PRODPRIATIVO_REC.CODI_PRR → PRINCIPIOATIVO_REC.CODI_PRA
  {
    const ultimoSync = await lerUltimoSync('produto_principio_ativo_rec');
    const sql = `
      SELECT PP.CODI_PDA, PS.CODI_PSV, PP.CODI_PRA
      FROM ${cfgs.produtoPrincipioAtivoRec.schema}.PRODPRIATIVO_REC PP
      JOIN ${cfgs.produtoPrincipioAtivoRec.schema}.PRODUTO PT ON PT.CODI_PRR = PP.CODI_PRR
      JOIN ${cfgs.produtoPrincipioAtivoRec.schema}.PRODSERV PS ON PS.CODI_PSV = PT.CODI_PSV
      WHERE PP.DUMANUT > :ultimoSync
    `;
    const result = await oracle.query(sql, { ultimoSync });
    const rows = result.rows || [];
    if (rows.length) {
      const registros = rows.map((row) => ({
        id:           String(row.CODI_PDA),
        produto_id:   String(row.CODI_PSV),
        principio_id: String(row.CODI_PRA),
        _dados:       JSON.stringify(row),
        _source:      'siagri',
      }));
      await upsertRaw('raw.produto_principio_ativo_rec', registros);
      await atualizarSync('produto_principio_ativo_rec');
      console.log(`[produto_principio_ativo_rec] ${registros.length} vínculos sincronizados`);
    }
  }

  // Grupos de produto (Defensivos, Sementes, Adubos...)
  await sincronizarTabela(
    cfgs.grupos, 'grupos', 'raw.grupos',
    (row) => ({
      id:       String(row[cfgs.grupos.campoId]),
      descricao: row[cfgs.grupos.campoDesc] || null,
      status:   row[cfgs.grupos.campoStatus] ? String(row[cfgs.grupos.campoStatus]).trim() : null,
      data_alteracao: row[cfgs.grupos.campoDataAlter] || null,
      _dados:   JSON.stringify(row),
      _source:  'siagri',
    })
  );

  // Produto por filial — estoque mínimo/máximo e localização
  await sincronizarTabela(
    cfgs.dadospro, 'dadospro', 'raw.dadospro',
    (row) => ({
      id:           `${row[cfgs.dadospro.campoFilial]}_${row[cfgs.dadospro.campoProduto]}`,
      filial_id:    String(row[cfgs.dadospro.campoFilial]),
      produto_id:   String(row[cfgs.dadospro.campoProduto]),
      est_min:      row[cfgs.dadospro.campoEstMin] ?? null,
      est_max:      row[cfgs.dadospro.campoEstMax] ?? null,
      status:       row[cfgs.dadospro.campoStatus] ? String(row[cfgs.dadospro.campoStatus]).trim() : null,
      locacao:      row[cfgs.dadospro.campoLocacao] || null,
      data_alteracao: row[cfgs.dadospro.campoDataAlter] || null,
      _dados:       JSON.stringify(row),
      _source:      'siagri',
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

  // Cabeçalho das parametrizações (PARTOPER): código 102 = "VENDAS - DEVOLUCAO"
  await sincronizarTabela(
    cfgs.partoper, 'param_oper', 'raw.param_oper',
    (row) => ({
      id:        String(row[cfgs.partoper.campoId]),
      descricao: row[cfgs.partoper.campoDesc] || null,
      tipo:      row[cfgs.partoper.campoTipo] ? String(row[cfgs.partoper.campoTipo]).trim() : null,
      data_alteracao: row.DUMANUT || null,
      _dados:    JSON.stringify(row),
      _source:   'siagri',
    })
  );

  // Detalhe das parametrizações (FUNCAOTOPER): CODI_TOP → A=Adicionar / S=Subtrair
  await sincronizarTabela(
    cfgs.funcaotoper, 'param_oper_detalhe', 'raw.param_oper_detalhe',
    (row) => ({
      id:          `${row[cfgs.funcaotoper.campoParamId]}_${row[cfgs.funcaotoper.campoOperId]}`,
      param_id:    String(row[cfgs.funcaotoper.campoParamId]),
      operacao_id: String(row[cfgs.funcaotoper.campoOperId]),
      funcao:      row[cfgs.funcaotoper.campoFuncao] ? String(row[cfgs.funcaotoper.campoFuncao]).trim() : null,
      data_alteracao: row.DUMANUT || null,
      _dados:      JSON.stringify(row),
      _source:     'siagri',
    })
  );

  console.log('[dimensoes] sincronização concluída');
}

module.exports = { sincronizar };
