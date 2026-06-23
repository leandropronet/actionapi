# Prompt para investigação: saldo em aberto de Contas a Receber em contratos indexados a commodity

## Conclusão — resolvido em 20/06/2026

Foi possível ler o código-fonte de `VALOR_ABERTO_RECEBER_DATA` em
`ALL_SOURCE` e reproduzir integralmente sua regra no PostgreSQL.

O valor `8.016,03` do exemplo **não é R$ 8.016,03 nem uma dívida convertida
pela cotação atual**. Ele representa `8.016,03 SJ$`, isto é, unidades do
indexador “SOJA (SACA 60KG) - 2014”.

Para uma parcela indexada, a função calcula:

```text
valor original em unidades = VLOR_REC / cotação de RECEBER.DATA_VLR

cada baixa em unidades =
  CRCBAIXA.VLOR_BAI / cotação de CRCBAIXA.DATA_VLR

saldo em unidades =
  valor original em unidades
  - soma das baixas normais até a data do cálculo
  - agrupamentos
```

Exemplo `CTRL_REC=10050083`:

```text
R$ 509.750,00 / R$ 50,00 por saca = 10.195,00 SJ$
R$ 108.948,37 / R$ 50,00 por saca = 2.178,9674 SJ$
saldo = 8.016,0326 SJ$
saldo exibido = 8.016,03 SJ$
```

A função oficial **não multiplica o saldo pela cotação atual**. A ActionAPI
passou a retornar separadamente:

- saldo oficial em unidades do indexador;
- abreviatura (`SJ$`, `US$`, `ER` ou `R$`);
- cotação de origem;
- cotação mais recente;
- conversão atual estimada em reais, como informação adicional.

Também foram reproduzidas as demais regras da função:

- somente baixas `SITU_BAI='N'`;
- somente baixas com `DPAG_BAI <= data do cálculo`;
- `RECEBERAGRU`;
- tolerância histórica de `PARAMGERFINANC`;
- inversão do sinal conforme `TIPDOC.TIPO_TDO`.

Validação completa:

| Domínio | Parcelas comparadas | Divergências |
|---|---:|---:|
| Contas a Receber | 156.487 abertas | 0 |
| Contas a Pagar | 183.656 totais | 0 |

O saldo local de receber coincidiu com o snapshot oficial em 3.879 parcelas:
**R$ 157.092.758,96**, diferença zero parcela a parcela.

No Contas a Pagar foi encontrado um segundo problema: a fórmula anterior
abatida também pagamentos com data futura. A função oficial considera apenas
`CPGBAIXA.DPAG_CPB <= data do cálculo`. O resultado correto em 20/06/2026 foi:

- 542 parcelas abertas;
- R$ 122.237.778,67.

Implementação:

- `migrations/014_saldos_financeiros_indexados.sql`;
- `jobs/financeiro_indexadores.js`;
- `jobs/financeiro_saldos_local.js`;
- tabela `raw.financeiro_saldos_local`.

Comandos de manutenção:

```powershell
cd packages/etl
npm run financeiro:recalcular-saldos
npm run financeiro:validar-saldos
```

## Contexto do projeto

ActionAPI é uma API REST (Node.js/Fastify + PostgreSQL) que espelha dados do
ERP SiAGRI (Oracle, schema `SULGOIANO`, acesso **somente leitura**) via um
ETL incremental. O domínio "Contas a Receber" (Duplicatas) está em
`packages/etl/src/jobs/duplicatas.js` (parcelas, tabela `raw.duplicatas`) e
`packages/etl/src/jobs/recebimentos.js` (baixas, tabela `raw.recebimentos`,
espelha `CRCBAIXA`).

## O que já está resolvido e funcionando

Implementei `packages/etl/src/jobs/duplicatas_saldo.js`, um snapshot diário
(`raw.duplicatas_saldo`) que calcula o saldo em aberto chamando a função
oficial do Oracle `VALOR_ABERTO_RECEBER_DATA(CTRL_REC, DT_CALC)` em lote
para todas as parcelas com `RECEBER.SITU_REC='A' AND CABREC.SITU_CBR='A'`
(~156 mil linhas, sem erro). Isso foi **validado exatamente** contra o
relatório oficial do SiAGRI "Contas a Receber por Cliente - Data": bateu
R$ 157.092.758,96, idêntico ao relatório.

**Esse snapshot já está em produção e funcionando. Este pedido NÃO é para
corrigi-lo** — é para investigar se existe uma forma de também calcular o
saldo em aberto **sem depender de uma chamada ao Oracle**, usando só os
dados já replicados no PostgreSQL (`raw.duplicatas` + `raw.recebimentos`).
Isso seria útil para endpoints "quase em tempo real" ou cálculos auxiliares
que não justificam uma chamada à função Oracle.

## O problema

Tentei reconstruir o saldo em aberto com a fórmula ingênua:

```sql
saldo = VLOR_REC - SUM(recebimentos.valor WHERE status='N')
```

Isso erra o total geral por ~2,3% (R$ 160.645.582,37 calculado vs.
R$ 157.092.758,96 real). Investigando linha a linha, achei duas causas:

### Hipótese intermediária: campo `VVCA_BAI`

`CRCBAIXA.VVCA_BAI` é um valor complementar da baixa (parece ser um ajuste/
encontro de contas aplicado junto com o pagamento) que nosso ETL não
capturava. Adicionei a coluna `valor_complementar` em `raw.recebimentos`
(migração `migrations/013_recebimentos_valor_complementar.sql`) e a fórmula
corrigida ficou:

```sql
saldo = VLOR_REC - SUM(recebimentos.valor - recebimentos.valor_complementar WHERE status='N')
```

Isso reduzia a diferença na fórmula ingênua, mas a leitura do código-fonte
mostrou que `VALOR_ABERTO_RECEBER_DATA` **não usa `VVCA_BAI`**. Portanto esse
campo continua útil para descrever o movimento, porém não faz parte da fórmula
oficial do saldo. A melhora observada era uma aproximação incidental.

### Causa principal — RESOLVIDA: contratos indexados a commodity

Depois da correção 1, ainda sobra um resíduo de **~R$ 2,36 milhões** em
**84 parcelas específicas**, onde o cálculo ingênuo (mesmo com a correção 1)
fica de **50 a 65 vezes maior** que o saldo real.

Exemplo concreto — parcela `CTRL_REC = 10050083`:

```sql
SELECT * FROM RECEBER WHERE CTRL_REC = 10050083;
-- VLOR_REC = 509750
-- HIST_REC = 'TROCA POR 15.118 SACOS DE SOJA'
-- CODI_IND = 10000008   (FK para INDEXADOR — parece ser um índice de preço de saca de soja)
-- DATA_VLR = 17/06/2014
-- TJUR_REC = 'C'
-- SITU_REC = 'A'

SELECT * FROM CRCBAIXA WHERE CTRL_REC = 10050083;
-- duas baixas em 30/09/2016: uma estornada (SITU_BAI='E', 108951.13) e uma
-- normal (SITU_BAI='N', 108948.37), VVCA_BAI=0 nas duas

-- Cálculo ingênuo (mesmo corrigido): 509750 - 108948.37 = 400.801,63 em aberto
-- Valor real (VALOR_ABERTO_RECEBER_DATA): R$ 8.016,03 em aberto
```

A diferença ocorre porque o saldo oficial é expresso em quantidade do
indexador. O cliente deve uma quantidade de sacas, mas a função
`VALOR_ABERTO_RECEBER_DATA` não converte essa quantidade pela cotação atual;
ela devolve diretamente a quantidade remanescente.

## O que já foi descartado nessa investigação

- **`RNCCRCBAIXA`** (tabela que parecia poder ser uma "renegociação" de
  baixa): não tem coluna `CTRL_REC` — não é diretamente relacionável à
  parcela dessa forma simples.
- **`CALCVALORES_CR1`** (função que calcula projeção de juros futuro): tem
  um bug de cursor Oracle (`ORA-01001: invalid cursor` dentro de
  `RET_VLORIND`) quando chamada repetidamente numa query com muitas linhas.
  Mas essa função é para *juros futuro projetado*, não para a reindexação
  de commodity — não parece ser o mecanismo certo aqui de qualquer forma.

## O que pesquisar

1. **Tabela `INDEXADOR`** (`CODI_IND` é FK pra lá) — quais campos ela tem?
   Existe uma tabela de **cotações históricas** desse indexador (preço da
   saca de soja por data) que permita recalcular o valor atual da dívida
   indexada? (Pode ter um nome como `COTACAOINDEXADOR`, `HISTINDEXADOR`,
   `VLRINDEXADOR` — nomenclatura SiAGRI costuma ser assim.)
2. **Outras funções/packages Oracle** ligadas a indexador — buscar em
   `ALL_OBJECTS` (`OWNER='SULGOIANO'`) por `OBJECT_TYPE IN ('FUNCTION',
   'PROCEDURE','PACKAGE')` com nome contendo `IND` ou `COTA` ou `SACA`.
3. **Decompor a função `VALOR_ABERTO_RECEBER_DATA`** — dá pra ver o código
   fonte dela? (`ALL_SOURCE` ou `DBA_SOURCE` se houver permissão; é só
   leitura, não precisa de permissão de execução de DDL.) Se conseguirmos
   ver a lógica de indexação ali, talvez seja replicável em SQL/JS.
4. Avaliar se vale a pena, ou se a resposta é simplesmente "não, fica como
   está" — o snapshot via função Oracle já funciona e está validado. Essa
   investigação só tem valor se abrir um caminho **realista** para um
   cálculo auxiliar sem ida ao Oracle; não é prioridade crítica.

## Acesso

Oracle: somente leitura, schema `SULGOIANO`, credenciais em `.env`
(`ORACLE_*`). **Nunca executar DML/DDL no Oracle.** PostgreSQL local via
`.env` (`PG_*`). Use `packages/etl/src/db/oracle.js` (`oracle.query(sql,
binds)`) para consultas exploratórias.
