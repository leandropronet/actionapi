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
- deixa a aba `SGA_Balancete Geral` com base consolidada gerada pela API.

## Como executar

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

## Abas preservadas

- `SGA_Dados Copiados`
- `SGA_Planejamento`
- `Fonte de Pesquisa e Orientações`
- `SGA_Balancete Geral`
- `SGA_Tab_Cadastro`
- `SGA_BP`
- `SGA_DRE Comparativa`
- `SGA_DRE Comparativa Exercicio`

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
células.
