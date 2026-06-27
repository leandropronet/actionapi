# ActionAPI

Data warehouse incremental (Oracle → PostgreSQL) com API REST para o SaaS agrícola **SiAGRI**.

## Visão geral

```
Oracle ERP (SiAGRI)
       │
       │  ETL incremental (node-schedule)
       ▼
PostgreSQL 16 — schema raw.*
       │
       │  Fastify REST API (X-API-Key ou sessão)
       ▼
Integrações / Painel / Swagger
```

O ERP SiAGRI roda on-premise com banco Oracle. O ActionAPI lê os dados do Oracle via ETL incremental, armazena no PostgreSQL local e expõe via API REST somente leitura. A Fase 2 (write-back: baixa de duplicatas, protocolo NF) está planejada mas não implementada.

Documentação:

- [Metodologia das APIs](docs/METODOLOGIA_APIS.md) — fontes Oracle,
  relacionamentos, cálculos, validações e limitações de cada endpoint;
- [Guia de uso](docs/API.md) — autenticação, exemplos e Power BI/Excel;
- [Segurança](docs/SECURITY.md) — controles e implantação recomendada.

---

## Stack de tecnologias

| Camada | Tecnologia | Versão |
|---|---|---|
| ERP (fonte) | Oracle Database | — |
| Driver Oracle | `oracledb` thin mode (puro JS, sem Instant Client) | 6.x |
| ETL scheduler | `node-schedule` | — |
| Data warehouse | PostgreSQL | 16 |
| Driver PostgreSQL | `pg` (node-postgres) | — |
| API framework | Fastify | 5.x |
| Documentação | OpenAPI + Swagger UI | 3.0 |
| Frontend | HTML/CSS/JS servido pelo Fastify | — |
| Runtime | Node.js | 20+ |
| Containers | Docker / Docker Compose | — |
| OS destino | Windows Server 2019 | — |

---

## Estrutura do projeto

```
ActionAPI/
├── migrations/
│   └── 001_schema_raw.sql       # Schema PostgreSQL — criado automaticamente pelo Docker
│
├── packages/
│   ├── etl/                     # Serviço ETL (rodado como container)
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js             # Scheduler principal (node-schedule)
│   │       ├── oracle-config.js     # Mapeamento de todas as tabelas Oracle
│   │       ├── upsert.js            # Helper upsertRaw() e controle de sync
│   │       ├── db/
│   │       │   ├── oracle.js        # Pool Oracle (thin mode, sem Instant Client)
│   │       │   └── postgres.js      # Pool PostgreSQL
│   │       ├── jobs/                # Um arquivo por domínio de dados
│   │       │   ├── faturamento.js   # NF-e (NOTA + INOTA)
│   │       │   ├── pedidos.js       # Pedidos de venda (PEDIDO + IPEDIDO)
│   │       │   ├── duplicatas.js    # Títulos a receber (CABREC + RECEBER)
│   │       │   ├── financeiro.js    # CP/CR (CABPAGAR+PAGAR, CABREC+RECEBER)
│   │       │   ├── recebimentos.js  # Baixas CR (CRCBAIXA)
│   │       │   ├── pagamentos.js    # Baixas CP (CPGBAIXA)
│   │       │   ├── estoque.js       # Saldo CCSALDO (view Oracle)
│   │       │   ├── lotes.js         # Lotes de produto (LOTE + ILOTE)
│   │       │   ├── saldo_lote.js    # Saldo por lote via função Oracle SALDO_LOTE()
│   │       │   ├── contabil.js      # Lançamentos (CABLANCTB + LANCONTAB)
│   │       │   └── dimensoes.js     # Dimensões: clientes, produtos, grupos,
│   │       │                        #   vendedores, filiais, PAs, propriedades, etc.
│   │       ├── carga_inicial/       # Carga histórica mensal, resumível e configurável por data
│   │       │   └── index.js         # Orquestrador resumível via etl_carga_inicial
│   │       └── transforms/
│   │           └── analytics.js     # Materializa camada analytics (futuro)
│   │
│   └── api/                     # Serviço API REST (rodado como container)
│       ├── Dockerfile
│       ├── package.json
│       └── src/
│           ├── app.js               # Fastify: registra rotas, auth hook, error handler
│           ├── config.js            # Lê PORT, LOG_LEVEL do .env
│           ├── db/postgres.js       # Pool PostgreSQL compartilhado
│           ├── middleware/auth.js   # X-API-Key ou sessão administrativa
│           ├── openapi.js           # Contrato Swagger/OpenAPI
│           ├── public/              # Login e painel somente leitura
│           ├── routes/              # Um arquivo por domínio
│           └── services/            # Queries PostgreSQL, lógica de negócio
│
├── docker-compose.yml           # Sobe postgres + etl-service + actionapi
├── .env                         # Configurações locais (NÃO versionar)
└── .env.example                 # Template de variáveis (versionado)
```

