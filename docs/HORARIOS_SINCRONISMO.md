# Horários de sincronismo do ETL

Este documento lista a frequência de cada job de sincronização Oracle → PostgreSQL,
onde ela é configurada e como ela é monitorada.

Fuso horário de referência: `America/Sao_Paulo` (`TZ` no `.env`).

## Onde isso é configurado

Os agendamentos vivem em `packages/etl/src/index.js` (objeto `crons`), cada um lido de
uma variável `CRON_<JOB>` no `.env` (sintaxe cron Unix: `min hora dia mês dia-semana`).
Se a variável não existir, vale o padrão hardcoded no próprio `index.js`. Hoje o `.env`
já define explicitamente todas elas com o mesmo valor do padrão.

Para mudar um horário: editar a linha `CRON_<JOB>=...` no `.env` e reiniciar o processo
do ETL (tarefa do Windows ou container, conforme `docs/OPERACAO_ETL.md`). Não há, ainda,
um painel para isso (ver pendência ao final).

## Jobs horários (rodam todo dia, hora em hora)

Os jobs incrementais "quentes" estão deliberadamente espalhados em minutos diferentes
dentro de cada hora, para não competir por conexão com o Oracle ao mesmo tempo.

| Minuto | Job | Variável | O que sincroniza |
|---|---|---|---|
| :03 | `faturamento` | `CRON_FATURAMENTO` | Notas fiscais (NOTA + INOTA + TIPOOPER) |
| :07 | `duplicatas` | `CRON_DUPLICATAS` | Títulos/parcelas de Contas a Receber (RECEBER/CABREC) |
| :11 | `financeiro` | `CRON_FINANCEIRO` | Títulos/parcelas de Contas a Pagar e contratos financeiros |
| :17 | `recebimentos` | `CRON_RECEBIMENTOS` | Baixas de Contas a Receber (CRCBAIXA) |
| :23 | `pagamentos` | `CRON_PAGAMENTOS` | Baixas de Contas a Pagar (CPGBAIXA) |
| :29 | `nfe_entrada` | `CRON_NFE_ENTRADA` | NF-e de entrada (NFENTRA + INFENTRA) |
| :37 | `pedidos_compra` | `CRON_PEDIDOS_COMPRA` | Pedidos de compra (PEDCOM + IPEDCOM + PARCPEDCOM) |
| :43 | `conciliacao` | `CRON_CONCILIACAO` | Cabeçalhos para conciliação CP/CR × contabilidade |
| :47 | `financeiro_indexadores` | `CRON_FINANCEIRO_INDEXADORES` | Tabelas auxiliares de indexador/cotação (snapshot completo, volume pequeno) |
| :52 | `financeiro_saldos_local` | `CRON_FINANCEIRO_SALDOS_LOCAL` | Recalcula o saldo em aberto local de CP/CR (reproduz `VALOR_ABERTO_*_DATA`) — depende de `recebimentos`/`pagamentos` já terem rodado na hora |
| :55 | `analytics` | `CRON_ANALYTICS` | Atualiza a camada `analytics` materializada a partir do raw já sincronizado (não acessa o Oracle) |

| A cada | Job | Variável | O que sincroniza |
|---|---|---|---|
| 10 min | `estoque` | `CRON_ESTOQUE` | Saldo de estoque (CCSALDO) |
| 30 min | `pedidos` | `CRON_PEDIDOS` | Pedidos de venda (PEDIDO + IPEDIDO) |
| 10 min | monitor de atraso | `CRON_MONITOR_ETL` | Não sincroniza dado — verifica se algum job monitorado está atrasado (ver seção de alertas) |

## Jobs diários

