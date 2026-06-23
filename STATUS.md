# ActionAPI — Status de Desenvolvimento e Validação

> Última atualização: 2026-06-18
> Branch: main

Metodologia das rotas e cálculos:
[`docs/METODOLOGIA_APIS.md`](docs/METODOLOGIA_APIS.md).

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

### ✅ Faturamento — VALIDADO com relatório ERP

| Item | Status |
|------|--------|
| ETL incremental `raw.faturamento` + `raw.faturamento_itens` | ✅ Funcionando |
| Endpoint `GET /api/v1/faturamento` | ✅ Implementado |
| Endpoint `GET /api/v1/faturamento/resumo` | ✅ Implementado |
| Filtro por data de saída (`dataSaidaDe`/`dataSaidaAte`) | ✅ Implementado |
| **Validação contra relatório SiAGRI (Saídas Faturadas Analítico 2025)** | ✅ Validado |
| Reconciliação automática | N/A — NF nunca é excluída no SiAGRI (só cancelada) |

#### Validação 2025 — param 102 (VENDAS-DEVOLUCAO), período 01/01 a 31/12/2025

Relatório SiAGRI: Saídas Faturadas - Analítico, função 102, Indexador R$

| Métrica | API (PG) | SiAGRI (PDF p.991) | Diferença |
|---------|----------|-------------------|-----------|
| Total líquido (A−S) | R$ 197.643.773,21 | R$ 197.643.773,21 | R$ 0,00 ✅ |
| Quantidade itens (A−S) | 3.098.335,750 | 3.098.335,750 | 0,000 ✅ |

**Regra reproduzida:** o relatório usa o período de **emissão** e combina duas origens:

1. `NOTA`: soma/subtrai `TOTA_NOT` conforme `FUNCAOTOPER.FUNC_TOP` (A/S)
2. `NFENTRA`: soma/subtrai `QUAN_INF × VLIQ_INF` conforme a operação do item

Para o parâmetro 102 em 2025:

`R$ 199.262.171,46 (NOTA A−S) − R$ 1.618.398,25 (NFENTRA S) = R$ 197.643.773,21`

Reprodução pela API:

`GET /api/v1/faturamento/resumo?paramId=102&dataInicio=2025-01-01&dataFim=2025-12-31`

### ✅ Portal, documentação e segurança

| Item | Status |
|---|---|
| Swagger/OpenAPI protegido em `/docs` | ✅ Implementado |
| Painel administrativo somente leitura em `/painel` | ✅ Implementado |
| Login com senha `scrypt` e sessão em cookie HttpOnly | ✅ Implementado |
| API key com comparação em tempo constante | ✅ Implementado |
| Rate limit, Helmet, CSP e auditoria | ✅ Implementado |
| Docker sem root, filesystem read-only e bind local padrão | ✅ Implementado |
| Guia de API e segurança em `docs/` | ✅ Implementado |
| Datasets planos para Power BI/Excel | ✅ Implementado |
| Conciliação financeiro × contábil | ✅ Implementado |

---

### ✅ Duplicatas (Contas a Receber) — VALIDADO com relatório ERP

| Item | Status |
|------|--------|
| ETL incremental `raw.duplicatas` (CABREC + RECEBER) | ✅ Corrigido em 2026-06-20 — 161.989 parcelas (100% do Oracle) |
| ETL `raw.recebimentos` (CRCBAIXA — baixas de CR) | ✅ Corrigido em 2026-06-20 — 181.090 baixas (100% do Oracle) |
| ETL `raw.duplicatas_saldo` (saldo em aberto, snapshot diário) | ✅ Implementado e validado — ver abaixo |
| `raw.financeiro_titulos` tipo CR | ✅ 161.711/161.723 (99,99%, já corrigido antes) |
| Endpoint `GET /api/v1/duplicatas` | ✅ Implementado e testado |
| Endpoint `GET /api/v1/duplicatas/saldo` | ✅ Implementado e testado |
| Endpoint `GET /api/v1/duplicatas/saldo/resumo` | ✅ Implementado e testado |
| Validação contra relatório ERP | ✅ Validado em 2026-06-20 — ver tabela abaixo |
| Reconciliação automática de exclusões | ⏳ Pendente |

