'use strict';
/**
 * services/clientes.js
 *
 * Lógica de negócio para Clientes (TRANSAC + JOIN CLIENTE).
 *
 * Fonte de dados: raw.clientes (7.602 registros, jun/2026)
 *
 * Campos extraídos como colunas tipadas:
 *   razao_social (RAZA_TRA), cgc_cnpj (CGC_TRA), status (SITU_TRA)
 *
 * Todos os outros campos de TRANSAC ficam em _dados:
 *   FANT_TRA, TEL1_TRA, CEL_TRA, ENDE_TRA, NEND_TRA, BAIR_TRA,
 *   CEP_TRA, CODI_MUN, LATI_TRA, LONG_TRA, DCAD_TRA, etc.
 *
 * Funções exportadas:
 *   listar()       — busca por nome/CNPJ com paginação
 *   buscarPorId()  — dados completos do cliente
 *   faturamento()  — NFs emitidas para este cliente
 *   pedidos()      — pedidos de venda deste cliente
 *   propriedades() — propriedades rurais vinculadas
 *   resumo()       — totais agregados (faturamento, pedidos)
 */
const db = require('../db/postgres');

const SELECT_CLIENTE = `
  c.id,
  c.razao_social,
  c.cgc_cnpj,
  c.status,
  c._dados->>'FANT_TRA'  AS fantasia,
  c._dados->>'TEL1_TRA'  AS telefone,
  c._dados->>'CEL_TRA'   AS celular,
  c._dados->>'ENDE_TRA'  AS endereco,
  c._dados->>'NEND_TRA'  AS numero,
  c._dados->>'BAIR_TRA'  AS bairro,
  c._dados->>'CEP_TRA'   AS cep,
  c._dados->>'CODI_MUN'  AS municipio_id,
  c._dados->>'LATI_TRA'  AS latitude,
  c._dados->>'LONG_TRA'  AS longitude,
  c._dados->>'DCAD_TRA'  AS data_cadastro,
  COALESCE(NULLIF(c._dados->>'EMCG_TRA',''), NULLIF(c._dados->>'ECOB_TRA','')) AS email,
  c._sync_at
`;

