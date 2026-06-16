'use strict';
const pg = require('../db/postgres');
const cfgs = require('../oracle-config');

// Atualiza dimensões analytics a partir do schema raw
async function atualizarDimensoes() {
  const cfgF = cfgs.filiais;
  await pg.query(`
    INSERT INTO analytics.dim_filial (filial_id, nome, cnpj, uf, municipio, _sync_at)
    SELECT
      id,
      _dados->>'${cfgF.campoNome}'    AS nome,
      _dados->>'${cfgF.campoCnpj}'    AS cnpj,
      _dados->>'${cfgF.campoUf}'      AS uf,
      _dados->>'${cfgF.campoMunicipio}' AS municipio,
      NOW()
    FROM raw.filiais
    ON CONFLICT (filial_id) DO UPDATE SET
      nome       = EXCLUDED.nome,
      cnpj       = EXCLUDED.cnpj,
      uf         = EXCLUDED.uf,
      municipio  = EXCLUDED.municipio,
      _sync_at   = NOW()
  `);

  const cfgC = cfgs.clientes;
  await pg.query(`
    INSERT INTO analytics.dim_cliente (cliente_id, razao_social, nome_fantasia, cpf_cnpj, tipo, uf, municipio, vendedor_id, _sync_at)
    SELECT
      id,
      _dados->>'${cfgC.campoRazao}'    AS razao_social,
      _dados->>'${cfgC.campoFantasia}' AS nome_fantasia,
      _dados->>'${cfgC.campoCpfCnpj}'  AS cpf_cnpj,
      _dados->>'${cfgC.campoTipo}'     AS tipo,
      _dados->>'${cfgC.campoUf}'       AS uf,
      _dados->>'${cfgC.campoMunicipio}' AS municipio,
      _dados->>'${cfgC.campoVendedor}' AS vendedor_id,
      NOW()
    FROM raw.clientes
    ON CONFLICT (cliente_id) DO UPDATE SET
      razao_social  = EXCLUDED.razao_social,
      nome_fantasia = EXCLUDED.nome_fantasia,
      cpf_cnpj      = EXCLUDED.cpf_cnpj,
      tipo          = EXCLUDED.tipo,
      uf            = EXCLUDED.uf,
      municipio     = EXCLUDED.municipio,
      vendedor_id   = EXCLUDED.vendedor_id,
      _sync_at      = NOW()
  `);

  const cfgP = cfgs.produtos;
  await pg.query(`
    INSERT INTO analytics.dim_produto (produto_id, descricao, unidade, familia, categoria, grupo, _sync_at)
    SELECT
      id,
      _dados->>'${cfgP.campoDescricao}' AS descricao,
      _dados->>'${cfgP.campoUnidade}'   AS unidade,
      _dados->>'${cfgP.campoFamilia}'   AS familia,
      _dados->>'${cfgP.campoCategoria}' AS categoria,
      _dados->>'${cfgP.campoGrupo}'     AS grupo,
      NOW()
    FROM raw.produtos
    ON CONFLICT (produto_id) DO UPDATE SET
      descricao  = EXCLUDED.descricao,
      unidade    = EXCLUDED.unidade,
      familia    = EXCLUDED.familia,
      categoria  = EXCLUDED.categoria,
      grupo      = EXCLUDED.grupo,
      _sync_at   = NOW()
  `);

  const cfgV = cfgs.vendedores;
  await pg.query(`
    INSERT INTO analytics.dim_vendedor (vendedor_id, nome, equipe, regiao, _sync_at)
    SELECT
      id,
      _dados->>'${cfgV.campoNome}'   AS nome,
      _dados->>'${cfgV.campoEquipe}' AS equipe,
      _dados->>'${cfgV.campoRegiao}' AS regiao,
      NOW()
    FROM raw.vendedores
    ON CONFLICT (vendedor_id) DO UPDATE SET
      nome     = EXCLUDED.nome,
      equipe   = EXCLUDED.equipe,
      regiao   = EXCLUDED.regiao,
      _sync_at = NOW()
  `);
}

// Materializa fact_faturamento a partir de raw.faturamento
// Nota: os campos do _dados são os nomes das colunas Oracle, que serão
// preenchidos quando o schema Oracle for mapeado.
async function atualizarFaturamento(desde) {
  const cfgFat = cfgs.faturamento;
  await pg.query(`
    INSERT INTO analytics.fact_faturamento (
      id, data_id, filial_id, cliente_id, produto_id, vendedor_id,
      numero_nf, serie, valor_total, status, _sync_at
    )
    SELECT
      f.id,
      TO_CHAR(f.data_emissao, 'YYYYMMDD')::INT AS data_id,
      f.filial_id,
      f._dados->>'${cfgFat.campoCliente}'  AS cliente_id,
      NULL                                  AS produto_id,
      f._dados->>'${cfgFat.campoVendedor}' AS vendedor_id,
      f._dados->>'${cfgFat.campoNumeroNF}' AS numero_nf,
      f._dados->>'${cfgFat.campoSerie}'    AS serie,
      (f._dados->>'VALOR_TOTAL')::NUMERIC   AS valor_total,
      f._dados->>'${cfgFat.campoStatus}'   AS status,
      NOW()
    FROM raw.faturamento f
    WHERE f._sync_at >= $1
    ON CONFLICT (id) DO UPDATE SET
      valor_total = EXCLUDED.valor_total,
      status      = EXCLUDED.status,
      _sync_at    = NOW()
  `, [desde]);
}

async function atualizarEstoque(desde) {
  const cfgE = cfgs.estoque;
  await pg.query(`
    INSERT INTO analytics.fact_estoque (
      id, data_id, filial_id, produto_id, deposito_id,
      saldo, valor_medio, valor_total, _sync_at
    )
    SELECT
      e.id,
      TO_CHAR(e.data_posicao, 'YYYYMMDD')::INT AS data_id,
      e.filial_id,
      e.produto_id,
      e.deposito_id,
      (e._dados->>'${cfgE.campoSaldo}')::NUMERIC      AS saldo,
      (e._dados->>'${cfgE.campoValorMedio}')::NUMERIC AS valor_medio,
      (e._dados->>'${cfgE.campoSaldo}')::NUMERIC *
      (e._dados->>'${cfgE.campoValorMedio}')::NUMERIC AS valor_total,
      NOW()
    FROM raw.estoque e
    WHERE e._sync_at >= $1
    ON CONFLICT (id) DO UPDATE SET
      saldo       = EXCLUDED.saldo,
      valor_medio = EXCLUDED.valor_medio,
      valor_total = EXCLUDED.valor_total,
      _sync_at    = NOW()
  `, [desde]);
}

async function atualizar(desde = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
  await atualizarDimensoes();
  await atualizarFaturamento(desde);
  await atualizarEstoque(desde);
  // fact_pedidos, fact_financeiro, fact_contabil seguem o mesmo padrão —
  // adicione aqui quando os campos Oracle forem mapeados
}

module.exports = { atualizar };