#### Carga incompleta — RESOLVIDO em 2026-06-20
Mesmo padrão dos demais módulos: sincronização puramente incremental
(`WHERE DUMANUT > :ultimoSync`), sem carga inicial. `raw.duplicatas` tinha
só 68.224 de 161.989 parcelas (42%) e `raw.recebimentos` só 70.554 de
181.090 baixas (39%) — apesar do intervalo de datas aparentar completo
(2007–2026). Adicionado suporte a `{ dataInicio, dataFim }` em
`jobs/duplicatas.js` e `jobs/recebimentos.js`, backfill ano a ano
(`scripts/backfill-duplicatas.js`, `scripts/backfill-recebimentos.js`).
`RECEBER.CTRL_REC` e `CRCBAIXA.SEQU_BAI` são PK simples (sem colisão,
diferente dos bugs de pedidos/lotes).

#### Validação 2026-06-20 — "Contas a Receber por Cliente - Data", calculado p/ 20/06/2026

| Métrica | Relatório SiAGRI | API (PostgreSQL) | Diferença |
|---|---|---|---|
| Saldo aberto (Inicial, R$ + SJ$ valor de face) | 157.052.025,10 + 40.733,86 = 157.092.758,96 | 157.092.758,96 | R$ 0,00 ✅ |

**Achado importante:** o saldo em aberto **não pode** ser reconstruído como
`VLOR_REC - SUM(baixas normais)` em Postgres — testado e errou por ~2,3%
(R$ 160.645.582,37 vs R$ 157.092.758,96 real). A função oficial do Oracle
`VALOR_ABERTO_RECEBER_DATA` aplica regras adicionais (descontos de
pontualidade/antecipação, juros já incorridos, etc.) que não são só
"valor menos baixas". Por isso `raw.duplicatas_saldo` é um snapshot diário
que chama essa função diretamente (em lote, ~156k parcelas — funciona sem
erro), em vez de tentar replicar a lógica em SQL puro.

**Sinal por natureza do documento:** duplicata normal (`TIPO_TDO='D'`)
mantém o sinal; adiantamento/devolução (`TIPO_TDO='C'`, ex.: códigos 103 e
106) tem o sinal **invertido e somado** ao total — testado **excluir**
esses tipos inteiramente em vez de somar com sinal invertido, e o total
errou por R$ 835.622,18. A regra correta é a do SELECT original do
usuário: somar com sinal trocado, nunca excluir.

**Não implementado:** a projeção de juros composto ("Futuro"/"Acr-Desconto"
no relatório, via função `CALCVALORES_CR1`) — função do fornecedor tem bug
de cursor (`ORA-01001`) quando chamada em lote para muitas linhas. Como o
objetivo é saber o saldo em aberto (não a simulação de juros futuro), isso
não bloqueia o uso da API.

---

### ✅ Pedidos — VALIDADO com relatório ERP

| Item | Status |
|------|--------|
| ETL incremental `raw.pedidos` + `raw.pedidos_itens` | ✅ Funcionando — 114.234 pedidos / 259.568 itens (100% do Oracle) |
| Endpoint `GET /api/v1/pedidos` | ✅ Implementado |
| Validação contra relatório ERP | ✅ Validado em 2026-06-19 — ver tabela abaixo |
| Reconciliação automática de exclusões | ⏳ Pendente |

#### Validação 2025 — "Carteira Pedidos de Venda - Analítico" (sem VEF), período 01/01/2025 a 31/12/2025

| Métrica | Relatório SiAGRI | API (PostgreSQL) | Diferença |
|---|---|---|---|
| Pedida | 4.314.796,89 | 4.314.796,89 | 0,00 ✅ |
| Entregue | 3.200.816,02 | 3.200.816,02 | 0,00 ✅ |
| Perd./Anul. (`QPER_IPE`) | 1.108.442,87 | 1.108.442,87 | 0,00 ✅ |
| Saldo | 5.538,00 | 5.537,99 | R$ 0,01 (arredondamento) ✅ |