async function listar({ search, cgcCnpj, status, page = 1, pageSize = 100 }) {
  const conds = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conds.push(`(c.razao_social ILIKE $${params.length} OR c._dados->>'FANT_TRA' ILIKE $${params.length})`);
  }
  if (cgcCnpj) { params.push(cgcCnpj); conds.push(`c.cgc_cnpj = $${params.length}`); }
  if (status)  { params.push(status);  conds.push(`c.status = $${params.length}`); }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT ${SELECT_CLIENTE}
       FROM raw.clientes c
       ${where}
       ORDER BY c.razao_social
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::INT AS total FROM raw.clientes c ${where}`, params),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function buscarPorId(id) {
  const res = await db.query(
    `SELECT ${SELECT_CLIENTE},
       c._dados->>'FORN_TRA'  AS flag_fornecedor,
       c._dados->>'IAGR_TRA'  AS flag_agropecuaria,
       c._dados->>'OBSE_TRA'  AS observacao,
       c._dados->>'CONT_TRA'  AS contato,
       c._dados->>'TEL2_TRA'  AS telefone2,
       c._dados->>'HOME_TRA'  AS homepage,
       c._dados->>'SITU_TRA'  AS situ_tra
     FROM raw.clientes c
     WHERE c.id = $1`,
    [id],
  );
  return res.rows[0] || null;
}

async function faturamento(id, {
  dataInicio, dataFim, tranTop,
  page = 1, pageSize = 100,
}) {
  const conds = [`f._dados->>'CODI_TRA' = $1`];
  const params = [id];

  if (dataInicio) { params.push(dataInicio); conds.push(`f.data_emissao >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conds.push(`f.data_emissao <= $${params.length}`); }
  if (tranTop)    { params.push(tranTop);    conds.push(`f.tran_top = $${params.length}`); }

  const where  = `WHERE ${conds.join(' AND ')}`;
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         f.id,
         f.filial_id,
         f.data_emissao,
         f.tran_top,
         f.tipo_top,
         f.operacao_id,
         f.pedido_id,
         f._dados->>'NOTA_NOT'            AS numero_nf,
         f._dados->>'SERI_NOT'            AS serie,
         f._dados->>'DSAI_NOT'            AS data_saida,
         f._dados->>'SITU_NOT'            AS status,
         f._dados->>'DESC_TOP'            AS operacao_desc,
         (f._dados->>'TOTA_NOT')::NUMERIC AS valor_total,
         f._sync_at
       FROM raw.faturamento f
       ${where}
       ORDER BY f.data_emissao DESC, f.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::INT AS total FROM raw.faturamento f ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function pedidos(id, {
  dataInicio, dataFim, status, origem,
  page = 1, pageSize = 100,
}) {
  const conds = [`p.cliente_id = $1`];
  const params = [id];

  if (dataInicio) { params.push(dataInicio); conds.push(`p.data_pedido >= $${params.length}`); }
  if (dataFim)    { params.push(dataFim);    conds.push(`p.data_pedido <= $${params.length}`); }
  if (status)     { params.push(status);     conds.push(`p._dados->>'SITU_PED' = $${params.length}`); }
  if (origem)     { params.push(origem);     conds.push(`p.origem = $${params.length}`); }

  const where  = `WHERE ${conds.join(' AND ')}`;
  const offset = (page - 1) * pageSize;

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT
         p.id,
         p.filial_id,
         p.cliente_id,
         p.data_pedido,
         p.origem,
         p._dados->>'PEDI_PED'            AS numero_pedido,
         p._dados->>'SERI_PED'            AS serie,
         p._dados->>'COD1_PES'            AS vendedor_id,
         p._dados->>'SITU_PED'            AS status,
         (p._dados->>'TOTA_PED')::NUMERIC AS valor_total,
         p._sync_at
       FROM raw.pedidos p
       ${where}
       ORDER BY p.data_pedido DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::INT AS total FROM raw.pedidos p ${where}`,
      params,
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total, page, pageSize };
}

async function propriedades(id) {
  const res = await db.query(
    `SELECT
       p.id,
       p.descricao,
       p.area,
       p.status,
       p.data_alteracao,
       p._dados->>'CODI_EMP' AS filial_id,
       pv.vendedor1_id,
       pv.vendedor2_id
     FROM raw.propriedades p
     LEFT JOIN raw.propriedades_vendedor pv ON pv.propriedade_id = p.id
     WHERE p.cliente_id = $1
     ORDER BY p.descricao`,
    [id],
  );
  return { data: res.rows };
}

async function resumo(id) {
  const [fatRes, pedRes] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*)::INT                                            AS total_nfs,
         COUNT(*) FILTER (WHERE tran_top = '2')::INT            AS nfs_saida,
         COUNT(*) FILTER (WHERE tran_top = '1')::INT            AS nfs_entrada,
         SUM((_dados->>'TOTA_NOT')::NUMERIC)
           FILTER (WHERE tran_top = '2')                        AS valor_total_faturado,
         SUM((_dados->>'TOTA_NOT')::NUMERIC)
           FILTER (WHERE tran_top = '1')                        AS valor_total_devolucoes,
         MIN(data_emissao) FILTER (WHERE tran_top = '2')        AS primeira_compra,
         MAX(data_emissao) FILTER (WHERE tran_top = '2')        AS ultima_compra
       FROM raw.faturamento
       WHERE _dados->>'CODI_TRA' = $1`,
      [id],
    ),
    db.query(
      `SELECT
         COUNT(*)::INT                                           AS total_pedidos,
         SUM((_dados->>'TOTA_PED')::NUMERIC)                    AS valor_total_pedidos,
         COUNT(*) FILTER (WHERE _dados->>'SITU_PED' = '9')::INT AS pedidos_cancelados,
         COUNT(*) FILTER (WHERE _dados->>'SITU_PED' != '9')::INT AS pedidos_ativos,
         COUNT(*) FILTER (WHERE origem = 'S')::INT              AS pedidos_crm,
         MIN(data_pedido)                                       AS primeiro_pedido,
         MAX(data_pedido)                                       AS ultimo_pedido
       FROM raw.pedidos
       WHERE cliente_id = $1`,
      [id],
    ),
  ]);

  return {
    faturamento: fatRes.rows[0],
    pedidos:     pedRes.rows[0],
  };
}

module.exports = { listar, buscarPorId, faturamento, pedidos, propriedades, resumo };