---

## Pré-requisitos

- **Docker Desktop** (ou Docker Engine + Compose)
- **Node.js 20+** (apenas para desenvolvimento local sem Docker)
- Acesso de rede ao Oracle ERP (porta 1521)
- PostgreSQL 16 nativo opcional (o Docker já sobe um)

---

## Instalação e execução

### 1. Clone o repositório

```bash
git clone https://github.com/<org>/ActionAPI.git
cd ActionAPI
```

### 2. Configure o `.env`

Copie o template e preencha:

```bash
cp .env.example .env
```

Variáveis obrigatórias:

```env
# Oracle ERP (SiAGRI)
ORACLE_HOST=10.62.27.5
ORACLE_PORT=1521
ORACLE_SERVICE=ORCL
ORACLE_SCHEMA=SULGOIANO
ORACLE_USER=<usuário>
ORACLE_PASS=<senha>
ORACLE_POOL_MAX=3

# PostgreSQL
PG_HOST=postgres        # "postgres" dentro do Docker; "localhost" fora
PG_PORT=5432
PG_DATABASE=actionapi
PG_USER=actionapi
PG_PASS=<senha forte>

# Auth API
API_KEYS=chave1,chave2  # múltiplas chaves separadas por vírgula

# Painel e Swagger
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<gere com npm run hash-password>
SESSION_SECRET=<segredo aleatório com 32+ caracteres>
COOKIE_SECURE=true
ENFORCE_HTTPS=true
TRUST_PROXY=true

# Porta da API
PORT=3000
```

### 3. Suba os containers

```bash
docker compose up -d
```

Antes de subir, gere o hash da senha administrativa:

```bash
cd packages/api
npm install
npm run hash-password -- "uma-senha-longa-e-exclusiva"
```

Copie o resultado para `ADMIN_PASSWORD_HASH` no `.env`.

Isso vai:
1. Subir o PostgreSQL e rodar `migrations/001_schema_raw.sql` automaticamente
2. Subir o ETL (aguarda o PostgreSQL ficar saudável)
3. Subir a API na porta `PORT` (padrão 3000)

### 4. Execute a carga inicial (apenas uma vez)

O ETL incremental mantém os dados atuais por cursor de alteração. Para carregar
histórico, use a carga inicial mensal e resumível:

```bash
# Dentro do container ETL
docker compose exec etl-service node src/carga_inicial/index.js
```

O progresso é salvo em `etl_carga_inicial` — se interrompido, re-execute que continua de onde parou.

Para fixar a carga histórica em uma data inicial absoluta, use
`CARGA_INICIAL_DESDE=AAAA-MM-DD` no `.env`. Quando essa variável está definida,
ela tem prioridade sobre `CARGA_INICIAL_ANOS`; por exemplo,
`CARGA_INICIAL_DESDE=2015-01-01` mantém a carga sempre desde 01/01/2015.

Backfills históricos específicos também estão disponíveis para lacunas que não
dependem da tabela `etl_carga_inicial`, por exemplo:

```bash
cd packages/etl
npm run faturamento:backfill -- 2015
npm run nfe-entrada:backfill -- 2015
npm run pedidos:backfill -- 2015
node src/scripts/backfill-duplicatas.js 2015
node src/scripts/backfill-recebimentos.js 2015
node src/scripts/backfill-contabil-historico.js --desde 2015-01-01 --ate 2027-01-01
```

### 5. Verifique

