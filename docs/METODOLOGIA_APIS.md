# Metodologia das APIs da ActionAPI

Este documento explica como cada família de APIs foi construída, quais tabelas
do SiAGRI são usadas, como os relacionamentos foram encontrados e quais cálculos
são aplicados antes de devolver os dados.

## Princípios gerais

### Arquitetura e segurança dos dados

```text
Oracle SiAGRI -- somente SELECT --> ETL --> PostgreSQL --> ActionAPI
```

- O Oracle do ERP é acessado exclusivamente para consulta.
- A API lê o PostgreSQL; ela não consulta o Oracle durante cada requisição.
- Não existem rotas de alteração dos dados do ERP.
- `/api/v1/*` exige `X-API-Key` ou sessão administrativa autenticada.
- Toda rota GET pode ser exportada em CSV usando `format=csv`.

### Identificadores

Chaves compostas preservam todos os componentes para evitar colisões entre
filiais:

```text
Pedido de venda:  {filial}_{pedido}_{serie}
Pedido de compra: {filial}_{pedido}
```

### Valores, paginação e BI

- Valores monetários permanecem como `NUMERIC`.
- Listagens são paginadas.
- Datasets de BI mantêm uma linha por fato.
- O CSV usa `;`, UTF-8 com BOM e proteção contra fórmulas do Excel.

## Faturamento

### Fontes e relacionamento

```text
NOTA
  └── INOTA
        ├── PRODSERV
        ├── GRUPO/SUBGRUPO
        └── pedido de venda, quando informado
```

`NOTA` fornece o cabeçalho e `INOTA` os itens. A data de emissão vem de
`DEMI_NOT`, a saída de `DSAI_NOT` e `tran_top` diferencia entrada, saída e
transferência.

Filtros de produto na lista de notas usam `EXISTS` sobre os itens. Assim é
possível filtrar uma nota por produto ou grupo sem repetir seu cabeçalho.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/faturamento` | Uma linha por nota de `NOTA`, com filtros diretos e filtros indiretos por itens. |
| `GET /api/v1/faturamento/itens` | Uma linha por item de `INOTA`, enriquecida com produto, grupo, subgrupo e princípios ativos. |
| `GET /api/v1/faturamento/:id` | Busca o cabeçalho e anexa seus itens. |
| `GET /api/v1/faturamento/resumo` | Agrupa por dia, mês, trimestre ou ano. Com `paramId`, aplica o consolidado abaixo. |

### Faturamento consolidado

O relatório “Saídas Faturadas - Analítico” considera as funções operacionais:

- `A`: adiciona ao faturamento;
- `S`: subtrai do faturamento.

```text
Saídas em NOTA
(-) devoluções e ajustes em NFENTRA
= faturamento líquido
```

Para entradas/devoluções, o valor contábil é reconstruído por item:

```text
valor do item = QUAN_INF × VLIQ_INF
```

A comparação com o relatório
`faturamento consolidado analitico 010125-311225.pdf` mostrou que as devoluções
de `NFENTRA/INFENTRA` eram a origem da divergência quando se somava somente
`NOTA`.

## Notas fiscais de entrada

```text
NFENTRA
  └── INFENTRA
        ├── PRODSERV
        ├── impostos
        └── referência ao pedido de compra
```

`NFENTRA` contém o cabeçalho e `INFENTRA` os itens, valores, impostos e
referências de pedido. A emissão vem de `DEMI_NFE`, o recebimento de
`DREC_NFE` e o valor usado por item é `QUAN_INF × VLIQ_INF`.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/entradas` | Uma linha por cabeçalho de `NFENTRA`. |
| `GET /api/v1/entradas/itens` | Uma linha por `INFENTRA`, incluindo os dados tributários disponíveis. |
| `GET /api/v1/entradas/resumo` | Agrega valores e tributos por período. |
| `GET /api/v1/entradas/devolucoes` | Usa por padrão `paramId=102` e função `S` para operações que reduzem faturamento. |
| `GET /api/v1/entradas/:id` | Retorna cabeçalho, itens e impostos da nota. |

