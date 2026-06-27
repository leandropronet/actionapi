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

Os dados de cadastro de filial vêm da API (`/api/v1/executivo/filiais`), nunca
de uma aba estática. Se essa rota não estiver disponível, o script usa a lista
operacional antiga apenas como fallback.

## Como executar

Sem argumentos, no terminal, o script pergunta o intervalo de exercícios e, em
seguida, a data final do exercício mais recente (Enter para fechar em 31/12
normalmente, sem corte):

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py
```

Para execução agendada/Docker, informe `--anos` (ou use `--nao-interativo`) —
nesse caso nenhuma pergunta é feita, mesmo sem `--data-fim`:

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py `
  --anos 2021-2025 `
  --arquivo relatorios\dre-controller-2021-2025.xlsx
```

API em outra porta:

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py --api-url http://127.0.0.1:3001 --anos 2021-2025
```

### Relatório parcial (até uma data específica)

Para fechar o exercício mais recente numa data específica em vez de 31/12 — por
exemplo, tirar o relatório com o ano corrente só até 31/05/2026 — use
`--data-fim`:

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py `
  --anos 2021-2025 `
  --data-fim 31/05/2026
```

Regras:

- `--data-fim` é digitado no **padrão brasileiro `DD/MM/AAAA`** (ex.:
  `31/05/2026`). Também aceita `DD-MM-AAAA`, `DD.MM.AAAA` ou `DDMMAAAA` sem
  separador; **não** aceita o formato ISO (`AAAA-MM-DD`).
- O ano de `--data-fim` precisa ser o **ano mais recente** do intervalo. Se ele
  não estiver em `--anos` (como no exemplo acima, onde 2026 não estava em
  `2021-2025`), o script adiciona esse ano automaticamente.
- Só o ano mais recente é cortado; os anos anteriores continuam fechando em
  31/12 normalmente.
- Internamente a data é convertida para ISO (`AAAA-MM-DD`) antes de qualquer
  consulta à API/Postgres — o formato brasileiro é só para digitação.
- O nome do arquivo gerado automaticamente ganha o sufixo `-ate-AAAA-MM-DD`
  (ex.: `dre-controller-2021-2026-ate-2026-05-31.xlsx`), salvo se `--arquivo`
  for informado.
- A aba `Mapa de Cálculo` registra a data exata usada em cada consulta à API,
  então é possível confirmar o corte direto na planilha.

O script depende das rotas atuais — reinicie a API se elas tiverem mudado:

- `/api/v1/executivo/contabilidade/sintetico?excluirEncerramento=true`
- `/api/v1/executivo/filiais`

## Consolidado e filiais

Nas abas de DRE, o **Consolidado** é calculado como a **soma das filiais
exibidas no próprio relatório**. Isso evita o problema clássico de a chamada
geral da API conter uma filial que não aparece nas colunas do comparativo.

O script valida internamente essa consistência antes de salvar o arquivo. Se o
consolidado anual, a média do `Planejamento`, o último exercício fechado ou o
período parcial não baterem com a soma das filiais, a geração falha com mensagem
indicando a linha divergente.

A planilha final não cria aba auxiliar de conferência; a rastreabilidade fica na
aba `Mapa de Cálculo`.

## Abas geradas

- **`DRE por Exercício`**: DRE com os anos lado a lado, A.V. por ano e A.H. entre
  anos consecutivos.
- **`DRE Comparativa por Ano`**: comparativo por filial, **filtrável por ano**.
- **`Balanço Patrimonial`**: contas do BP por ano + bloco de indicadores.
- **`Planejamento`**: por linha da DRE, média dos exercícios **fechados**, valor
  do exercício corrente e coluna de planejado em branco; o mesmo por filial
  (sem A.V. — ver seção própria abaixo).
- **`Balancete Geral`**: uma linha por Loja/Exercício/Conta (saldo anterior,
  débito, crédito, saldo do mês e saldo atual).
- **`Mapa de Cálculo`**: documenta cada célula calculada das abas gerenciais e
  os intervalos calculados do Balancete Geral (aba, célula/range, valor,
  critério, fonte, dependências e formato) — substitui a leitura das fórmulas do
  Excel.