```bash
# Health check (sem auth)
curl http://localhost:3000/health

# Teste de autenticação
curl -H "X-API-Key: chave1" "http://localhost:3000/api/v1/faturamento?dataInicio=2024-01-01"
```

Interfaces web:

- `https://seu-host/login` — autenticação;
- `https://seu-host/painel` — consultas visuais;
- `https://seu-host/docs` — Swagger/OpenAPI.

Em desenvolvimento HTTP local, use `COOKIE_SECURE=false` e
`ENFORCE_HTTPS=false`. Em produção, mantenha ambos como `true` atrás de um
reverse proxy HTTPS.

---

## Desenvolvimento local sem Docker

```bash
# Terminal 1 — apenas o PostgreSQL
docker compose up postgres -d

# Terminal 2 — ETL
cd packages/etl
npm install
node src/index.js

# Terminal 3 — API
cd packages/api
npm install
node src/app.js
```

> **Atenção:** em dev local, `PG_HOST=localhost` no `.env`.

---

## Schema PostgreSQL

### `raw.*` — espelho fiel do Oracle

Cada tabela tem:
- Colunas extraídas para filtro/índice (ex: `filial_id`, `data_emissao`)
- `_dados JSONB` — registro Oracle completo, preservado sem transformação
- `_sync_at TIMESTAMPTZ` — timestamp do último upsert
- `_source TEXT` — origem (`siagri`; extensível para outros ERPs)

Controle de sincronização em `etl_sync (dominio, ultimo_sync)`.

### `analytics.*` — camada analítica (star schema, em construção)

Dimensões (`dim_produto`, `dim_cliente`, etc.) e fatos (`fact_faturamento`, etc.) — materializada pelo `transforms/analytics.js`.

---

## ETL — Jobs agendados

| Job | Tabela Oracle | Tabela PostgreSQL | Frequência padrão |
|---|---|---|---|
| `dimensoes` | CADEMP, TRANSAC, PRODSERV, GRUPO, PESSOAL, PROPRIED, PRINATIVOS, PRINCIPIOATIVO_REC, etc. | `raw.filiais`, `raw.clientes`, `raw.fornecedores`, `raw.produtos`, `raw.grupos`, `raw.vendedores`, `raw.propriedades`, `raw.principios_ativos`, `raw.principios_ativos_rec`, `raw.produto_principio_ativo_rec` | Diário 06:00 |
| `faturamento` | NOTA + INOTA + TIPOOPER | `raw.faturamento` + `raw.faturamento_itens` | A cada hora |
| `nfe_entrada` | NFENTRA + INFENTRA | `raw.nfe_entrada` + `raw.nfe_entrada_itens` | A cada hora |
| `pedidos` | PEDIDO + IPEDIDO | `raw.pedidos` + `raw.pedidos_itens` | A cada 30 min |
| `pedidos_compra` | PEDCOM + IPEDCOM + PARCPEDCOM | `raw.pedidos_compra` + `raw.pedidos_compra_itens` + `raw.pedidos_compra_parcelas` | A cada hora |
| `duplicatas` | CABREC + RECEBER | `raw.duplicatas` + `raw.duplicatas_parcelas` | A cada hora |
| `financeiro` | CABPAGAR+PAGAR, CABREC+RECEBER | `raw.financeiro_cp`, `raw.financeiro_cr` | A cada hora |
| `recebimentos` | CRCBAIXA | `raw.recebimentos` | A cada hora |
| `pagamentos` | CPGBAIXA | `raw.pagamentos` | A cada hora |
| `lotes` | LOTE + ILOTE | `raw.lotes` + `raw.lotes_filial` | Diário 06:00 |
| `saldo_lote` | DADOSPRO + LOTE + fn SALDO_LOTE() | `raw.saldo_lote` | Diário 06:30 |
| `estoque` | CCSALDO (view) | `raw.estoque` | A cada 10 min |
| `contabil` | CABLANCTB + LANCONTAB | `raw.contabil` + `raw.contabil_lancamentos` | Diário 01:00 |
| `conciliacao` | CABLANCTB + CABPAGAR + CABREC | cabeçalhos para BI e conciliação | A cada hora, minuto 15 |

O ETL é **incremental**: cada job lê `etl_sync.ultimo_sync` e busca apenas `WHERE DUMANUT > :ultimoSync`. CLOBs do Oracle são convertidos para string automaticamente via `oracledb.fetchAsString = [oracledb.CLOB]`.