A versão **com VEF** (venda para entrega futura) do relatório mostra Entregue
menor (3.163.291,02) porque desconta notas de "SIMPLES FAT. DE VENDA
P/ENTREGA FUTURA" (`CODI_TOP=81`) ainda não confirmadas fisicamente. Essa
distinção não é reconstruível a partir do schema disponível — ver
investigação completa abaixo. Validação adotada: relatório sem VEF (bateu
exato).

#### Bug de colisão de `id` — RESOLVIDO em 2026-06-18
`PEDI_PED+SERI_PED` **não é único** — o mesmo par se repete em filiais
diferentes (casos reais com até 4 filiais compartilhando o mesmo número).
`raw.pedidos.id` era só `{PEDI_PED}_{SERI_PED}` (sem filial), causando
colisão no upsert: **28% dos pedidos** (31.949 de 114.234) eram sobrescritos
e perdidos silenciosamente. Mesmo problema em `raw.pedidos_itens`, agravado
por outro bug: `ITEM_IPE` (usado como sequencial do item) está **0%
preenchido** no Oracle — a PK real de `IPEDIDO` é
`CODI_EMP+PEDI_PED+SERI_PED+CODI_PSV`, sem campo de sequência próprio.

Corrigido: `id` agora inclui filial (`{CODI_EMP}_{PEDI_PED}_{SERI_PED}`),
item usa `CODI_PSV` no lugar de `ITEM_IPE`. Propagado para
`raw.faturamento_itens.pedido_id` (link NF→Pedido), que usava o mesmo
formato sem filial — 100.680 registros corrigidos, 100% batendo com
`raw.pedidos` após o fix. `raw.faturamento.pedido_id` (nível cabeçalho)
nunca é populado pelo Oracle (0 registros) — não é regressão, é assim desde
sempre. Script de backfill: `scripts/backfill-pedidos.js [anoInicio]`
(processa ano a ano para não esgotar memória — uma carga única de 2001-hoje
causou `OutOfMemory`).

Esse mesmo padrão (`ITEM_INO` em `INOTA`, `ITEM_INF` em `INFENTRA`) foi
checado e **não** tem o problema — ambos 100% preenchidos no Oracle.

#### Venda para Entrega Futura (VEF) — investigado, sem solução estrutural (2026-06-19)
"SIMPLES FAT. DE VENDA P/ENTREGA FUTURA" (`CODI_TOP=81`) fatura sem mover
estoque; a entrega física real não gera nova NF nem marca nenhum campo na
NF original (`SITU_NOT`, `SITU_NFE`, `XCAN_NOT`, `XREC_NOT` idênticos entre
pendente e entregue). A confirmação fica só em `CCSALDO` (tipo 16
"Comprovante Entrega"), que é **agregado por produto+filial**, sem
referência a NF/pedido — não é possível reconstruir por pedido com o schema
disponível. Hipóteses descartadas: devolução formal (`CODI_TOP=98`, 0
registros) e tabela de movimento por NF (`MOVLOTNT`, exclusiva de entrada).
Conclusão: usar o relatório sem VEF como referência de validação.

---

### 🆕 Pedidos de Compra (PEDCOM/IPEDCOM/PARCPEDCOM) — implementado em 2026-06-18

