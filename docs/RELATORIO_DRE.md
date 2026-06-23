# Relatório DRE e Balanço Patrimonial

Script: `scripts/relatorio_dre.py`

Gera uma planilha anual de DRE + Balanço Patrimonial inspirada no modelo
`relatorios/contabilidade/SGA_DRE E BP 2021 a 2025 ANUAL_v2.xlsx`, mas usando
dados atuais da ActionAPI.

## Como executar

```powershell
.\.venv\Scripts\python.exe scripts\relatorio_dre.py
```

Opções úteis:

```powershell
.\.venv\Scripts\python.exe scripts\relatorio_dre.py `
  --anos 2021-2025 `
  --ano-filial 2025 `
  --arquivo relatorios\relatorio-dre-2021-2025.xlsx
```

Se estiver testando uma API local em outra porta:

```powershell
.\.venv\Scripts\python.exe scripts\relatorio_dre.py --api-url http://127.0.0.1:3001
```

## Abas geradas

- `Painel`: principais KPIs do último ano e evolução de receita, lucro, EBITDA e resultado.
- `DRE Exercícios`: DRE anual 2021–2025, com análise horizontal e vertical.
- `DRE por Filial`: abertura por filial para o ano escolhido.
- `Balanço Patrimonial`: contas sintéticas do BP por ano.
- `Indicadores`: liquidez, endividamento, empréstimos/EBITDA, ROA e ROE.
- `Validação`: comparação dos principais números contra a planilha-modelo, quando disponível.
- `Mapeamento`: conta/fórmula usada em cada linha.
- `Auditoria Fórmulas`: pontos em que a fórmula do modelo/controller pode estar
  conceitualmente incorreta ou ambígua.
- `Contas API DRE`: contas 3/4 retornadas pela API para auditoria.

## Regra contábil importante

As contas de resultado são zeradas por lançamento de encerramento anual. Por isso,
o script usa:

```text
/api/v1/executivo/contabilidade/sintetico?excluirEncerramento=true
```

Esse parâmetro remove o histórico `HIST_HIS = 1000191` da consulta de DRE.
O comportamento padrão do endpoint não mudou; sem esse parâmetro ele continua
retornando o saldo contábil normal, incluindo encerramento.

Depois de publicar a alteração em `packages/api/src/services/executivo.js`, reinicie
o serviço/container da API. Se a API em execução ainda estiver com código antigo, o
script para com uma mensagem avisando que `excluirEncerramento=true` ainda não está
ativo.

## Melhorias em relação ao modelo

- ROA e ROE usam o Resultado do Exercício da própria DRE gerada, em vez do saldo de
  lucros/prejuízos acumulados do BP, que pode ficar zerado por fechamento/distribuição.
- A aba `Validação` deixa explícitas diferenças entre a planilha-modelo e a base atual
  da API, facilitando separar mudança de dados de erro de fórmula.
- Liquidez Geral e Endividamento mostram o critério técnico como principal e mantêm
  o critério observado no modelo em linha separada na aba `Indicadores`.
- A aba `Auditoria Fórmulas` documenta os pontos suspeitos, incluindo ROA, ROE,
  Liquidez Geral, Endividamento e a decomposição de impostos/devoluções em vendas.