## Filtro por ano de exercício

Como o arquivo não usa fórmulas vivas, não dá para trocar o ano numa célula e
recalcular. A aba **`DRE Comparativa por Ano`** resolve isso:

- uma linha por **Ano × linha da DRE**, cobrindo todos os anos de `--anos`;
- segue a sequência `Contas Contábeis`, `Consolidado` e, por filial,
  `Valor` + `(%) no Consolidado`;
- as filiais vêm do cadastro da API, com código no cabeçalho para evitar
  ambiguidade;
- linhas de subtotal/resultado em **negrito com fundo verde**;
- **filtro automático** já habilitado: abra o filtro da coluna `Ano`, escolha o
  exercício e a DRE inteira com os comparativos por filial passa a mostrar só
  aquele ano. Colunas `Ano`/`Contas Contábeis` ficam congeladas.

## Análise Vertical (A.V.)

O A.V. é calculado **apenas nas linhas de subtotal/resultado** (Receita Líquida,
Custos, Lucro Bruto, Despesas, Lucro Operacional, Resultado Financeiro, PCLD,
Resultados, Provisões, Depreciação, EBITDA e Margem Bruta), igual ao critério do
modelo — nas linhas de detalhe fica em branco. Essa regra é definida uma única
vez em `AV_KEYS`/`av_for_dre_key` (scripts/dre_controller.py) e vale para a
coluna "(%) A.V." de `DRE por Exercício`/`DRE Comparativa por Ano` e para a
coluna "% Consol." de `Planejamento` — não é recalculada separadamente em
cada aba. A aba `Planejamento` **não tem coluna de A.V.** (removida — só
mantém "% Consol.", explicado abaixo).

## Aba Planejamento: médias, exercício corrente e --data-fim

Estrutura de colunas **fixa** — não muda se você usar `--data-fim` ou não:

- **Consolidado (4 colunas):** Média | Último exercício fechado | Parcial | Planejado.
- **Cada filial (5 colunas):** Média | Último exercício fechado | Parcial | Planejado | % Consol.
- Uma linha mesclada acima do cabeçalho agrupa visualmente cada bloco
  ("CONSOLIDADO" sobre as 4 colunas; o nome da filial sobre as 5 dela),
  igual ao modelo do controller. O filtro automático do Excel fica na linha
  de cabeçalho real (a de baixo), não na linha de agrupamento.

Regras:

- **"Média"** usa só os exercícios **fechados** do intervalo — nunca inclui
  o ano parcial cortado por `--data-fim`. Ex.: `--anos 2021-2025 --data-fim
  31/05/2026` (que estende automaticamente para 2021-2026) gera "Média
  2021-2025", calculada só com os 5 anos fechados.
- **"Último exercício fechado"** mostra o valor do último ano realmente
  fechado (ex.: "2025"), sempre — com ou sem `--data-fim`.
- **"Parcial"** só tem valor quando há `--data-fim` (ano ainda não fechado);
  sem `--data-fim` a coluna existe mas fica vazia em todas as linhas, com o
  cabeçalho "(parcial)". Quando há corte, o cabeçalho mostra o **mês/ano**
  em português (ex.: "maio/2026") em vez do ano puro, pra deixar explícito
  que é parcial.
- **"% Consol."** (participação da filial, só nas linhas de subtotal/
  resultado) é sempre calculada com base no **último exercício fechado**,
  nunca no ano parcial — um período incompleto distorceria a proporção
  entre filiais.

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

Esses símbolos servem para o usuário filtrar/agrupar contas no Excel. A fonte de
verdade é o atributo `col_a`/`col_b` de cada `DreLine` em
`scripts/relatorio_dre.py`; o `dre_controller.py` não lê nenhuma planilha
externa para obter esses símbolos. Não recalcular essa regra a partir de
`level`/`bold`: os símbolos não são deriváveis desses campos (há casos onde
divergem, ex.: `despesas_adm_com` é subtotal mas sem símbolo).

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
