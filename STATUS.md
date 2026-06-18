# ActionAPI — Status de Desenvolvimento e Validação

> Última atualização: 2026-06-17  
> Branch: main

---

## Checklist de Módulos

### ✅ Contábil — VALIDADO com relatório ERP

| Item | Status |
|------|--------|
| ETL incremental `raw.contabil` (CABLANCTB + LANCONTAB) | ✅ Funcionando |
| ETL desdobramento CC `raw.ccustolan` | ✅ Funcionando |
| ETL desdobramento pessoa `raw.corlanpes` | ✅ Funcionando |
| Endpoint `GET /api/v1/contabil` | ✅ Implementado |
| Endpoint `GET /api/v1/contabil/saldo-contas` | ✅ Implementado |
| Endpoint `GET /api/v1/contabil/resumo` | ✅ Implementado |
| Endpoint `GET /api/v1/contabil/balancete` | ✅ Implementado |
| **Balancete 2024 validado contra relatório SiAGRI** | ✅ Todos os grupos batem cent a cent |
| **Balancete 2025 validado contra relatório SiAGRI** | ✅ Todos os grupos batem cent a cent |
| **Reconciliação automática de exclusões** | ✅ Implementado e testado |

#### Validação 2024 — exercício 01/01/2024 a 31/12/2024

| Grupo | PG (API) | SiAGRI (XLS) | Diferença |
|-------|----------|--------------|-----------|
| 1 — Ativo | 1.899.913.382,29 | 1.899.913.382,29 | R$ 0,00 ✅ |
| 2 — Passivo | 409.728.524,25 | 409.728.524,25 | R$ 0,00 ✅ |
| 3 — Receitas | 261.044.875,72 | 261.044.875,72 | R$ 0,00 ✅ |
| 4 — Custo/Despesas | 2.617.174.375,43 | 2.617.174.375,43 | R$ 0,00 ✅ |
| 6 — Compensações | 176.102.018,23 | 176.102.018,23 | R$ 0,00 ✅ |
| 9 — Mov. Transitórios | 358.500.467,53 | 358.500.467,53 | R$ 0,00 ✅ |

#### Validação 2025 — exercício 01/01/2025 a 31/12/2025

| Grupo | PG (API) | SiAGRI (XLS) | Diferença |
|-------|----------|--------------|-----------|
| 1 — Ativo | 1.886.714.694,10 | 1.886.714.694,10 | R$ 0,00 ✅ |
| 2 — Passivo | 467.503.684,59 | 467.503.684,59 | R$ 0,00 ✅ |
| 3 — Receitas | 231.707.631,99 | 231.707.631,99 | R$ 0,00 ✅ |
| 4 — Custo/Despesas | 2.477.948.456,82 | 2.477.948.456,82 | R$ 0,00 ✅ |
| 6 — Compensações | 151.621.785,83 | 151.621.785,83 | R$ 0,00 ✅ |
| 9 — Mov. Transitórios | 334.129.652,20 | 334.129.652,20 | R$ 0,00 ✅ |

#### Reconciliação automática — conferência pós-carga incremental

A função `reconciliar()` em `packages/etl/src/jobs/contabil.js` é executada
automaticamente após cada sync incremental (`sincronizar()`). Ela:

1. Busca todos os IDs do Oracle para o **ano corrente e o anterior** (janela = 2 anos fiscais)
2. Compara com os IDs do PostgreSQL para o mesmo período
3. Deleta do PG qualquer registro que não existe mais no Oracle

Casos cobertos:
- Lançamentos deletados diretamente no Oracle
- Lançamentos renumerados (deletados + recriados com novo SEQU_CLC)
- Encerramentos de exercício refeitos pelo controller (caso real detectado em jun/2026)

Resultado dos testes em 17/06/2026:
- Reconciliação detectou e removeu automaticamente registros de SEQU_CLC
  101124125–101125429 (lançamentos de encerramento antigos substituídos pelo controller)
- Após correção de bug (buffer de data), confirmado **zero falsos positivos**

---

### ⏳ Faturamento

| Item | Status |
|------|--------|
| ETL incremental `raw.faturamento` + `raw.faturamento_itens` | ✅ Funcionando |
| Endpoint `GET /api/v1/faturamento` | ✅ Implementado |
| Endpoint `GET /api/v1/faturamento/resumo` | ✅ Implementado |
| Validação contra relatório ERP | ⏳ Pendente |
| Reconciliação automática de exclusões | ⏳ Pendente |

---

### ⏳ Duplicatas (Contas a Receber)

| Item | Status |
|------|--------|
| ETL incremental `raw.duplicatas` | ✅ Funcionando |
| Endpoint `GET /api/v1/duplicatas` | ✅ Implementado |
| Validação contra relatório ERP | ⏳ Pendente |
| Reconciliação automática de exclusões | ⏳ Pendente |