---

## API REST

Todas as rotas aceitam o header `X-API-Key: <chave>`. O painel e o Swagger
também podem consultar as APIs pela sessão administrativa.

Consulte também:

- [Guia completo de uso](docs/API.md)
- [Segurança e implantação](docs/SECURITY.md)
- [Operação permanente do ETL e alertas Telegram](docs/OPERACAO_ETL.md)
- Swagger interativo em `/docs`

Resposta padrão de lista:
```json
{ "data": [], "total": 100, "page": 1, "pageSize": 100 }
```

Erro padrão:
```json
{ "error": "mensagem", "code": "NOT_FOUND" }
```

### Endpoints implementados

#### Faturamento (NF-e)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/faturamento` | Lista NFs com filtros |
| GET | `/api/v1/faturamento/resumo` | Totais agrupados por período |
| GET | `/api/v1/faturamento/itens` | Itens de NF com filtros de produto/grupo/PA |
| GET | `/api/v1/faturamento/:id` | NF completa com itens |

**Filtros disponíveis:** `dataInicio`, `dataFim`, `filialId`, `clienteId`, `vendedorId`, `status`, `tranTop` (1=Entrada, 2=Saída), `operacaoId`, `grupoId`, `subgrupoId`, `produtoId`, `principioAtivoId`, `principioAtivoRecId`, `pedidoId`, `page`, `pageSize`

No endpoint `/faturamento/resumo`, informe `paramId` para obter o consolidado
pelas funções A/S, incluindo devoluções registradas em `NFENTRA`. Exemplo:

`GET /api/v1/faturamento/resumo?paramId=102&dataInicio=2025-01-01&dataFim=2025-12-31`

**Nota:** `tran_top=2` = saídas (vendas). `tran_top=1` = entradas (devoluções de venda / compras).

#### NF-e de Entrada e Devoluções

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/entradas` | Lista NF-e de entrada |
| GET | `/api/v1/entradas/resumo` | Totais agrupados por período |
| GET | `/api/v1/entradas/itens` | Itens e dados tributários |
| GET | `/api/v1/entradas/devolucoes` | Devoluções vinculadas ao parâmetro 102 |
| GET | `/api/v1/entradas/:id` | NF-e de entrada completa |

**Filtros:** `dataInicio`, `dataFim`, `dataRecebDe`, `dataRecebAte`,
`filialId`, `parceiroId`, `operacaoId`, `grupoId`, `produtoId`, `paramId`,
`funcao`, `page` e `pageSize`.

#### Pedidos de Venda

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/pedidos` | Lista pedidos com filtros |
| GET | `/api/v1/pedidos/resumo` | Totais agrupados por período, breakdown de status |
| GET | `/api/v1/pedidos/itens` | Itens de pedido com filtros de produto/grupo/PA |
| GET | `/api/v1/pedidos/:id` | Pedido completo com itens |
| GET | `/api/v1/pedidos/:id/faturamento` | NFs emitidas originadas deste pedido |
| GET | `/api/v1/pedidos/:id/saldo` | Saldo por produto (pedido − faturado) + status comercial |

**Filtros disponíveis:** `dataInicio`, `dataFim`, `filialId`, `clienteId`, `vendedorId`, `status` (0/1/5/9), `origem` (S=CRM, null=ERP), `grupoId`, `subgrupoId`, `produtoId`, `principioAtivoId`, `principioAtivoRecId`, `page`, `pageSize`

**Status financeiro (`status` / `SITU_PED`):**  
`0` = Não Liberado | `1` = Liberado | `5` = Confirmado | `9` = Cancelado

**Status comercial (`GET /pedidos/:id/saldo`):**  
`ABERTO` = nenhum item faturado ainda  
`FATURADO_PARCIALMENTE` = parte dos itens faturada  
`FATURADO_INTEGRAL` = todos os itens faturados  

**Origem (`origem`):**  
`S` = CRM SiAGRI | `M` = Mobile | `null` = inserido diretamente no ERP