| Item | Status |
|------|--------|
| ETL incremental `raw.pedidos_compra` (PEDCOM) | ✅ Funcionando — 6.507 pedidos desde 2007 |
| ETL `raw.pedidos_compra_itens` (IPEDCOM) | ✅ Funcionando — 13.518 itens |
| ETL `raw.pedidos_compra_parcelas` (PARCPEDCOM) | ✅ Funcionando — 6.788 parcelas |
| Endpoint `GET /api/v1/pedidos-compra` | ✅ Implementado |
| Endpoint `GET /api/v1/pedidos-compra/itens-abertos` | ✅ Implementado |
| Endpoint `GET /api/v1/pedidos-compra/resumo` | ✅ Implementado |
| Endpoint `GET /api/v1/pedidos-compra/:id` | ✅ Implementado |
| Significado de `STAT_PEC` (P/A/C) | ⏳ Inferido, não confirmado — comparar com relatório ERP |
| ETL `raw.fornecedores` (TRANSAC + FORN_TRA='S') | ✅ Funcionando — 12.771 fornecedores |
| Nomes de fornecedor em `/pedidos-compra*` | ✅ Resolvidos via `raw.fornecedores` (fallback `raw.clientes`) |
| `raw.financeiro_titulos.nf_entrada_id` (NOTACPG → NFENTRA) | ✅ Implementado e validado — 98,4% de integridade FK |
| Vínculo com Contas a Pagar (`GET /pedidos-compra/:id` → `notas_entrada`) | ✅ Implementado — `PEDCOM → INFENTRA → NFENTRA → CABPAGAR` via FK real `NOTACPG` |
| Vínculo de Adiantamento a Fornecedor com pedido | ⏳ Não resolvido — número citado no histórico não bate com `PEDCOM`/`SOLICOMPRA` reais; sem tabela de apoio encontrada nesta base |
| Cobertura de `raw.nfe_entrada_itens` vs Oracle (afeta `notas_entrada`) | ⏳ Parcial — 30.479 de 81.249 itens carregados |
| Validação contra relatório ERP | ⏳ Pendente |

Saldo em aberto = `qtd_pedida (QTDP_IPC) - qtd_recebida (QTDR_IPC)` por item.
**Achado importante:** pedidos com `status=C` (cancelado) ficam com
`qtd_recebida=0` no Oracle mesmo nunca tendo sido recebidos — por isso são
excluídos do saldo em aberto por padrão (parâmetro `incluirCancelados=true`
para incluir). Sem esse filtro, o saldo total ficava inflado em ~R$ 285
milhões por pedidos já cancelados.

**Vínculo CP × NF de entrada — achado em 2026-06-18:** não existe FK direta
em `CABPAGAR`/`PAGAR` para `NFENTRA`. Comparar `DOCU_CPG` (documento digitado)
com `NUME_NFE` é só ~27,5% confiável no geral (a maioria dos títulos de CP
não vem de NF — é imposto, frete, RPA, folha) e tem erros de digitação reais
(número trocado, até uma data digitada no campo). A tabela `NOTACPG`
(93.428 linhas) é o vínculo oficial: `NOTACPG.CTRL_CPG → CABPAGAR.CTRL_CPG`
e `NOTACPG.CTRL_NCP → NFENTRA.CTRL_NFE` diretamente (98,4% de integridade,
relação 1:1, sem ambiguidade). Cobertura: 91,3% dos títulos com tipo de
documento de compra (`CODI_TDO` 10000139/10000140). Já implementado em
`jobs/conciliacao.js` (`sincronizarTitulosCp`) como `nf_entrada_id`.

---

### ✅ Estoque — VALIDADO com relatório ERP

| Item | Status |
|------|--------|
| ETL `raw.estoque` (view CCSALDO) | ✅ Corrigido em 2026-06-19 — 5.720 posições (100% das combinações reais) |
| ETL `raw.lotes` (LOTE) | ✅ Corrigido — 16.509 lotes (100% do Oracle) |
| ETL `raw.lotes_filial` (ILOTE) | ✅ Corrigido — 6.024 posições (100% do Oracle) |
| ETL `raw.saldo_lote` (snapshot diário via SALDO_LOTE()) | ✅ Funcionando — desenho correto, sem o bug abaixo |
| Endpoint `GET /api/v1/estoque` | ✅ Implementado e testado |
| Endpoint `GET /api/v1/lotes` | ✅ Implementado e testado |
| Endpoint `GET /api/v1/lotes/vencendo` | ✅ Implementado e testado |
| Endpoint `GET /api/v1/lotes/resumo` | ✅ Implementado e testado |
| Validação contra relatório ERP | ✅ Validado em 2026-06-20 — ver amostra abaixo |

