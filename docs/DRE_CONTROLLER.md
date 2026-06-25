# Relatório DRE/BP no estilo do controller

Script: `scripts/dre_controller.py`

Gera um relatório DRE + Balanço Patrimonial no **conceito** da planilha do
controller (DRE por exercício, comparativo por filial, balanço/indicadores,
planejamento e balancete geral), porém **100% montado a partir da ActionAPI** —
sem abrir nenhuma planilha-modelo e sem fórmulas vivas no Excel.

## Independente da planilha-modelo

O script **não** carrega mais `SGA_DRE E BP 2021 a 2025 ANUAL_v2.xlsx`. Todas as
abas são construídas do zero com os saldos vindos de
`/api/v1/executivo/contabilidade/sintetico`. Vantagens:

- nenhuma dependência de arquivo externo ou do layout/fórmulas do controller;
- valores são números estáticos calculados em Python (sem `SOMASE/SUMIFS`);
- as linhas da DRE/BP vêm de `DRE_LINES`/`BP_LINES` (mesma fonte do
  `relatorio_dre.py`), então correção de critério feita lá vale aqui também.

Se algum dado de cadastro for necessário no futuro (ex.: nome de filial), ele é
puxado da API (`/api/v1/executivo/filiais`), nunca de uma aba estática.

## Como executar

Sem argumentos, no terminal, o script pergunta o intervalo de exercícios:

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py
```

Para execução agendada/Docker, informe `--anos` (ou use `--nao-interativo`):

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py `
  --anos 2021-2025 `
  --arquivo relatorios\dre-controller-2021-2025.xlsx
```

API em outra porta:

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py --api-url http://127.0.0.1:3001 --anos 2021-2025
```

O script depende das rotas atuais — reinicie a API se elas tiverem mudado:

- `/api/v1/executivo/contabilidade/sintetico?excluirEncerramento=true`
- `/api/v1/executivo/filiais`

## Abas geradas

- **`DRE por Exercício`**: DRE com os anos lado a lado, A.V. por ano e A.H. entre
  anos consecutivos.
- **`DRE Comparativa por Ano`**: comparativo por filial, **filtrável por ano**.
- **`Balanço Patrimonial`**: contas do BP por ano + bloco de indicadores.
- **`Planejamento`**: por linha da DRE, média dos exercícios, último exercício,
  coluna de planejado em branco e A.V.; o mesmo por filial.
- **`Balancete Geral`**: uma linha por Loja/Exercício/Conta (saldo anterior,
  débito, crédito, saldo do mês e saldo atual).
- **`Mapa de Cálculo`**: documenta cada célula calculada (aba, célula, valor,
  critério e fonte na API) — substitui a leitura das fórmulas do Excel.

## Filtro por ano de exercício

Como o arquivo não usa fórmulas vivas, não dá para trocar o ano numa célula e
recalcular. A aba **`DRE Comparativa por Ano`** resolve isso:

- uma linha por **Ano × linha da DRE**, cobrindo todos os anos de `--anos`;
- segue a sequência de colunas visível do controller: `Contas Contábeis`,
  `Consolidado` e, por filial, `Valor` + `(%) no Consolidado` (sem as colunas de
  A.V. que eram ocultas no modelo);
- linhas de subtotal/resultado em **negrito com fundo verde**;
- **filtro automático** já habilitado: abra o filtro da coluna `Ano`, escolha o
  exercício e a DRE inteira com os comparativos por filial passa a mostrar só
  aquele ano. Colunas `Ano`/`Contas Contábeis` ficam congeladas.

## Análise Vertical (A.V.)

O A.V. é calculado **apenas nas linhas de subtotal/resultado** (Receita Líquida,
Custos, Lucro Bruto, Despesas, Lucro Operacional, Resultado Financeiro, PCLD,
Resultados, Provisões, Depreciação, EBITDA e Margem Bruta), igual ao critério do
modelo — nas linhas de detalhe fica em branco. Essa regra é definida uma única
vez em `AV_KEYS`/`av_for_dre_key` (scripts/dre_controller.py) e vale para as
três abas que mostram A.V./percentual por linha da DRE (DRE por Exercício,
DRE Comparativa por Ano e Planejamento) — não é recalculada separadamente em
cada aba.

## Colunas A/B (símbolos de filtro de conta)

As abas `DRE por Exercício`, `DRE Comparativa por Ano` e `Planejamento` trazem
duas colunas extras antes de `Contas Contábeis`, replicando os símbolos da
planilha-modelo:

- **Coluna A**: `*` nas contas analíticas/de detalhe (ex.: "Vendas de
  Mercadorias em Geral"); vazia nas linhas de subtotal.
- **Coluna B**: operador da linha de subtotal — `=` (primeira receita bruta),
  `(-)` (linha subtraída), `(=)` (resultado) ou `( + )` (soma); vazia nas
  linhas de detalhe e em algumas linhas específicas do modelo que não têm
  símbolo (`Despesas Administrativas e Comerciais`, `EBITDA`, `Margem Bruta`).

Esses símbolos servem para o usuário filtrar/agrupar contas no Excel (igual ao
controller usa nativamente). A fonte de verdade é o atributo `col_a`/`col_b` de
cada `DreLine` em `scripts/relatorio_dre.py` — conferido célula a célula contra
as 3 abas do modelo (`SGA_DRE Comparativa`, `SGA_DRE Comparativa Exercicio` e
`SGA_Planejamento`). Não recalcular essa regra a partir de `level`/`bold`: os
símbolos não são deriváveis desses campos (há excertos onde divergem, ex.:
`despesas_adm_com` é subtotal mas sem símbolo).

## Correções de critério aplicadas

- DRE sem o lançamento de encerramento anual (`excluirEncerramento=true`,
  `HIST_HIS <> 1000191`).
- Resultado Contábil antes dos impostos sem dupla contagem da perda de PCLD.
- Resultado Gerencial separado do Resultado Contábil.
- ROA = `Resultado do Exercício / Ativo Total`.
- ROE = `Resultado do Exercício / Patrimônio Líquido`.
- Liquidez Geral técnica = `(AC + Realizável LP) / (PC + PNC)`.
- Endividamento técnico = `(PC + PNC) / Patrimônio Líquido`.
- Impostos nas vendas abertos como total de deduções menos devoluções.

## Diferenças contra a planilha-modelo

Quando os valores diferirem da planilha `SGA_DRE E BP 2021 a 2025 ANUAL_v2.xlsx`,
o critério de validação é comparar API × PostgreSQL atual. Na validação de
24/06/2026, API e PostgreSQL bateram entre si; diferenças apontam planilha
modelo/cache desatualizada ou gerada com outro recorte.