---

### ⏳ Pedidos

| Item | Status |
|------|--------|
| ETL incremental `raw.pedidos` + `raw.pedidos_itens` | ✅ Funcionando |
| Endpoint `GET /api/v1/pedidos` | ✅ Implementado |
| Validação contra relatório ERP | ⏳ Pendente |
| Reconciliação automática de exclusões | ⏳ Pendente |

---

### ⏳ Estoque

| Item | Status |
|------|--------|
| ETL `raw.estoque` (view CCSALDO — snapshot tempo real) | ✅ Funcionando |
| ETL `raw.saldo_lote` (snapshot diário por lote via SALDO_LOTE()) | ✅ Funcionando |
| Endpoint `GET /api/v1/estoque` | ✅ Implementado |
| Endpoint `GET /api/v1/lotes` | ✅ Implementado |
| Endpoint `GET /api/v1/lotes/vencendo` | ✅ Implementado |
| Endpoint `GET /api/v1/lotes/resumo` | ✅ Implementado |
| Validação contra relatório ERP | ⏳ Pendente |

---

### ⏳ Financeiro (CP/CR)

| Item | Status |
|------|--------|
| ETL incremental `raw.financeiro_cp` (CABPAGAR + PAGAR) | ✅ Funcionando |
| ETL incremental `raw.financeiro_cr` (CABREC + RECEBER) | ✅ Funcionando |
| ETL `raw.recebimentos` (CRCBAIXA — baixas de CR) | ✅ Funcionando |
| ETL `raw.pagamentos` (CPGBAIXA — baixas de CP) | ✅ Funcionando |
| ETL `raw.contratofin` (contratos de empréstimos) | ✅ Funcionando |
| Endpoint `GET /api/v1/financeiro` | ✅ Implementado |
| Endpoint `GET /api/v1/financeiro/fluxo-caixa` | ✅ Implementado |
| Validação contra relatório ERP | ⏳ Pendente |
| Reconciliação automática de exclusões | ⏳ Pendente |

---

### ⏳ Clientes / Parceiros

| Item | Status |
|------|--------|
| ETL incremental `raw.clientes` (TRANSAC + CLIENTE) | ✅ Funcionando |
| Endpoint `GET /api/v1/clientes` | ✅ Implementado |
| Validação contra relatório ERP | ⏳ Pendente |

---

### ✅ Dimensões (tabelas de referência)

| Tabela | Descrição | Status |
|--------|-----------|--------|
| `raw.filiais` | CADEMP — filiais ativas | ✅ ETL diário |
| `raw.produtos` | PRODSERV — catálogo de produtos | ✅ ETL diário |
| `raw.grupos` | GRUPO — grupos de produto | ✅ ETL diário |
| `raw.vendedores` | PESSOAL — equipe de vendas | ✅ ETL diário |
| `raw.clientes` | TRANSAC — parceiros/clientes | ✅ ETL diário |
| `raw.operacoes` | TIPOOPER — operações fiscais | ✅ ETL diário |
| `raw.partoper` | PARTOPER — parametrização Tran121 | ✅ ETL diário |
| `raw.funcaotoper` | FUNCAOTOPER — funções de operação | ✅ ETL diário |
| `raw.dadospro` | DADOSPRO — produto por filial | ✅ ETL diário |
| `raw.lotes` | LOTE + ILOTE — lotes de produto | ✅ ETL diário |
| `raw.plcontas` | PLCONTAS — plano de contas | ✅ ETL diário |
| `raw.contaspl` | CONTASPL — contas do plano | ✅ ETL diário |
| `raw.historico` | HISTORICO — históricos contábeis | ✅ ETL diário |
| `raw.ccusto` | CCUSTO — centros de custo | ✅ ETL diário |
| `raw.idre` | IDRE — estrutura da DRE | ✅ ETL diário |
| `raw.contasdre` | CONTASDRE — mapeamento conta → DRE | ✅ ETL diário |
| `raw.prinativos` | PRINATIVOS — princípios ativos | ✅ ETL diário |
| `raw.propriedades` | PROPRIED — propriedades rurais | ✅ ETL diário |
| `raw.propriedades_vendedor` | VENDEDORPROPRIED — vendedor por propriedade | ✅ ETL diário |

---

## Arquitetura do ETL

### Fluxo geral

```
Oracle ERP (SULGOIANO)
    │  SELECT ... WHERE DUMANUT > :ultimoSync
    ▼
Node.js ETL (packages/etl)
    │  upsertRaw() — INSERT ... ON CONFLICT DO UPDATE
    ▼
PostgreSQL raw.*
    │  reconciliar() — deleta IDs que sumiram do Oracle
    │  analytics.atualizar() — materializa camada analytics
    ▼
ActionAPI (packages/api)
    │  GET /api/v1/<dominio>
    ▼
SaaS / Integrações
```