#### Validação — "Posição do estoque de lotes - Analítico" (Cest4101), controle=1 Estoque Físico, 20/06/2026

Relatório é um livro de movimento por lote (128 páginas, sem totalizador
geral simples) — validação por amostragem de lotes com cálculo manual
(entradas − saídas) reproduzido a partir do relatório:

| Lote | Produto | Cálculo (relatório) | `raw.saldo_lote` | Validade |
|---|---|---|---|---|
| `25RNS2275A` | 01.02.0314 | 300 (entrada única) | 300,0000 ✅ | 29/08/2028 ✅ |
| `0139-24-03150` | 01.03.0020 | 400 − 175 − 50 = 175 | 175,0000 ✅ | 01/12/2026 ✅ |
| `0144-24-03150` | 01.03.0020 | 100 (entrada única) | 100,0000 ✅ | 11/12/2026 ✅ |

3 de 3 lotes amostrados bateram exato, incluindo data de validade.

#### CCSALDO não é um snapshot — é histórico, com saldo desatualizado — RESOLVIDO em 2026-06-19
`CCSALDO` (documentada como "view realtime de saldo") na verdade guarda **uma
linha por data de movimento**, voltando a 2008: 315.648 linhas para só 5.720
combinações reais de filial+produto+tipo de controle (uma média de 55
registros históricos por combinação, um caso chegou a 925). O ETL carregava
tudo sem filtrar pela data mais recente — o `id` (filial+produto+tipo)
colidia no upsert e ficava com uma linha **arbitrária** do histórico, não a
atual. Achado concreto: produto carregado com saldo de 2020-10-08 (120
unidades) quando o saldo real mais recente era de 2021-10-18 (200 unidades)
— ou seja, `/api/v1/estoque` estava reportando posições de estoque erradas,
potencialmente desatualizadas por anos.

Corrigido com `ROW_NUMBER() OVER (PARTITION BY filial,produto,tipo ORDER BY
DATA_CCS DESC)`, pegando só a linha mais recente por combinação — filtro de
saldo zero aplicado **depois** do ranking (nunca antes, senão um produto
zerado recentemente poderia mostrar um saldo antigo não-zero por engano).

#### ILOTE colisão de PK — RESOLVIDO em 2026-06-19
PK real de `ILOTE` é `CODI_PSV+LOTE_LOT+CODI_EMP+DINI_ILO+CODI_DPT` — o
mesmo produto/lote/filial pode ter múltiplas entradas em depósitos ou datas
diferentes. `id` antigo (sem depósito/data) colidia, e a falta de carga
inicial (só incremental por `DUMANUT`) deixava `raw.lotes_filial` com
apenas 33% do Oracle. Corrigido `id` e adicionado backfill por `dataInicio`
— ambos `raw.lotes` e `raw.lotes_filial` agora 100% completos.

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
| Endpoint `GET /api/v1/financeiro/contas-pagar` | ✅ Implementado — fornecedor, vencimento, pedidos e produtos |
| Endpoint `GET /api/v1/financeiro/contas-pagar/resumo` | ✅ Implementado — agrupado por fornecedor/filial |
| Endpoint `GET /api/v1/recebimentos` | ✅ Implementado |
| Endpoint `GET /api/v1/recebimentos/resumo` | ✅ Implementado |
| Endpoint `GET /api/v1/pagamentos` | ✅ Implementado |
| Endpoint `GET /api/v1/pagamentos/resumo` | ✅ Implementado |
| `raw.financeiro_titulos` (CABPAGAR/CABREC, usado por `bi.financeiro()` p/ status ABERTA/PARCIAL/BAIXADA) | ✅ Backfill completo em 2026-06-18 |
| Reprodução local de `VALOR_ABERTO_RECEBER_DATA` | ✅ 156.487 parcelas comparadas, 0 divergências |
| Reprodução local de `VALOR_ABERTO_PAGAR_DATA` | ✅ 183.656 parcelas comparadas, 0 divergências |
| Saldo CP correto em 20/06/2026 | ✅ 542 parcelas / R$ 122.237.778,67 |
| `raw.financeiro_titulo_pedidos` (NOTACPG → INFENTRA → PEDCOM) | ✅ 21.129 itens / 17.354 títulos / 5.761 pedidos |
| Histórico `raw.pagamentos` (CPGBAIXA) | ✅ 211.260 baixas desde 2007 |
| Espelho `raw.financeiro_cp` (PAGAR) | ✅ 183.642 parcelas, com reconciliação de exclusões no backfill |
| Validação de saldo aberto contra Oracle | ✅ Exata em 2026-06-19: 513 parcelas, 491 títulos, R$ 117.237.007,16 |
| Reconciliação automática de exclusões | ✅ Disponível no backfill de parcelas CP; incremental agendado continua sem remoção |
| **Pedido de Compra** (Oracle: `PEDCOM`/`IPEDCOM`/`PARCPEDCOM`) | ✅ Implementado em 2026-06-18 — ver seção própria abaixo |