#### Pedidos de Compra

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/pedidos-compra` | Lista pedidos de compra com filtros |
| GET | `/api/v1/pedidos-compra/itens-abertos` | Itens com saldo pendente de recebimento |
| GET | `/api/v1/pedidos-compra/resumo` | Valor em aberto agregado por filial/fornecedor |
| GET | `/api/v1/pedidos-compra/:id` | Pedido completo com itens e parcelas |

**Filtros disponíveis:** `dataInicio`/`dataFim` (sobre a data do pedido), `filialId`, `fornecedorId`, `status`, `produtoId` (em `/itens-abertos`), `incluirCancelados` (`true`/`false`, padrão `false`), `page`, `pageSize`

**Saldo em aberto:** `qtd_pedida - qtd_recebida` por item. Pedidos com
`status=C` (cancelado) são excluídos do saldo por padrão — ficam com
`qtd_recebida=0` no ERP mesmo sem expectativa real de recebimento.

**Status (`status` / `STAT_PEC`):** `P` = Pendente | `A` = Aprovado | `C` = Cancelado
— significado inferido por amostragem do Oracle (jun/2026), **não confirmado**
em documentação do SiAGRI. Compare com o relatório de pedidos de compra do
ERP antes de usar os números para tomada de decisão.

**Vínculo com Contas a Pagar:** implementado em `GET /pedidos-compra/:id`
(campo `notas_entrada`). A cadeia é `PEDCOM → INFENTRA (EMPR_PEC+NUME_PEC)
→ NFENTRA → CABPAGAR`, com o último salto via FK real do Oracle:
`NOTACPG.CTRL_NCP → NFENTRA.CTRL_NFE` (98,4% de integridade validada em
2026-06 — muito mais confiável que comparar `DOCU_CPG` com o número da NF,
que tem erros de digitação reais já encontrados). Cobre títulos originados
de NF de compra; **não cobre Adiantamento a Fornecedor** (paga antes da NF
existir) — o "número de pedido" citado no histórico desses títulos não
corresponde a nenhum `PEDCOM`/`SOLICOMPRA` real nesta base, sem link
estruturado encontrado ainda. Pedidos sem NF de entrada sincronizada
retornam `notas_entrada: []` (a sincronização de itens de `nfe_entrada`
ainda não cobre 100% do histórico do Oracle).

**Nomes de fornecedor:** resolvidos via `raw.fornecedores` (`TRANSAC` com
`FORN_TRA='S'`, sem depender da extensão `CLIENTE`), com fallback para
`raw.clientes` para parceiros que são cliente e fornecedor ao mesmo tempo.

#### Duplicatas / Contas a Receber

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/duplicatas` | Lista duplicatas com filtros |

**Filtros:** `filialId`, `clienteId`, `nfId`, `vencimentoDe`, `vencimentoAte`, `status` (A=Aberto, B=Baixado, C=Cancelado), `page`, `pageSize`

#### Estoque

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/estoque` | Saldo de estoque por produto/filial/depósito |
| GET | `/api/v1/estoque/saldo-lote` | Saldo por lote com data de validade |

#### Lotes

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/lotes` | Saldo de lotes com filtros (snapshot diário) |
| GET | `/api/v1/lotes/vencendo` | Lotes vencendo nos próximos N dias |
| GET | `/api/v1/lotes/resumo` | Totais por grupo e filial |

**Filtros de `/lotes`:** `filialId`, `produtoId`, `grupoId`, `vencendoEm` (dias), `saldoMinimo`, `page`, `pageSize` (máx 1000)  
**Filtros de `/lotes/vencendo`:** `dias` (padrão 30), `filialId`, `grupoId`

