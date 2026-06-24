# Réplica da planilha DRE/BP do controller

Script: `scripts/dre_controller.py`

Este script gera uma réplica da planilha do controller
`SGA_DRE E BP 2021 a 2025 ANUAL_v2.xlsx`, mantendo as mesmas abas e o mesmo
conceito visual, mas substituindo o motor de cálculo do Excel por Python +
ActionAPI.

## Objetivo

Usar a planilha do controller como referência de layout, sem carregar o custo e
o risco das fórmulas `SOMASES/SUMIFS` espalhadas. O arquivo gerado:

- mantém as abas originais;
- escreve valores estáticos calculados pela API;
- não possui fórmulas reais em células;
- aplica as correções já identificadas na auditoria;
- deixa a aba `SGA_Balancete Geral` anual por loja, no layout original do
  controller.

## Como executar

Para uso manual, pode executar sem informar os anos. O script pergunta o
intervalo de exercícios e o exercício da aba comparativa:

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py
```

Para execução agendada/Docker, informe os parâmetros ou use `--nao-interativo`
para não depender de entrada no terminal.

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py `
  --anos 2021-2025 `
  --arquivo relatorios\dre-controller-2021-2025.xlsx
```

Para testar com API em outra porta:

```powershell
.\.venv\Scripts\python.exe scripts\dre_controller.py `
  --api-url http://127.0.0.1:3001 `
  --anos 2021-2025
```

Importante: reinicie a API/container antes de usar a porta padrão, pois o script
depende das rotas/parâmetros atuais:

- `/api/v1/executivo/contabilidade/sintetico?excluirEncerramento=true`
- `/api/v1/executivo/filiais`

## Abas preservadas

- `SGA_Dados Copiados`
- `SGA_Planejamento`
- `Fonte de Pesquisa e Orientações`
- `SGA_Balancete Geral`
- `SGA_Tab_Cadastro`
- `SGA_BP`
- `SGA_DRE Comparativa`
- `SGA_DRE Comparativa Exercicio`

Além das abas originais, o script cria `Mapa de Cálculo`, com célula, bloco,
linha/indicador, valor, critério e fonte de dados. Essa aba substitui a leitura
das fórmulas do Excel, já que a planilha final é calculada pelo Python.

## Filtro por ano de exercício

O arquivo final não usa fórmulas vivas (`SUMIFS`), então não dá para trocar o
ano numa célula e recalcular como no modelo do controller. Para permitir filtrar
o exercício, o script cria a aba **`DRE Comparativa por Ano`**:

- uma linha por **Ano × linha da DRE**, cobrindo todos os anos de `--anos`;
- as mesmas colunas comparativas do controller: `Consolidado`, `(%) A.V.` e, por
  filial, `Valor`, `(%) A.V.` e `(%) filial/Consolidado`;
- **filtro automático** do Excel já habilitado: abra o filtro da coluna `Ano`,
  escolha o exercício e a DRE inteira com os comparativos por filial passa a
  mostrar somente aquele ano. Painéis `Ano`/`Linha` ficam congelados.

A aba `SGA_DRE Comparativa` (layout idêntico ao controller) continua existindo,
fixada no ano de `--ano-comparativa`; a aba `SGA_DRE Comparativa Exercicio`
mantém a comparação lado a lado dos últimos exercícios. A `DRE Comparativa por
Ano` é a que permite escolher o exercício sem regerar o arquivo.

## Ajustes de estrutura

- `SGA_Planejamento`: cada bloco de filial agora possui 4 colunas fixas:
  `Média 2021/25`, `2025`, `2026 (Planejado)` em branco e `(%) A.V. - 2025`.
  A média usa os exercícios fechados informados em `--anos`; o planejado fica em
  branco até definirmos a fonte/regra de orçamento. A coluna de A.V. respeita a
  máscara de fórmulas da planilha original: só os campos que tinham cálculo no
  controller recebem percentual; os demais ficam em branco.
- `SGA_Balancete Geral`: a tabela é reconstruída em `A9:M...`, com as colunas
  originais `Loja`, `Exercício`, `Grau 1`, `Grau 3`, `Natureza da Conta`,
  `Grau`, `Conta Contábil`, `Nomenclatura da Conta`, `Saldo Anterior`,
  `Débito`, `Crédito`, `Saldo do Mês` e `Saldo Atual`. O balancete principal
  não mistura linhas mensais; a visão mês a mês deve ficar em aba própria para
  não quebrar a estrutura/filtros do controller.
- `SGA_BP`: a frase de filiais inativas é calculada via
  `/api/v1/executivo/filiais` usando `SITU_EMP`. Se todas estiverem ativas, o
  relatório informa `nenhuma`.
- `SGA_DRE Comparativa`: o exercício exibido vem de `--ano-comparativa` ou, por
  padrão, do maior ano em `--anos`; não fica mais fixo no texto do template.

## Correções aplicadas

- DRE calculada sem lançamento de encerramento anual:

  ```text
  excluirEncerramento=true
  HIST_HIS <> 1000191
  ```

- Resultado Contábil antes dos impostos corrigido para não descontar a perda de
  PCLD em dobro.
- Resultado Gerencial antes dos impostos separado do resultado contábil.
- ROA usa `Resultado do Exercício / Ativo Total`.
- ROE usa `Resultado do Exercício / Patrimônio Líquido`.
- Liquidez Geral usa o critério técnico:

  ```text
  (Ativo Circulante + Realizável a Longo Prazo) /
  (Passivo Circulante + Passivo Não Circulante)
  ```

- Endividamento usa o critério técnico:

  ```text
  (Passivo Circulante + Passivo Não Circulante) / Patrimônio Líquido
  ```

- Impostos nas vendas são abertos como total de deduções menos devoluções,
  evitando dupla contagem visual nas sublinhas.

## Observação sobre leveza

A planilha original possui milhares de colunas “usadas” por fórmulas/formatação.
O script poda as áreas vazias pesadas, preservando a área útil das abas, para
manter a réplica leve e abrir mais rápido no Excel.

O script valida a saída e falha se encontrar fórmula real remanescente em
células. Também remove as tabelas estruturadas antigas do template e recria os
filtros como `AutoFilter`, evitando o erro de reparo do Excel em
`/xl/tables/table*.xml`.

## Observação sobre diferenças contra a planilha modelo

Quando os valores diferirem da planilha `SGA_DRE E BP 2021 a 2025 ANUAL_v2.xlsx`,
o primeiro critério de validação é comparar API e PostgreSQL atual. Na validação
de 24/06/2026, API e PostgreSQL bateram entre si; a diferença encontrada em 2025
indica planilha modelo/cache desatualizada ou gerada com outro recorte.