### Schedules dos jobs ETL (configuráveis via .env)

| Job | Padrão | Descrição |
|-----|--------|-----------|
| estoque | `*/10 * * * *` | Posição de estoque (CCSALDO) |
| pedidos | `*/30 * * * *` | Pedidos de venda |
| faturamento | `0 * * * *` | NFs emitidas |
| duplicatas | `0 * * * *` | Títulos a receber |
| financeiro | `0 * * * *` | CP + CR + contratos |
| recebimentos | `0 * * * *` | Baixas de CR (CRCBAIXA) |
| pagamentos | `0 * * * *` | Baixas de CP (CPGBAIXA) |
| lotes | `0 6 * * *` | Dimensão de lotes |
| saldo_lote | `30 6 * * *` | Saldo por lote (SALDO_LOTE()) |
| contabil | `0 1 * * *` | Lançamentos + CC + pessoa + **reconciliação** |
| dimensoes | `0 6 * * *` | Todas as tabelas de referência |

### Reconciliação automática (módulo contábil)

Executada após o sync incremental de `contabil` (01:00 diário). Janela:
**1/Jan do ano anterior até hoje** (cobre ajustes e encerramentos tardios).

Para forçar manualmente:
```bash
node -e "require('./packages/etl/src/jobs/contabil').reconciliar().then(console.log)"
```

---

## Endpoints da API

Base URL: `http://<host>:<PORT>/api/v1`  
Autenticação: header `X-API-Key: <chave>`  
Health: `GET /health` (sem autenticação)

### Contábil ✅ Validado
```
GET /api/v1/contabil                              Partidas contábeis com filtros
GET /api/v1/contabil/saldo-contas                 Saldo D/C por conta e competência
GET /api/v1/contabil/resumo                       Totais mensais por competência
GET /api/v1/contabil/balancete?dataInicio=&dataFim= Balancete por grupo (Ativo, Passivo…)
```

### Faturamento
```
GET /api/v1/faturamento                           NFs com filtros
GET /api/v1/faturamento/resumo                    Totais por competência
```

### Duplicatas
```
GET /api/v1/duplicatas                            Títulos a receber
```

### Pedidos
```
GET /api/v1/pedidos                               Pedidos de venda
```

### Estoque
```
GET /api/v1/estoque                               Posição atual por produto/filial
GET /api/v1/lotes                                 Saldo por lote (com validade)
GET /api/v1/lotes/vencendo?dias=30                Lotes vencendo em N dias
GET /api/v1/lotes/resumo                          Totais por grupo e filial
```

### Financeiro
```
GET /api/v1/financeiro?tipo=CP                    Contas a pagar
GET /api/v1/financeiro?tipo=CR                    Contas a receber
GET /api/v1/financeiro/fluxo-caixa?dataInicio=&dataFim= Saldo diário receber−pagar
```

### Clientes
```
GET /api/v1/clientes                              Parceiros/clientes
```

---

## Notas Importantes

### Oracle — Somente Leitura
O banco Oracle (SULGOIANO, 10.62.27.5:1521/ORCL) é **estritamente somente leitura**.
Nenhum DML/DDL é executado no Oracle. Toda escrita ocorre apenas no PostgreSQL.

### Grouping do Balancete SiAGRI
O SiAGRI agrupa o balancete pelo **primeiro dígito do CODI_CPC** (não por GRUP_CPC):
- `1xxx` = Ativo
- `2xxx` = Passivo
- `3xxx` = Receitas
- `4xxx` = Custo/Despesas
- `6xxx` = Compensações
- `9xxx` = Movimentos Transitórios

### Lançamentos de Encerramento de Exercício
O SiAGRI cria lançamentos de encerramento ao final do exercício. Eles:
- Têm DATA_CLC = 31/12/AAAA
- Têm TLAN_LCT = 'S' (encerramento) nas partidas de grupos 3 e 4
- Somam no total do balancete quando o checkbox "Considera encerramentos" está ativo
- A API expõe o total **incluindo** encerramentos (comportamento padrão do SiAGRI)

### CODI_EMP em CABLANCTB
Em ~98% dos lançamentos, CABLANCTB.CODI_EMP está vazio. A filial real está em
LANCONTAB.CODI_EMP. O campo `filial_id` em `raw.contabil` usa CABLANCTB.CODI_EMP
por ora — filtros por filial no balancete não funcionam corretamente ainda.
**Pendente:** corrigir o ETL para usar LANCONTAB.CODI_EMP como `filial_id`.