#### Financeiro

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/financeiro?tipo=CP` | Contas a pagar |
| GET | `/api/v1/financeiro?tipo=CR` | Contas a receber |
| GET | `/api/v1/financeiro/fluxo-caixa` | Saldo diário receber−pagar por período |
| GET | `/api/v1/financeiro/contas-pagar` | Parcelas a pagar com fornecedor, vencimento, pedidos e produtos |
| GET | `/api/v1/financeiro/contas-pagar/resumo` | Totais a pagar por fornecedor e filial |

**Filtros:** `tipo` (CP/CR), `filialId`, `vencimentoDe`, `vencimentoAte`, `page`, `pageSize`

O endpoint especializado `/financeiro/contas-pagar` retorna uma linha por
parcela e calcula `ABERTA`, `PARCIAL` ou `BAIXADA` pelas baixas normais de
`CPGBAIXA` ocorridas até a data do cálculo. Os pedidos e produtos são agregados
por título antes do `JOIN`, portanto uma nota com vários itens não multiplica
o valor financeiro.

O saldo reproduz localmente `VALOR_ABERTO_PAGAR_DATA`, incluindo indexadores,
cotação da data original e de cada baixa, agrupamentos e tolerância por filial.
Em 20/06/2026, as 183.656 parcelas foram comparadas com a função Oracle sem
nenhuma divergência. Para títulos indexados, `unidade_saldo` identifica se o
valor está em `SJ$`, `US$`, `ER` ou `R$`; `saldo_convertido_atual` apresenta
separadamente uma conversão pela cotação mais recente.

**Filtros do contas a pagar:** `filialId`, `fornecedorId`, `tipoDocumento`,
`emissaoDe`, `emissaoAte`, `vencimentoDe`, `vencimentoAte`, `pedidoId`
(`filial_numero`), `produtoId`, `situacao`, `faixaVencimento`,
`statusVinculo`, `conferenciaPedido`, `somenteEmAberto` (padrão `true`),
`page` e `pageSize` (máx. 10.000).

**Vínculo de pedido:** `CABPAGAR ← NOTACPG → INFENTRA → PEDCOM`. É uma
relação estrutural do Oracle, sem comparação por texto ou número digitado.
`status_vinculo_pedido` informa se o título tem pedido, somente NF ou nenhum
dos dois. `conferencia_pedido` sinaliza divergência de fornecedor e/ou
filial entre o título e o pedido. Adiantamentos e empréstimos normalmente
não têm pedido e permanecem disponíveis no dashboard.

Para Excel ou Power BI, acrescente `format=csv`. Exemplo:

```text
/api/v1/financeiro/contas-pagar?vencimentoDe=2026-01-01&vencimentoAte=2026-12-31&pageSize=10000&format=csv
```

Validação técnica dos saldos contra as funções Oracle:

```powershell
cd packages/etl
npm run financeiro:recalcular-saldos
npm run financeiro:validar-saldos
```

Gerador Python do relatório avançado:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements-relatorio-contas-pagar.txt

.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_pagar.py `
  --vencimento-de 2026-07-01 `
  --vencimento-ate 2026-12-31 `
  --arquivo relatorios\contas-pagar-segundo-semestre.xlsx
```

Relatório avançado de Contas a Receber:

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_receber.py `
  --vencimento-de 2026-07-01 `
  --vencimento-ate 2026-12-31 `
  --arquivo relatorios\contas-receber-segundo-semestre.xlsx
```

O relatório preserva o saldo oficial na unidade do título (`R$`, `SJ$`,
`US$` ou `ER`) e apresenta separadamente a conversão atual estimada em reais.

### Relatórios executivos CEO/CFO

Gera faturamento, contas a receber, contas a pagar, contas recebidas, contas
pagas, contabilidade e uma visão consolidada 360°:

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorios_executivos.py `
  --data-inicio 2026-01-01 `
  --data-fim 2026-06-20
```

Os arquivos são gravados em `relatorios/executivo`. Consulte
`docs/RELATORIOS_EXECUTIVOS.md` para indicadores, critérios e endpoints.

Scripts individuais:

```text
scripts/gerar_relatorio_faturamento.py
scripts/gerar_relatorio_contas_recebidas.py
scripts/gerar_relatorio_contas_pagas.py
scripts/gerar_relatorio_contabilidade.py
scripts/gerar_relatorio_visao_360.py
```

Os scripts aceitam períodos automáticos:

```powershell
--safra 2025/2026       # 01/07/2025 a 30/06/2026
--bayer 2025/2026       # 01/04/2025 a 30/03/2026
--ano-contabil 2025     # 01/01/2025 a 31/12/2025
--data-inicio 15082025 --data-fim 30112025
```

Use somente um desses tipos de intervalo por execução.
Datas personalizadas também aceitam `15/08/2025` e `2025-08-15`. Nas
planilhas, a exibição permanece em `DD/MM/AAAA`.

