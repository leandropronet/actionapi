# Relatório de Contas a Receber

Este documento resume as regras atuais do relatório gerado por
`scripts/gerar_relatorio_contas_receber.py`.

## Como gerar

Relatório da posição atual:

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_receber.py `
  --data-base 2026-06-23 `
  --arquivo "relatorios\contas-a-receber-python-2026-06-23.xlsx"
```

Relatório de uma data-base histórica:

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_receber.py `
  --data-base 2026-06-21 `
  --arquivo "relatorios\contas-a-receber-python-base-2026-06-21.xlsx"
```

Por padrão, a aba `Recebimentos` usa o período do primeiro dia do mês da
data-base até a própria data-base. Para informar outro período:

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_receber.py `
  --data-base 2026-06-23 `
  --recebimento-de 2026-06-01 `
  --recebimento-ate 2026-06-23
```

## Fontes de dados

- Saldo em aberto atual: ActionAPI, a partir de `raw.duplicatas_saldo`.
- Saldo histórico: reprodução local em PostgreSQL via
  `packages/etl/src/scripts/saldo-aberto-historico.js`.
- Recebimentos do período: `raw.recebimentos`, consultado diretamente no
  PostgreSQL local via `psql`.
- Enriquecimentos de documento/vendedor: `raw.duplicatas`,
  `raw.faturamento`, `raw.financeiro_titulos`, `raw.vendedores`,
  `raw.tipos_documento` e cadastros de clientes/filiais.

## Principais abas

### Em Aberto

Uma linha por parcela em aberto na data-base.

A coluna `Valor em aberto` é o valor monetário usado para comparação do relatório:

- títulos em `R$`: usa o saldo da parcela em reais;
- títulos indexados, como `SJ$`: converte pela cotação de origem do título e
  arredonda por parcela.

A coluna `Saldo convertido atual` é outra métrica: converte o saldo pela cotação
mais recente replicada. Ela serve para visão econômica atual, mas não substitui
`Valor em aberto`.

### Faixas Vencimento

Agrupa as parcelas em aberto por faixa e unidade de saldo.

A coluna `Valor em aberto` nesta aba soma a mesma regra da aba `Em Aberto`.
Portanto, o total de `Faixas Vencimento` deve bater com o total de
`Valor em aberto` da aba `Em Aberto`.

Faixas usadas:

- vencido: `1-30`, `31-60`, `61-90`, `91-120`, `121-180`, `181-360`,
  `acima de 360`;
- a vencer: `1-30`, `31-60`, `61-90`, `91-120`, `121-180`, `181-360`,
  `acima de 360`;
- `VENCE_HOJE`;
- `CREDITO_EM_ABERTO`.

### Recebidas Títulos Abertos

Mostra parcelas já quitadas que pertencem a títulos que ainda possuem alguma
parcela em aberto.

Esta aba não representa todos os recebimentos do período. Ela existe para apoiar
a aba `Conciliação`.

### Recebimentos

Mostra todos os recebimentos normais (`status = 'N'`) no período informado,
independentemente de o título ainda estar em aberto.

É a aba correta para análise de movimento de baixas por período.

### Conciliação

Agrupa por título:

- valor das parcelas;
- recebido acumulado;
- em aberto;
- diferença.

Em títulos indexados, a diferença pode ser esperada porque valores recebidos e
saldos em unidade indexada não usam a mesma base de comparação.

### Divergencias Saldo

Lista parcelas em que o valor da planilha diverge do valor recalculado localmente.

As primeiras colunas são as relevantes para análise:

- `Motivo provável da divergência`;
- `Diferença valor em aberto`;
- `Valor em aberto na planilha`;
- `Valor correto recalculado`.

As colunas de saldo técnico aparecem depois apenas para rastreabilidade:

- `Saldo do snapshot`;
- `Saldo local recalculado`;
- `Diferença saldo local`.

Quando o relatório é gerado para a própria data do dia, divergências podem ocorrer
porque novas baixas, estornos, agrupamentos ou alterações de título continuam
entrando após a geração do snapshot diário. Para fechamento oficial, prefira uma
data-base já encerrada ou gere após a conclusão dos jobs financeiros do dia.

## Cuidados operacionais

- A carga incremental usa janela de sobreposição para capturar alterações
  retroativas, mas relatórios tirados durante o dia podem mudar conforme novas
  baixas chegam.
- Para validar freshness da carga, consulte `etl_job_status`, `etl_sync` e os logs
  em `logs/etl-service.log`.
- A documentação dos horários e alertas do ETL fica em
  `docs/HORARIOS_SINCRONISMO.md` e `docs/OPERACAO_ETL.md`.