#### `raw.financeiro_titulos` — RESOLVIDO em 2026-06-18
`sincronizarTitulosCp/Cr()` só sincronizava incrementalmente (`DUMANUT > ultimoSync`)
e nunca recebeu carga inicial — por isso só tinha títulos desde out/2024, fazendo o
INNER JOIN em `bi.financeiro()` descartar ~80% das parcelas de `raw.financeiro_cp` e
`raw.duplicatas` (que têm histórico desde 2007/2008). Adicionado suporte a
`{ dataInicio }` (igual ao já existente em `sincronizarContabilCabecalhos`) e
executado backfill desde 2007-01-01. Resultado: 0 parcelas/duplicatas sem título
correspondente, em todo o histórico. Script: `scripts/backfill-financeiro-titulos.js <data>`.

#### Dashboard de Contas a Pagar — implementado e validado em 2026-06-19

O vínculo de pedido usa exclusivamente chaves do ERP:
`CABPAGAR.CTRL_CPG ← NOTACPG.CTRL_CPG`,
`NOTACPG.CTRL_NCP = INFENTRA.CTRL_NFE` e
`INFENTRA.EMPR_PEC + NUME_PEC = PEDCOM.CODI_EMP + NUME_PEC`.

Foi corrigida também a interpretação de `CPGBAIXA.SITU_CPB`: linhas `E`
são baixas históricas estornadas e devem ser ignoradas no saldo, não
subtraídas. Somam-se somente linhas `N`. A regra anterior podia reabrir
valores artificialmente quando havia mais de uma tentativa estornada.

Scripts de manutenção:

```text
npm run financeiro:backfill-pagamentos -- 2007-01-01
npm run financeiro:backfill-parcelas-cp -- 2007-01-01
```

---

### ⏳ DRE

| Item | Status |
|------|--------|
| ETL `raw.idre` (estrutura hierárquica — IDRE) | ✅ Funcionando |
| ETL `raw.contasdre` (mapeamento conta → linha DRE — CONTASDRE) | ✅ Funcionando |
| Endpoint `GET /api/v1/dre?dataInicio=&dataFim=` | ✅ Implementado |
| Endpoint `GET /api/v1/dre/estrutura` | ✅ Implementado |
| Validação contra relatório ERP | ⏳ Pendente — validar sinal (soma_subtrai A/S) |

---

### Análise contábil gerencial

| Item | Status |
|------|--------|
| Endpoint `GET /api/v1/bi/analise-contabil` | ✅ Implementado |
| Exportação CSV para Excel e Power BI | ✅ Implementado |
| Hierarquia gerencial e classificação EBITDA/RF/DA | ✅ 249 contas mapeadas |
| Centros de custo com chave composta plano + código | ✅ Corrigido |
| Backfill de cabeçalhos contábeis desde 2020 | ✅ Executado localmente |
| Regra de encerramento `ZR` | ✅ Excluída conforme a planilha |
| Período de safra | ✅ 01/07 a 30/06 |
| Código da loja | ✅ Somente o valor original do `CABLANCTB`, sem inferência |
| Conferência loja × centro de custo | ✅ Exposta em `status_loja` |
| Validação amostral | ✅ Conta `4.2.1.1.02.0016`, Goiatuba/Cesar, dez-2024 = -111,44 |

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