Se nenhum período for informado, os scripts abrem um menu simples no terminal
para escolher Safra, Bayer, ano contábil, intervalo livre ou ano atual.

O script consome somente a ActionAPI. Ele separa pedido interno do SiAGRI,
pedido informado pelo fornecedor e controle interno da NF, além de distinguir
divergência real de fornecedor de estabelecimentos com a mesma raiz de CNPJ.

#### Clientes

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/clientes` | Lista clientes |
| GET | `/api/v1/clientes/:id` | Cliente completo |
| GET | `/api/v1/clientes/:id/faturamento` | NFs emitidas para o cliente |
| GET | `/api/v1/clientes/:id/pedidos` | Pedidos do cliente |
| GET | `/api/v1/clientes/:id/propriedades` | Propriedades rurais vinculadas |
| GET | `/api/v1/clientes/:id/resumo` | Totais de faturamento e pedidos |

**Filtros de `/clientes`:** `search` (razão social ou fantasia), `cgcCnpj`, `status` (A/I), `page`, `pageSize`

#### Contabilidade

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/contabil` | Partidas contábeis com filtros |
| GET | `/api/v1/contabil/saldo-contas` | Débito/crédito/saldo por conta e competência |
| GET | `/api/v1/contabil/resumo` | Totais mensais por competência |

**Filtros de `/contabil`:** `filialId`, `competencia` (AAAA-MM), `conta` (CODI_CPC), `planoContas` (CODI_PLC), `tipo` (F=Fiscal, S=Societário), `page`, `pageSize`  
**Campos retornados:** `lancamento_id`, `documento`, `tipo`, `conta`, `plano_contas`, `tipo_partida` (D=Débito/C=Crédito), `valor`, `historico`

#### Power BI, Excel e Conciliação

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/bi/financeiro` | Dataset plano por parcela, título e baixa |
| GET | `/api/v1/bi/contabil` | Dataset plano por partida contábil |
| GET | `/api/v1/bi/analise-contabil` | Dataset mensal no modelo da planilha de análise contábil |
| GET | `/api/v1/conciliacao/financeiro-contabil` | Situação de cada título |
| GET | `/api/v1/conciliacao/financeiro-contabil/divergencias` | Apenas inconsistências |
| GET | `/api/v1/conciliacao/financeiro-contabil/resumo` | Totais por tipo e classificação |

Todos exigem `dataInicio` e `dataFim`. Use `format=csv` para Excel ou consumo
tabular simples. O JSON é paginado e aceita até 10.000 linhas por página.

`/api/v1/bi/analise-contabil` retorna uma linha por competência, código de loja, conta
e centro de custo. Inclui natureza contábil, grupos de nível 1 a 3, safra e
classificação `EBITDA`, `RF` ou `DA`. A regra reproduz a planilha exemplo:
plano de contas `1000002`, contabilidade fiscal, exclusão da origem `ZR`,
crédito positivo e débito negativo.

O período de safra é de **1º de julho a 30 de junho**. Portanto,
`Safra 2024/2025` compreende de `2024-07-01` até `2025-06-30`.

```text
/api/v1/bi/analise-contabil?dataInicio=2025-01-01&dataFim=2025-12-31&pageSize=10000
/api/v1/bi/analise-contabil?dataInicio=2025-01-01&dataFim=2025-12-31&format=csv&pageSize=10000
```

Filtros adicionais: `filialId`, `conta`, `ccustoId`, `naturezaContabil`,
`classificacaoEbitda`, `safra` e `statusLoja`. Neste endpoint, `pageSize` aceita até 200.000
linhas para permitir a extração integral do período em CSV.

O campo `codigo_loja` é sempre o código gravado no cabeçalho contábil
`CABLANCTB`. A API não preenche lojas pelo centro de custo. Para auditoria,
ela também retorna `codigo_loja_referencia_cc` e `status_loja`, permitindo
identificar códigos ausentes ou diferentes da referência indicada pelo centro
de custo sem substituir o dado original do ERP.

Além dos datasets especializados, todas as rotas GET de `/api/v1/*` aceitam
`format=csv`, inclusive faturamento, pedidos, estoque, lotes, clientes,
baixas, contabilidade e DRE.

---

## Princípios ativos de produtos

Existem **duas fontes** de princípio ativo no SiAGRI:

| Fonte | Tabela Oracle | Vinculação | Campo descrição | Registros |
|---|---|---|---|---|
| ERP | `PRINATIVOS` | `PRODSERV.CODI_PRI` | `DESC_PRI` (VARCHAR) | ~212 |
| Receituário agronômico | `PRINCIPIOATIVO_REC` | `PRODSERV → PRODUTO.CODI_PRR → PRODPRIATIVO_REC` | `DESC_PRA` (CLOB) | ~1.539 |

Ambos são retornados nos endpoints de itens como `principio_ativo_id`/`principio_ativo_desc` (ERP) e `principio_ativo_rec_id`/`principio_ativo_rec_desc` (receituário). São filtráveis independentemente via `principioAtivoId` e `principioAtivoRecId`.

---

## Autenticação

Todas as rotas `/api/v1/*` exigem o header:

```
X-API-Key: <chave>
```

Chaves são configuradas em `API_KEYS=chave1,chave2,...` no `.env`.

A rota `/health` é pública (sem auth).

---

## Variáveis de ambiente (`.env.example`)

```env
# Oracle ERP
ORACLE_HOST=
ORACLE_PORT=1521
ORACLE_SERVICE=
ORACLE_SCHEMA=SULGOIANO
ORACLE_USER=
ORACLE_PASS=
ORACLE_POOL_MAX=3

# PostgreSQL
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=actionapi
PG_USER=actionapi
PG_PASS=

# Auth API
API_KEYS=

# Crons ETL (formato cron padrão Unix)
CRON_ESTOQUE=*/10 * * * *
CRON_PEDIDOS=*/30 * * * *
CRON_FATURAMENTO=0 * * * *
CRON_DUPLICATAS=0 * * * *
CRON_FINANCEIRO=0 * * * *
CRON_RECEBIMENTOS=0 * * * *
CRON_PAGAMENTOS=0 * * * *
CRON_LOTES=0 6 * * *
CRON_SALDO_LOTE=30 6 * * *
CRON_CONTABIL=0 1 * * *
CRON_DIMENSOES=0 6 * * *

