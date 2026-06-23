# Guia de uso da ActionAPI

Para entender as fontes Oracle, os relacionamentos e os cálculos aplicados em
cada endpoint, consulte [Metodologia das APIs](METODOLOGIA_APIS.md).

## Acessos disponíveis

| Endereço | Finalidade | Autenticação |
|---|---|---|
| `/login` | Login administrativo | Usuário e senha |
| `/painel` | Consultas visuais somente leitura | Sessão administrativa |
| `/docs` | Swagger/OpenAPI interativo | Sessão administrativa |
| `/api/v1/*` | Integrações e consultas JSON | `X-API-Key` ou sessão |
| `/health` | Disponibilidade do serviço | Público, com rate limit |

## Integração por API key

Envie a chave em todas as requisições:

```http
X-API-Key: sua-chave
```

Exemplo:

```bash
curl \
  -H "X-API-Key: sua-chave" \
  "https://api.exemplo.local/api/v1/faturamento/resumo?paramId=102&dataInicio=2025-01-01&dataFim=2025-12-31"
```

As chaves são configuradas no servidor:

```env
API_KEYS=chave-do-bi,chave-do-integrador
```

É recomendável usar uma chave diferente por sistema consumidor. Os logs registram
um identificador irreversível da chave, nunca a chave em texto.

## Login administrativo

O painel e o Swagger não expõem a API key no navegador. Após o login, o servidor
cria uma sessão JWT em cookie:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` quando `COOKIE_SECURE=true`;
- expiração definida por `SESSION_TTL_SECONDS`.

Para gerar o hash da senha:

```bash
cd packages/api
npm run hash-password -- "uma-senha-longa-e-exclusiva"
```

Copie o resultado completo para `ADMIN_PASSWORD_HASH` no `.env`.

## Swagger

Depois do login, abra `/docs`. A tela permite:

- consultar todas as rotas e filtros;
- executar requisições;
- visualizar parâmetros e respostas;
- informar uma API key pelo botão **Authorize**, se desejar testar como integração.

## Painel

O painel em `/painel` contém:

- consolidado de faturamento por período, parâmetro e filial;
- detalhamento do resultado por filial;
- explorador de notas, entradas, devoluções, pedidos, duplicatas, estoque,
  lotes, clientes e contabilidade;
- acesso direto à documentação Swagger.

O painel é estritamente de consulta. Não existem rotas `POST`, `PUT`, `PATCH` ou
`DELETE` para dados do ERP.

## Faturamento consolidado

```http
GET /api/v1/faturamento/resumo
```

Parâmetros principais:

| Parâmetro | Exemplo | Descrição |
|---|---|---|
| `paramId` | `102` | Ativa o consolidado pelas funções A/S |
| `dataInicio` | `2025-01-01` | Emissão inicial |
| `dataFim` | `2025-12-31` | Emissão final |
| `filialId` | `1` | Opcional |
| `status` | `5` | Status da nota; padrão 5 |

O parâmetro 102 reproduz o relatório **Saídas Faturadas - Analítico** combinando:

1. `NOTA`: `TOTA_NOT`, conforme função A/S;
2. `NFENTRA`: `QUAN_INF × VLIQ_INF`, conforme função A/S.

## Respostas e erros

Lista paginada:

```json
{
  "data": [],
  "total": 100,
  "page": 1,
  "pageSize": 100
}
```

Erro:

```json
{
  "error": "Descrição do erro",
  "code": "CODIGO_DO_ERRO"
}
```

Status mais comuns:

| HTTP | Significado |
|---|---|
| `200` | Consulta concluída |
| `400` | Filtros inválidos |
| `401` | Autenticação ausente ou inválida |
| `404` | Registro ou rota inexistente |
| `426` | HTTPS obrigatório |
| `429` | Limite de requisições excedido |
| `500` | Erro interno |

O catálogo completo e sempre executável está disponível em `/docs`.

## Power BI e Excel

Todas as rotas GET de `/api/v1/*` aceitam `format=csv`. Isso inclui
faturamento, entradas, pedidos, duplicatas, estoque, lotes, clientes,
financeiro, baixas, contabilidade, DRE e conciliação.

Exemplos:

```text
/api/v1/faturamento?dataInicio=2025-01-01&dataFim=2025-12-31&format=csv
/api/v1/clientes?status=A&format=csv
/api/v1/lotes?vencendoEm=90&format=csv
/api/v1/contabil?competencia=2025-01&format=csv
```

Além da exportação geral, estes endpoints retornam fatos planos especialmente
adequados para tabela dinâmica:

```http
GET /api/v1/bi/financeiro
GET /api/v1/bi/contabil
```

Os dois exigem `dataInicio` e `dataFim`. Para CSV:

```text
/api/v1/bi/financeiro?dataInicio=2025-01-01&dataFim=2025-12-31&format=csv&pageSize=10000
```

No Power BI, use **Obter dados → Web** e informe a URL. Em opções avançadas,
adicione o header:

```text
X-API-Key: sua-chave
```

As APIs respeitam o `pageSize` máximo de cada rota. Para grandes volumes,
divida a carga por mês ou use paginação. Os datasets `/bi/*` aceitam até
10.000 linhas por página.

O CSV usa separador `;`, UTF-8 com BOM e proteção contra fórmulas injetadas no
Excel. Os campos de data, filial, parceiro, título, parcela, valores, baixas,
contas, débitos e créditos são retornados em colunas independentes.

## Conciliação financeiro × contábil

```http
GET /api/v1/conciliacao/financeiro-contabil
GET /api/v1/conciliacao/financeiro-contabil/divergencias
GET /api/v1/conciliacao/financeiro-contabil/resumo
```

Classificações:

- `OK`;
- `SEM_LANCAMENTO_CONTABIL`;
- `MULTIPLOS_LANCAMENTOS`;
- `VALOR_DIVERGENTE`.
- `NAO_APLICAVEL_REGRA_AUTOMATICA`.

Regras confirmadas no ERP:

- CP normal (`TDRL_CPG=NN`): origem contábil `DP`, vinculada pelo controle do título;
- CR normal de venda (`CODI_TDO=101`): origem contábil `NE`, vinculada por número,
  série, filial e parceiro;
- retenções, caixa, cancelamentos e outros documentos ficam como
  `NAO_APLICAVEL_REGRA_AUTOMATICA`, pois podem ser contabilizados agrupados.

A tolerância padrão é R$ 0,01 e pode ser alterada pelo parâmetro `tolerancia`.

## Saldos financeiros exatos

```http
GET /api/v1/duplicatas/saldo
GET /api/v1/duplicatas/saldo/resumo

GET /api/v1/executivo/faturamento
GET /api/v1/executivo/faturamento/resumo
GET /api/v1/executivo/recebimentos
GET /api/v1/executivo/recebimentos/resumo
GET /api/v1/executivo/pagamentos
GET /api/v1/executivo/pagamentos/resumo
GET /api/v1/executivo/contabilidade/resumo
GET /api/v1/executivo/visao-360
GET /api/v1/financeiro/contas-pagar
GET /api/v1/financeiro/contas-pagar/resumo
```

Os saldos reproduzem localmente as funções
`VALOR_ABERTO_RECEBER_DATA` e `VALOR_ABERTO_PAGAR_DATA`. São consideradas
somente baixas normais ocorridas até a data do cálculo, além de indexadores,
agrupamentos e tolerâncias do ERP.

Em títulos indexados, consulte `unidade_saldo`: o resultado pode estar em
`SJ$`, `US$` ou `ER`, e não em reais. `saldo_convertido_atual` mostra uma
conversão separada pela cotação mais recente.