### Faturamento ✅ Validado
```
GET /api/v1/faturamento                           NFs com filtros
GET /api/v1/faturamento/resumo                    Totais por período
GET /api/v1/faturamento/itens                     Itens com filtros de produto/grupo/PA
GET /api/v1/faturamento/:id                       NF completa com itens

Filtro por data de emissão: ?dataInicio=AAAA-MM-DD&dataFim=AAAA-MM-DD
Filtro por data de saída:   ?dataSaidaDe=AAAA-MM-DD&dataSaidaAte=AAAA-MM-DD  ← uso no relatório SiAGRI
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

### Baixas (Recebimentos e Pagamentos)
```
GET /api/v1/recebimentos                          Baixas de CR (CRCBAIXA)
GET /api/v1/recebimentos/resumo                   Totais por período (agrupamento=dia|mes|trimestre|ano)
GET /api/v1/pagamentos                            Baixas de CP (CPGBAIXA)
GET /api/v1/pagamentos/resumo                     Totais por período
```

### DRE
```
GET /api/v1/dre?dataInicio=&dataFim=              DRE por período (hierarquia de linhas com valores)
GET /api/v1/dre/estrutura                         Hierarquia das linhas sem valores
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

### CODI_EMP em CABLANCTB — RESOLVIDO em 2026-06-18
Em ~98% dos lançamentos, CABLANCTB.CODI_EMP está vazio. A filial real está em
LANCONTAB.CODI_EMP, preenchida em 100% das partidas desde 2020 e nunca
divergente do cabeçalho quando este também está preenchido (validado contra
o Oracle: 1.921 cabeçalhos órfãos × 0 divergências de filial entre partidas
do mesmo lançamento).

- `jobs/contabil.js`: `filial_id` em `raw.contabil` agora usa
  `LANCONTAB.CODI_EMP`, com fallback para `CABLANCTB.CODI_EMP`.
- `jobs/conciliacao.js`: `sincronizarContabilCabecalhos()` complementa
  cabeçalhos sem filial (origem `FC`) buscando `LANCONTAB.CODI_EMP`.
- Backfill executado: `raw.contabil` (1.225.217 partidas corrigidas) e
  `raw.contabil_cabecalhos` (1.921 cabeçalhos corrigidos) — ambos 100%
  preenchidos. Reconciliação removeu 1.645 partidas órfãs (lançamentos
  renumerados no Oracle desde a carga original).
- `status_loja = 'SEM_CODIGO_LOJA'` no `analise-contabil`: 0 ocorrências
  após a correção (antes: todas as lojas com lançamentos de origem `FC`).
- Scripts de backfill: `scripts/backfill-contabil-filial.js` (raw.contabil) e
  `scripts/backfill-contabil-cabecalhos.js <data>` (raw.contabil_cabecalhos).
## Relatórios executivos CEO/CFO — 20/06/2026

- ✅ Camada `/api/v1/executivo/*` para faturamento, recebimentos, pagamentos,
  contabilidade e visão 360°.
- ✅ Gerador Python `scripts/gerar_relatorios_executivos.py`.
- ✅ Sete planilhas executivas validadas sem erros ou reparos do Excel,
  incluindo saldos em aberto de contas a receber e contas a pagar.
- ✅ DRE corrigida para usar `raw.idre.pai_id` e selecionar `dreId=1` por padrão.
- ✅ Oracle mantido exclusivamente em leitura; nenhum DML/DDL executado.
- ✅ Scripts Python individuais para faturamento, contas recebidas, contas
  pagas, contabilidade e visão 360°.
- ✅ Recebimentos e pagamentos enriquecidos com análise de pontualidade,
  valores em atraso, média de dias e ranking por parceiro.
- ✅ Menu interativo de período em todos os geradores Python quando nenhuma
  data é passada: Safra, Bayer, ano contábil, intervalo livre ou ano atual.