# API
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

---

## Observações de segurança

- O arquivo `.env` **nunca** deve ser versionado (está no `.gitignore`)
- O acesso ao Oracle é **somente leitura** — o usuário Oracle configurado deve ter apenas `SELECT`
- As senhas do `.env` têm caracteres especiais (`$`, `!`) — ao usar `psql` no PowerShell, setar `$env:PGPASSWORD` com aspas simples: `$env:PGPASSWORD = 'senha'`

---

## Deploy em servidor (homologação / produção)

O servidor alvo já roda outros serviços em `C:\OnPremise\compose.yaml`.

1. Copie o código para o servidor
2. Crie `.env.homologacao` e `.env.producao` com as credenciais corretas
3. Adicione o serviço ao `compose.yaml` existente com porta e env_file adequados
4. `docker compose up actionapi-hml -d`
5. Execute a carga inicial dentro do container

---

## Status de implementação

| Domínio | ETL | API | Observações |
|---|---|---|---|
| Faturamento NF-e | ✅ | ✅ | 4 endpoints + filtros por produto/grupo/PA |
| Pedidos | ✅ | ✅ | 6 endpoints, saldo derivado, origem CRM |
| Duplicatas / CR | ✅ | ✅ | — |
| Estoque | ✅ | ✅ | — |
| Saldo por Lote | ✅ | ✅ | Via função Oracle SALDO_LOTE() |
| Financeiro CP/CR | ✅ | ✅ | — |
| Recebimentos / Baixas CR | ✅ | ✅ | — |
| Pagamentos / Baixas CP | ✅ | ✅ | — |
| Lotes | ✅ | ✅ | 3 endpoints: listar, vencendo, resumo |
| Contabilidade | ✅ | ✅ | 3 endpoints: partidas, saldo-contas, resumo mensal |
| Clientes | ✅ | ✅ | 6 endpoints + resumo, propriedades |
| Pedidos pagos (financeiro) | — | — | Requer link Pedido→Duplicata→Recebimento |