## Pedidos de venda

```text
PEDIDO
  └── IPEDIDO
        │
        └── INOTA.PEDI_PED/SERI_PED/CODI_EMP
              └── NOTA
```

- `PEDIDO` fornece o cabeçalho e `IPEDIDO` os itens.
- O vínculo com faturamento usa os campos de pedido gravados em `INOTA`.
- A chave inclui filial, número e série; número+série não é único entre filiais.
- `ITEM_IPE` está vazio nesta base, portanto o identificador do item utiliza o
  produto dentro da chave real.

Saldo por produto:

```text
quantidade em aberto = quantidade pedida - quantidade faturada
```

Classificação comercial:

- `ABERTO`;
- `FATURADO_PARCIALMENTE`;
- `FATURADO_INTEGRAL`.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/pedidos` | Uma linha por pedido, com filtros de cliente, vendedor, origem, status e produto. |
| `GET /api/v1/pedidos/itens` | Uma linha por item do pedido. |
| `GET /api/v1/pedidos/resumo` | Agrupa valores por período, status e origem ERP/CRM/Mobile. |
| `GET /api/v1/pedidos/:id` | Retorna cabeçalho e itens completos. |
| `GET /api/v1/pedidos/:id/faturamento` | Localiza notas cujos itens guardam a chave do pedido. |
| `GET /api/v1/pedidos/:id/saldo` | Compara itens pedidos com faturados e calcula o saldo comercial. |

### Venda para entrega futura

A confirmação física usada pelo relatório “com VEF” não possui referência
segura a nota ou pedido nas tabelas encontradas. `CCSALDO` guarda o movimento
agregado por produto e filial. A API usa a metodologia do relatório sem VEF,
que foi validada contra o ERP.

## Pedidos de compra

```text
PEDCOM
  ├── IPEDCOM
  └── PARCPEDCOM
```

- `PEDCOM`: cabeçalho e fornecedor.
- `IPEDCOM`: produto, quantidade pedida, recebida e valores.
- `PARCPEDCOM`: previsão de parcelas.
- Fornecedores vêm de `TRANSAC` com `FORN_TRA='S'`.

```text
quantidade pendente = QTDP_IPC - QTDR_IPC
valor pendente = quantidade pendente × valor unitário
```

Pedidos cancelados são excluídos por padrão. No SiAGRI, um cancelado pode
continuar com quantidade recebida zero, o que inflaria artificialmente o saldo.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/pedidos-compra` | Uma linha por `PEDCOM`. |
| `GET /api/v1/pedidos-compra/itens-abertos` | Calcula o saldo de recebimento por item. |
| `GET /api/v1/pedidos-compra/resumo` | Soma quantidades e valores pendentes por fornecedor e filial. |
| `GET /api/v1/pedidos-compra/:id` | Retorna cabeçalho, itens, parcelas previstas, notas e títulos relacionados. |

Os significados `P`, `A` e `C` de `STAT_PEC` foram inferidos por amostragem e
ainda devem ser confirmados com um relatório operacional do ERP.

## Contas a pagar com pedidos e produtos

### Como o vínculo foi encontrado

`CABPAGARPED` existe nesta instalação, mas está vazia. O vínculo efetivo é:

```text
CABPAGAR.CTRL_CPG
        ↑
NOTACPG.CTRL_CPG
NOTACPG.CTRL_NCP
        ↓
INFENTRA.CTRL_NFE
INFENTRA.EMPR_PEC + INFENTRA.NUME_PEC
        ↓
PEDCOM.CODI_EMP + PEDCOM.NUME_PEC
```

1. `CABPAGAR` identifica o título.
2. `NOTACPG` informa a nota de entrada que originou o título.
3. `INFENTRA` informa produtos, filial e número do pedido recebido.
4. Filial+número localizam o pedido em `PEDCOM`.

Consulta conceitual:

