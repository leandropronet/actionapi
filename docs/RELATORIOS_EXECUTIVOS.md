# Relatórios executivos CEO/CFO

O gerador `scripts/gerar_relatorios_executivos.py` produz sete planilhas
usando exclusivamente a ActionAPI:

1. faturamento executivo;
2. contas a receber em aberto;
3. contas a pagar em aberto;
4. contas recebidas;
5. contas pagas;
6. contabilidade executiva;
7. visão consolidada 360°.

Também existe um script independente para cada arquivo:

| Relatório | Script |
|---|---|
| Faturamento | `scripts/gerar_relatorio_faturamento.py` |
| Contas a receber em aberto | `scripts/gerar_relatorio_contas_receber.py` |
| Contas a pagar em aberto | `scripts/gerar_relatorio_contas_pagar.py` |
| Contas recebidas | `scripts/gerar_relatorio_contas_recebidas.py` |
| Contas pagas | `scripts/gerar_relatorio_contas_pagas.py` |
| Contabilidade | `scripts/gerar_relatorio_contabilidade.py` |
| Visão 360° | `scripts/gerar_relatorio_visao_360.py` |

## Execução

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorios_executivos.py `
  --data-inicio 2026-01-01 `
  --data-fim 2026-06-20
```

Para gerar somente alguns arquivos:

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorios_executivos.py `
  --data-inicio 2026-01-01 `
  --data-fim 2026-06-20 `
  --relatorios faturamento,a-receber,a-pagar,360
```

Para executar um relatório individual:

```powershell
.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_recebidas.py `
  --data-inicio 2026-01-01 `
  --data-fim 2026-06-20

.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_pagas.py `
  --data-inicio 2026-01-01 `
  --data-fim 2026-06-20
```

Filtros disponíveis:

- `--safra 2025/2026`: 01/07/2025 até 30/06/2026;
- `--bayer 2025/2026`: 01/04/2025 até 30/03/2026;
- `--ano-contabil 2025`: 01/01/2025 até 31/12/2025;
- `--data-inicio` e `--data-fim`: intervalo personalizado, aceitando
  `DDMMAAAA`, `DD/MM/AAAA` ou `AAAA-MM-DD`;
- `--filial-id`;
- `--saida-dir`;
- `--relatorios`.

Os tipos de intervalo são mutuamente exclusivos. Para um período
personalizado, as duas datas são obrigatórias.

```powershell
# Safra agrícola
.\.venv\Scripts\python.exe scripts\gerar_relatorio_faturamento.py `
  --safra 2025/2026

# Período Bayer
.\.venv\Scripts\python.exe scripts\gerar_relatorio_faturamento.py `
  --bayer 2025/2026

# Ano contábil/calendário
.\.venv\Scripts\python.exe scripts\gerar_relatorio_contabilidade.py `
  --ano-contabil 2025

# Intervalo específico
.\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_pagas.py `
  --data-inicio 15082025 `
  --data-fim 30112025
```

Também é possível usar:

```powershell
--data-inicio 15/08/2025 --data-fim 30/11/2025
```

A ActionAPI recebe internamente as datas em `AAAA-MM-DD`, mas os títulos,
células e nomes dos arquivos gerados usam a apresentação brasileira.

## Menu interativo no terminal

Quando um script é executado sem parâmetros de período, ele pergunta:

```text
1 - Safra agrícola
2 - Período Bayer
3 - Ano contábil/calendário
4 - Intervalo livre
5 - Ano atual até hoje
```

Não há tela gráfica: a escolha e os dados são digitados diretamente no
terminal. Se o período for passado na linha de comando, o menu não aparece.
Nos relatórios avançados de contas a pagar e contas a receber, o período do
menu é aplicado ao vencimento das parcelas.

### Diferença entre aberto e realizado

- **Contas a receber**: títulos e parcelas que ainda possuem saldo em aberto.
- **Contas recebidas**: baixas efetivamente realizadas em `CRCBAIXA`.
- **Contas a pagar**: títulos e parcelas que ainda possuem saldo em aberto.
- **Contas pagas**: baixas efetivamente realizadas em `CPGBAIXA`.

O pacote executivo gera os quatro relatórios porque eles respondem perguntas
gerenciais diferentes.

## Endpoints executivos

| Endpoint | Finalidade |
|---|---|
| `/api/v1/executivo/faturamento` | Itens de faturamento enriquecidos. |
| `/api/v1/executivo/faturamento/resumo` | Receita líquida, devoluções, evolução e concentração. |
| `/api/v1/executivo/recebimentos` | Movimentos efetivamente recebidos. |
| `/api/v1/executivo/recebimentos/resumo` | Caixa recebido, encargos, descontos e estornos. |
| `/api/v1/executivo/pagamentos` | Movimentos efetivamente pagos. |
| `/api/v1/executivo/pagamentos/resumo` | Caixa pago, encargos, descontos e estornos. |
| `/api/v1/executivo/contabilidade/resumo` | Débitos, créditos, grupos e maiores contas. |
| `/api/v1/executivo/visao-360` | Receita, caixa, capital de giro e qualidade contábil. |

## Critérios

- Faturamento líquido usa o parâmetro de operações `102`, combinando funções
  de adição/subtração de `NOTA` com devoluções registradas em `NFENTRA`.
- Recebimentos e pagamentos consideram somente status `N` no caixa realizado.
  Movimentos `E` são apresentados separadamente como estornos.
- Valor líquido do movimento é principal mais multa, juros e acréscimo, menos
  desconto.
- Pontualidade compara a data efetiva do recebimento/pagamento com a data de
  vencimento da parcela. Os relatórios apresentam liquidações antecipadas, no
  vencimento, atrasadas e estornadas, além da média de dias de atraso.
- Contas a receber em aberto vêm do snapshot oficial
  `VALOR_ABERTO_RECEBER_DATA`.
- Contas a pagar em aberto vêm da reprodução validada de
  `VALOR_ABERTO_PAGAR_DATA`.
- A análise contábil usa plano `1000002`, contabilidade fiscal, exclui origem
  `ZR` e mantém a safra entre 01/07 e 30/06.
- O código da loja vem do lançamento contábil; o centro de custo é apenas uma
  referência para detectar inconsistências.

## Uso no React

Os endpoints de resumo foram criados para alimentar cards, gráficos de
evolução, rankings, concentração e alertas sem exigir que o frontend baixe
todos os movimentos. Os endpoints detalhados ficam disponíveis para drill-down
e auditoria.