| Horário | Job | Variável | O que sincroniza |
|---|---|---|---|
| 01:00 | `contabil` | `CRON_CONTABIL` | Lançamentos contábeis (CABLANCTB + LANCONTAB + desdobramentos por centro de custo/pessoa) |
| 02:20 | `reconciliacao_financeira_recente` | `CRON_RECONCILIACAO_FINANCEIRA_RECENTE` | Reexecuta `recebimentos` + `pagamentos` + `financeiro_saldos_local` para os últimos `ETL_RECONCILIATION_DAYS` dias (padrão 30) — corrige baixas retroativas que o incremental por `DUMANUT` pode ter perdido (ver causa-raiz documentada em `docs/auditoria-crc-controller-2026-06-21.md`) |
| 06:05 | `lotes` | `CRON_LOTES` | Lotes/safras |
| 06:15 | `dimensoes` | `CRON_DIMENSOES` | Tabelas de dimensão (plano de contas, fornecedores, clientes, etc.) |
| 06:30 | `duplicatas_saldo` | `CRON_DUPLICATAS_SALDO` | Snapshot oficial do saldo em aberto de CR via função Oracle `VALOR_ABERTO_RECEBER_DATA` — referência para validar `financeiro_saldos_local` |
| 06:30 | `saldo_lote` | `CRON_SALDO_LOTE` | Snapshot diário de saldo por lote via função Oracle `SALDO_LOTE()` |

## Ao iniciar o serviço (`ETL_RUN_ON_START=true`)

Antes de aguardar o primeiro disparo dos crons acima, o serviço já roda uma vez, em
sequência: `duplicatas` → `recebimentos` → `pagamentos` → `financeiro_saldos_local`.
Garante que o saldo em aberto esteja correto mesmo se o processo ficar muito tempo
parado e for religado fora de hora.

## Por que os horários são espalhados (não todos no minuto 0)

- Evita que vários jobs abram conexão com o Oracle de produção no mesmo instante.
- Garante uma ordem lógica dentro da hora: primeiro os fatos (`recebimentos`,
  `pagamentos`), só depois o recálculo de saldo (`financeiro_saldos_local`) e por
  último a camada agregada (`analytics`).
- Todos os incrementais usam o campo `DUMANUT` (data de alteração) com uma janela de
  sobreposição de `ETL_INCREMENTAL_OVERLAP_MINUTES` (padrão **2880 min = 48 h**) para
  tolerar pequenas diferenças de relógio/replicação entre o ETL e o Oracle.

## Alertas de atraso (Telegram)

Um monitor à parte (`CRON_MONITOR_ETL`, padrão a cada 10 min) verifica se os jobs
abaixo tiveram um sucesso registrado dentro do limite — se não, dispara alerta no
Telegram (ver `docs/OPERACAO_ETL.md`) e avisa também quando o job se recupera.
Configurado em `ETL_MONITOR_JOBS` no `.env`:

| Job monitorado | Limite de atraso |
|---|---|
| `duplicatas` | 120 min |
| `recebimentos` | 120 min |
| `pagamentos` | 120 min |
| `financeiro_saldos_local` | 120 min |
| `analytics` | 120 min |
| `reconciliacao_financeira_recente` | 1.560 min (26 h — roda 1x/dia) |

O monitor só começa a checar `ETL_MONITOR_STARTUP_GRACE_MINUTES` (padrão 20 min) depois
do processo subir, para não disparar falso alarme no boot. Um alerta já ativo só é
reenviado após `TELEGRAM_ALERT_REPEAT_MINUTES` (padrão 360 min = 6 h).

## Limitação conhecida (defasagem em baixas retroativas)

As funções oficiais do SiAGRI (`VALOR_ABERTO_RECEBER_DATA`/`VALOR_ABERTO_PAGAR_DATA`)
não são bitemporais: uma baixa com data de pagamento retroativa, mas **gravada** no
Oracle depois do nosso sync, só aparece na próxima execução do job correspondente (ou
na reconciliação diária das 02:20). Caso real documentado em
`docs/auditoria-crc-controller-2026-06-21.md`: 6 baixas pagas em 17–19/06 mas gravadas
em 22/06 ficaram fora do snapshot até o próximo sync de `recebimentos`.

## Pendência: painel para configurar isso pela UI

Hoje qualquer mudança de horário exige editar `.env` e reiniciar o processo. Existe um
pedido registrado (ver memória do projeto) para um painel que permita ajustar os
intervalos (em especial reduzir o dos jobs "quentes" — `recebimentos`/`pagamentos`),
ligar/desligar e disparar um job manualmente, sem precisar editar arquivo.