```sql
SELECT
  cp.CTRL_CPG,
  i.CTRL_NFE,
  i.EMPR_PEC,
  i.NUME_PEC,
  i.CODI_PSV
FROM CABPAGAR cp
JOIN NOTACPG n ON n.CTRL_CPG = cp.CTRL_CPG
JOIN INFENTRA i ON i.CTRL_NFE = n.CTRL_NCP
JOIN PEDCOM p
  ON p.CODI_EMP = i.EMPR_PEC
 AND p.NUME_PEC = i.NUME_PEC;
```

Validação de 19 de junho de 2026:

- 21.129 itens vinculados;
- 17.354 títulos;
- 17.603 pares título–pedido;
- 5.761 pedidos distintos;
- nenhuma referência de pedido inexistente em `PEDCOM`.

### Como se evita duplicar valores

Uma nota pode ter muitos itens e um título pode envolver mais de um pedido. A
API primeiro agrega por título os pedidos, produtos e notas. Somente depois
liga essa agregação às parcelas.

```text
granularidade final = uma linha por parcela financeira
```

### Baixas, estornos e saldo

As baixas vêm de `CPGBAIXA`:

- `SITU_CPB='N'`: baixa normal, entra na soma;
- `SITU_CPB='E'`: baixa histórica estornada, é ignorada no saldo.
- baixas com data posterior à data do cálculo ainda não reduzem o saldo.

Uma baixa estornada não deve ser novamente subtraída. Em casos reais, havia
tentativas estornadas e uma baixa normal; usar os estornos como negativos
reabria milhões de reais artificialmente.

```text
valor baixado = soma de VLOR_CPB onde SITU_CPB='N'
saldo = PAGAR.VLOR_PAG - valor baixado
```

Quando `CABPAGAR.CODI_IND` está preenchido, valor e baixas são convertidos
para unidades do indexador usando `INDVALOR` na data original e na data de
cada baixa. A metodologia também reproduz `PAGARAGRU`, exclusões por
renegociação/vínculo previdenciário e a tolerância de `PARAMGERFINANC`.

Em 20 de junho de 2026, a reprodução local foi comparada com
`VALOR_ABERTO_PAGAR_DATA` nas 183.656 parcelas: zero divergências.

Situação:

- `BAIXADA`: diferença absoluta até R$ 0,01;
- `PARCIAL`: existe baixa normal e ainda há saldo;
- `ABERTA`: não há baixa normal e existe saldo.

Validação direta em 20 de junho de 2026:

| Métrica | Oracle | ActionAPI |
|---|---:|---:|
| Parcelas abertas | 542 | 542 |
| Saldo aberto | R$ 122.237.778,67 | R$ 122.237.778,67 |

### Conferência do pedido

Fornecedor e filial do título não são substituídos pelos dados do pedido. A API
preserva ambos e classifica:

- `OK`;
- `MESMA_RAIZ_CNPJ_ESTABELECIMENTO_DIFERENTE`;
- `FORNECEDOR_DIVERGENTE`;
- `FILIAL_DIVERGENTE`;
- `FORNECEDOR_E_FILIAL_DIVERGENTES`;
- `NAO_APLICAVEL`.

Status do vínculo:

- `COM_PEDIDO`;
- `COM_NF_SEM_PEDIDO`;
- `SEM_NF_E_SEM_PEDIDO`.

Empréstimos, tributos e adiantamentos podem legitimamente não possuir pedido.
Adiantamentos acontecem antes da nota e não recebem vínculo por aproximação.

Os números são apresentados separadamente:

- número da NF: `NFENTRA.NUME_NFE`;
- controle interno da NF: `NFENTRA.CTRL_NFE`;
- pedido interno do SiAGRI: `PEDCOM.NUME_PEC`;
- pedido informado pelo fornecedor: `PEDCOM.NUFO_PEC`.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/financeiro/contas-pagar` | Uma linha por parcela, com fornecedor, vencimento, saldo, pedidos, produtos e conferências. |
| `GET /api/v1/financeiro/contas-pagar/resumo` | Agrupa as parcelas por fornecedor e filial sem multiplicar valores pelos itens. |

## Financeiro geral, duplicatas e baixas

## Camada executiva CEO/CFO

Os endpoints `/api/v1/executivo/*` entregam datasets prontos para cards,
gráficos, rankings e drill-down no futuro frontend React. A camada combina:

- faturamento líquido com devoluções;
- recebimentos e pagamentos normais, mantendo estornos separados;
- concentração por cliente, fornecedor, vendedor, filial e grupo de produto;
- evolução mensal e encargos financeiros;
- saldos atuais de contas a receber e pagar;
- resumo contábil, DRE e conciliação financeiro × contábil.

O endpoint `/api/v1/executivo/visao-360` consolida receita, caixa, capital de
giro financeiro e qualidade contábil sem consultar diretamente o Oracle.

### Dashboard avançado de Contas a Receber

`GET /api/v1/financeiro/contas-receber` retorna uma linha por parcela aberta
do snapshot oficial `raw.duplicatas_saldo`. O endpoint enriquece a parcela com
cliente, filial, vendedor, tipo de documento, recebimentos normais agregados e
os dados do indexador.

`GET /api/v1/financeiro/contas-receber/resumo` agrupa o saldo por cliente,
filial e unidade. A separação por unidade é obrigatória porque `SJ$`, `US$` e
`ER` não devem ser somados diretamente como se fossem reais. O endpoint também
retorna `saldo_convertido_atual`, uma estimativa adicional em reais.

O script `scripts/gerar_relatorio_contas_receber.py` consome somente esses
endpoints e gera um Excel com painel, títulos, clientes, unidades, vencimentos,
recebimentos, contratos indexados e auditoria da diferença entre o snapshot
Oracle e a reprodução local.

```text
Contas a pagar:   CABPAGAR + PAGAR
Contas a receber: CABREC + RECEBER
Pagamentos:       CPGBAIXA
Recebimentos:     CRCBAIXA
```

| Rota | Metodologia |
|---|---|
| `GET /api/v1/financeiro` | Lista parcelas CP, CR ou ambas. Para saldo calculado de CP, use `/financeiro/contas-pagar`. |
| `GET /api/v1/financeiro/fluxo-caixa` | Agrupa parcelas por vencimento e calcula `receber - pagar`; representa previsão, não extrato bancário realizado. |
| `GET /api/v1/duplicatas` | Lista parcelas de `RECEBER`, preservando status `A`, `B` ou `C`. |
| `GET /api/v1/pagamentos` | Lista movimentos individuais de `CPGBAIXA`, normais e estornados. |
| `GET /api/v1/pagamentos/resumo` | Agrupa pagamentos por período e filial, separando normais e estornados. |
| `GET /api/v1/recebimentos` | Lista movimentos individuais de `CRCBAIXA`. |
| `GET /api/v1/recebimentos/resumo` | Agrupa recebimentos por período e filial. |

Os endpoints de movimentos mostram o histórico. Para calcular saldo, somente
movimentos normais compõem o valor baixado.

### Saldo exato de Contas a Receber

O saldo local reproduz `VALOR_ABERTO_RECEBER_DATA`:

```text
título indexado = VLOR_REC / INDVALOR da DATA_VLR original
baixa indexada  = VLOR_BAI / INDVALOR da DATA_VLR da baixa
saldo           = título - baixas até a data - RECEBERAGRU
```

Também são aplicadas a tolerância de `PARAMGERFINANC` e a natureza de
`TIPDOC`. O resultado indexado é uma quantidade (`SJ$`, `US$`, `ER`), não um
valor já convertido pela cotação atual.

Validação em 20 de junho de 2026: 156.487 parcelas abertas comparadas com a
função Oracle, zero divergências; saldo do relatório de R$ 157.092.758,96
reproduzido exatamente.

## Clientes

Clientes são parceiros de `TRANSAC` com registro correspondente em `CLIENTE`.
Os demais dados são ligados pelo código do parceiro:

```text
TRANSAC/CLIENTE
  ├── NOTA
  ├── PEDIDO
  └── PROPRIED
        └── VENDEDORPROPRIED
```

| Rota | Metodologia |
|---|---|
| `GET /api/v1/clientes` | Pesquisa razão social, fantasia, CPF/CNPJ e status. |
| `GET /api/v1/clientes/:id` | Retorna cadastro, contatos e endereço disponíveis. |
| `GET /api/v1/clientes/:id/faturamento` | Filtra `NOTA` pelo cliente. |
| `GET /api/v1/clientes/:id/pedidos` | Filtra `PEDIDO` pelo cliente. |
| `GET /api/v1/clientes/:id/propriedades` | Relaciona propriedades ativas e vendedores por filial. |
| `GET /api/v1/clientes/:id/resumo` | Calcula contagens, valores e datas de faturamento e pedidos. |

## Estoque

`CCSALDO` guarda histórico, não somente uma posição atual. Para cada combinação
de filial, produto e controle, o ETL seleciona a linha mais recente:

```sql
ROW_NUMBER() OVER (
  PARTITION BY filial, produto, tipo_controle
  ORDER BY data_movimento DESC
)
```

O filtro de saldo zero é aplicado depois do ranking. Assim, um produto zerado
hoje não exibe por engano um saldo antigo.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/estoque` | Retorna a posição mais recente por filial, produto e controle/depósito. |

## Lotes e validade

O saldo é calculado diariamente pela função Oracle `SALDO_LOTE()` e
materializado em `raw.saldo_lote`, evitando uma execução pesada em cada
requisição. São mantidos lotes com saldo positivo e validade disponível.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/lotes` | Lista o snapshot atual com filtros de produto, grupo, filial, saldo e validade. |
| `GET /api/v1/lotes/vencendo` | Seleciona validade entre hoje e a quantidade de dias informada. |
| `GET /api/v1/lotes/resumo` | Agrega saldo e quantidade de lotes por grupo e filial. |

## Contabilidade

```text
CABLANCTB
  └── LANCONTAB
        ├── CONTASPL
        └── histórico contábil
```

- `CABLANCTB` é o cabeçalho.
- `LANCONTAB` contém as partidas.
- A granularidade de `/contabil` é uma partida contábil.

Em muitos cabeçalhos, o código da empresa está ausente. A filial é obtida de
`LANCONTAB.CODI_EMP`, onde foi encontrada de forma consistente. A API não
deduz a loja pelo centro de custo, pois isso esconderia lançamentos feitos no
centro de custo errado.

```text
total débito  = soma das partidas D
total crédito = soma das partidas C
saldo         = débito - crédito
```

| Rota | Metodologia |
|---|---|
| `GET /api/v1/contabil` | Uma linha por partida de `LANCONTAB`, com dados do cabeçalho. |
| `GET /api/v1/contabil/saldo-contas` | Agrupa débito, crédito e saldo por conta e competência. |
| `GET /api/v1/contabil/resumo` | Agrupa lançamentos e partidas por competência. |
| `GET /api/v1/contabil/balancete` | Consolida contas por grupo contábil em um período. |

## DRE

```text
IDRE
  └── CONTASDRE
        └── LANCONTAB
```

- `IDRE` define a hierarquia.
- `CONTASDRE` associa contas às linhas.
- `soma_subtrai='A'` usa `débito - crédito`.
- `soma_subtrai='S'` usa `crédito - débito`.

Linhas de valor são calculadas pelas contas mapeadas. Linhas de cálculo
preservam a hierarquia para soma das linhas filhas.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/dre` | Calcula as linhas em um período e filial opcional. |
| `GET /api/v1/dre/estrutura` | Retorna apenas a árvore configurada no ERP. |

## Datasets para Power BI e Excel

### `GET /api/v1/bi/financeiro`

Uma linha por parcela CP ou CR, contendo título, parceiro, emissão, vencimento,
valor, baixas normais, juros, multa, desconto, acréscimo, saldo e situação.
Movimentos estornados não compõem o valor baixado.

### `GET /api/v1/bi/contabil`

Uma linha por partida contábil. Cabeçalho, conta, histórico, débito/crédito e
parceiro ficam em colunas independentes.

### `GET /api/v1/bi/analise-contabil`

Reproduz a estrutura da planilha “exemplo planilha de analise contabil.xlsx”:

- uma linha por competência, loja, conta e centro de custo;
- crédito positivo e débito negativo;
- origem `ZR` excluída por representar encerramento;
- classificação `EBITDA`, `RF` ou `DA`;
- hierarquia gerencial;
- safra de 1º de julho a 30 de junho;
- código da loja vindo do lançamento, sem inferência por centro de custo;
- `status_loja` indicando ausência ou divergência.

## Conciliação financeiro × contábil

Regras confirmadas:

```text
CP normal:
CABPAGAR.CTRL_CPG = CABLANCTB.CTRL_CLC
com CABLANCTB.ORIG_CLC='DP'
```

```text
CR normal de venda:
CABREC ↔ CABLANCTB com ORIG_CLC='NE'
por número + série + filial + parceiro
```

Retenções, caixa, cancelamentos e documentos contabilizados em grupo recebem
`NAO_APLICAVEL_REGRA_AUTOMATICA`.

Classificações:

- `OK`;
- `SEM_LANCAMENTO_CONTABIL`;
- `MULTIPLOS_LANCAMENTOS`;
- `VALOR_DIVERGENTE`;
- `NAO_APLICAVEL_REGRA_AUTOMATICA`.

A tolerância padrão é R$ 0,01.

| Rota | Metodologia |
|---|---|
| `GET /api/v1/conciliacao/financeiro-contabil` | Aplica as regras e classifica todos os títulos do período. |
| `GET /api/v1/conciliacao/financeiro-contabil/divergencias` | Usa a mesma base e remove os classificados como `OK`. |
| `GET /api/v1/conciliacao/financeiro-contabil/resumo` | Agrupa quantidades e valores por tipo e classificação. |

## Endpoints operacionais

| Rota | Metodologia |
|---|---|
| `GET /health` | Verifica disponibilidade sem expor dados empresariais. |
| `POST /auth/login` | Confere usuário e hash `scrypt`; cria sessão JWT em cookie protegido. |
| `POST /auth/logout` | Remove a sessão administrativa. |
| `GET /auth/me` | Valida e identifica a sessão atual. |
| `GET /docs` | Swagger protegido, gerado pelo contrato OpenAPI. |
| `GET /painel` | Frontend protegido que consome as APIs somente leitura. |

## Limitações que devem permanecer visíveis

- Ausência de pedido pode ser legítima em empréstimos, tributos e adiantamentos.
- O fornecedor do pedido não substitui silenciosamente o fornecedor do título.
- O status dos pedidos de compra ainda requer validação funcional definitiva.
- Venda para entrega futura não pode ser atribuída com segurança a um pedido.
- Os dados refletem o último ETL concluído, não uma leitura transacional
  instantânea do Oracle.
- Resumos de movimentos exibem histórico; saldos usam apenas baixas normais.

## Onde conferir a implementação

- Rotas: `packages/api/src/routes/`
- Consultas e regras: `packages/api/src/services/`
- Extração Oracle: `packages/etl/src/jobs/`
- Estrutura PostgreSQL: `migrations/`
- Swagger: `packages/api/src/openapi.js`
- Validações realizadas: `STATUS.md`
Essa última classificação continua sendo uma divergência cadastral. Ela indica
que o título/NF e o pedido usam códigos de transacionador e CNPJs completos
diferentes, embora os estabelecimentos pertençam à mesma raiz de CNPJ. A API
também retorna `divergencia_resumo` e `divergencia_detalhe`, apresentando lado a
lado fornecedor, CNPJ e filial do título/NF e do pedido, além do pedido interno
e do número informado pelo fornecedor.
