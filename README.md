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
       │  Fastify REST API (X-API-Key)
       ▼
SaaS / Dashboards
```

O ERP SiAGRI roda on-premise com banco Oracle. O ActionAPI lê os dados do Oracle via ETL incremental, armazena no PostgreSQL local e expõe via API REST somente leitura. A Fase 2 (write-back: baixa de duplicatas, protocolo NF) está planejada mas não implementada.

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
│   │       ├── carga_inicial/       # Carga histórica (5 anos, batch mensal)
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
│           ├── middleware/auth.js   # X-API-Key (header obrigatório em /api/*)
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

# Porta da API
PORT=3000
```

### 3. Suba os containers

```bash
docker compose up -d
```

Isso vai:
1. Subir o PostgreSQL e rodar `migrations/001_schema_raw.sql` automaticamente
2. Subir o ETL (aguarda o PostgreSQL ficar saudável)
3. Subir a API na porta `PORT` (padrão 3000)

### 4. Execute a carga inicial (apenas uma vez)

O ETL incremental parte de 2020-01-01 por padrão. Para carregar o histórico completo (5 anos):

```bash
# Dentro do container ETL
docker compose exec etl-service node src/carga_inicial/index.js
```

O progresso é salvo em `etl_carga_inicial` — se interrompido, re-execute que continua de onde parou.

### 5. Verifique

```bash
# Health check (sem auth)
curl http://localhost:3000/health

# Teste de autenticação
curl -H "X-API-Key: chave1" "http://localhost:3000/api/v1/faturamento?dataInicio=2024-01-01"
```

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
| `dimensoes` | CADEMP, TRANSAC, PRODSERV, GRUPO, PESSOAL, PROPRIED, PRINATIVOS, PRINCIPIOATIVO_REC, etc. | `raw.filiais`, `raw.clientes`, `raw.produtos`, `raw.grupos`, `raw.vendedores`, `raw.propriedades`, `raw.principios_ativos`, `raw.principios_ativos_rec`, `raw.produto_principio_ativo_rec` | Diário 06:00 |
| `faturamento` | NOTA + INOTA + TIPOOPER | `raw.faturamento` + `raw.faturamento_itens` | A cada hora |
| `pedidos` | PEDIDO + IPEDIDO | `raw.pedidos` + `raw.pedidos_itens` | A cada 30 min |
| `duplicatas` | CABREC + RECEBER | `raw.duplicatas` + `raw.duplicatas_parcelas` | A cada hora |
| `financeiro` | CABPAGAR+PAGAR, CABREC+RECEBER | `raw.financeiro_cp`, `raw.financeiro_cr` | A cada hora |
| `recebimentos` | CRCBAIXA | `raw.recebimentos` | A cada hora |
| `pagamentos` | CPGBAIXA | `raw.pagamentos` | A cada hora |
| `lotes` | LOTE + ILOTE | `raw.lotes` + `raw.lotes_filial` | Diário 06:00 |
| `saldo_lote` | DADOSPRO + LOTE + fn SALDO_LOTE() | `raw.saldo_lote` | Diário 06:30 |
| `estoque` | CCSALDO (view) | `raw.estoque` | A cada 10 min |
| `contabil` | CABLANCTB + LANCONTAB | `raw.contabil` + `raw.contabil_lancamentos` | Diário 01:00 |

O ETL é **incremental**: cada job lê `etl_sync.ultimo_sync` e busca apenas `WHERE DUMANUT > :ultimoSync`. CLOBs do Oracle são convertidos para string automaticamente via `oracledb.fetchAsString = [oracledb.CLOB]`.

---

## API REST

Todas as rotas exigem o header `X-API-Key: <chave>`.

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

**Nota:** `tran_top=2` = saídas (vendas). `tran_top=1` = entradas (devoluções de venda / compras).

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

#### Duplicatas / Contas a Receber

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/duplicatas` | Lista duplicatas com filtros |
| GET | `/api/v1/duplicatas/resumo` | Totais por período |
| GET | `/api/v1/duplicatas/:id` | Duplicata completa com parcelas |

#### Estoque

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/estoque` | Saldo de estoque por produto/filial/depósito |
| GET | `/api/v1/estoque/saldo-lote` | Saldo por lote com data de validade |

#### Financeiro

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/financeiro/cp` | Contas a pagar |
| GET | `/api/v1/financeiro/cr` | Contas a receber |
| GET | `/api/v1/financeiro/recebimentos` | Baixas de CR |
| GET | `/api/v1/financeiro/pagamentos` | Baixas de CP |

#### Clientes

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/clientes` | Lista clientes |
| GET | `/api/v1/clientes/:id` | Cliente completo |

#### Contabilidade

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/contabil` | Lançamentos contábeis |
| GET | `/api/v1/contabil/resumo` | Saldos por conta/período |

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
| Lotes | ✅ | — | ETL feito, API pendente |
| Contabilidade | ✅ | parcial | — |
| Clientes | ✅ | parcial | — |
| Pedidos pagos (financeiro) | — | — | Requer link Pedido→Duplicata→Recebimento |
