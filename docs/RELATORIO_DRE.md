# Relatório DRE e Balanço Patrimonial

Script: `scripts/relatorio_dre.py`

Gera uma planilha anual de DRE + Balanço Patrimonial inspirada no modelo
`relatorios/contabilidade/SGA_DRE E BP 2021 a 2025 ANUAL_v2.xlsx`, mas usando
dados atuais da ActionAPI.

## Como executar

```powershell
.\.venv\Scripts\python.exe scripts\relatorio_dre.py
```

Se `--anos` não for passado, o script **pergunta interativamente** o intervalo
(ex.: `2021-2025` ou `2021,2022,2025`). Aperte Enter para aceitar o padrão sugerido
(`2021` até o ano atual).

Para rodar sem prompt (ex.: automação), informe `--anos` explicitamente:

```powershell
.\.venv\Scripts\python.exe scripts\relatorio_dre.py `
  --anos 2021-2025 `
  --arquivo relatorios\relatorio-dre-2021-2025.xlsx
```

Se estiver testando uma API local em outra porta:

```powershell
.\.venv\Scripts\python.exe scripts\relatorio_dre.py --api-url http://127.0.0.1:3001
```

## Abas geradas

- `Painel`: principais KPIs do último ano e evolução de receita, lucro, EBITDA e resultado.
- `DRE Exercícios`: DRE anual por exercício, com análise horizontal e vertical.
- `DRE por Filial`: abertura por filial para **todos os anos** do intervalo, em formato
  longo (uma linha por ano/conta). Use o filtro do Excel no cabeçalho da coluna `Ano`
  (botão de filtro automático) para selecionar o exercício que quer ver — é o
  equivalente ao seletor de ano da planilha-modelo, só que via filtro nativo em vez de
  uma célula de seleção com fórmulas.
- `Balanço Patrimonial`: contas sintéticas do BP por ano.
- `Indicadores`: liquidez, endividamento, empréstimos/EBITDA, ROA e ROE.
- `Validação`: comparação dos principais números contra a planilha-modelo, quando disponível.
- `Mapeamento`: conta/fórmula usada em cada linha.
- `Auditoria Fórmulas`: pontos em que a fórmula do modelo/controller pode estar
  conceitualmente incorreta ou ambígua.
- `Memória de Cálculo`: justificativa linha a linha de valores, análise
  horizontal, análise vertical, DRE por filial, BP e indicadores.
- `Contas API DRE`: contas 3/4 retornadas pela API para auditoria.

## Memória de cálculo e rastreabilidade

A aba `Memória de Cálculo` foi criada para uso em auditoria com o controller.
Ela não depende de fórmulas do Excel: mostra o valor já calculado e, ao lado,
explica a regra usada.

Principais critérios:

- **Valor DRE**: vem da conta contábil mapeada ou de fórmula documentada na
  coluna `Fórmula / Critério`. Para receitas, o valor é `créditos - débitos`.
  Para custos/despesas, o valor é `débitos - créditos`.
- **Análise Horizontal (AH)**:

  ```text
  AH = (valor do ano atual / valor do ano anterior) - 1
  ```

  A memória mostra o numerador (`ano atual`) e o denominador (`ano anterior`).
  Se o ano anterior for zero, o relatório retorna 0 para evitar divisão inválida.

- **Análise Vertical (AV)**:

  ```text
  AV = valor da linha / base de comparação
  ```

  Na DRE, a base padrão é a `Receita Operacional Líquida`, salvo linhas
  explicitamente sem base percentual. A memória mostra a linha usada como
  numerador e a base usada como denominador.

- **DRE por Filial**:

  ```text
  % filial = valor da filial / valor consolidado da mesma linha
  ```

  A memória lista o `filialId`, a fonte da API e o valor consolidado usado como
  denominador.

- **Indicadores**: cada indicador possui a fórmula textual na memória, inclusive
  quando há critério técnico e critério do modelo lado a lado.

## Regra contábil importante

As contas de resultado são zeradas por lançamento de encerramento anual. Por isso,
o script usa:

```text
/api/v1/executivo/contabilidade/sintetico?excluirEncerramento=true
```

Esse parâmetro remove o histórico `HIST_HIS = 1000191` da consulta de DRE.
O comportamento padrão do endpoint não mudou; sem esse parâmetro ele continua
retornando o saldo contábil normal, incluindo encerramento.

Depois de publicar a alteração em `packages/api/src/services/executivo.js`, **reinicie
o serviço/container da API** (causa nº 1 de "filtro não aplicado"). Se a API em execução
ainda estiver com código antigo, o script para com uma mensagem avisando que
`excluirEncerramento=true` ainda não está ativo.

> **Atenção — verificação por ano.** O script só sonda a conta 311102 do ano mais
> recente para confirmar que o encerramento foi filtrado. A premissa é que o
> `HIST_HIS = 1000191` representa o encerramento em **todos** os anos da janela
> (2021-2025). Se algum ano usou outro código, a DRE daquele ano volta zerada sem
> aviso. Para conferir, compare uma conta de resultado (ex.: 311102) com e sem o
> filtro: sem o filtro o saldo fica ≈ 0 (débitos ≈ créditos por causa do
> encerramento); com o filtro o saldo deve refletir o movimento real do ano.
> Use `--permitir-api-sem-filtro` apenas para diagnóstico (segue mesmo sem o filtro).

## Tratamento da Perda de PCLD

A conta **Perda de PCLD (4211250060)** é tratada como **despesa realizada**, não como
provisão: ela permanece dentro das Despesas Administrativas/Comerciais e, portanto,
no Resultado Gerencial e no Resultado do Exercício (mesmo critério do modelo). Só as
provisões (Constituição/Reversão) saem da visão gerencial. A linha informativa
"Resultado Contábil antes dos Impostos (com PCLD)" foi **corrigida** para não
descontar a Perda em dobro — erro presente no modelo (célula r59) que só afeta anos
com write-off real (2021 = R$ 2,29 mi; zero em 2022-2025). Detalhes na aba
`Auditoria Fórmulas`.

## Melhorias em relação ao modelo

- ROA e ROE usam o Resultado do Exercício da própria DRE gerada, em vez do saldo de
  lucros/prejuízos acumulados do BP, que pode ficar zerado por fechamento/distribuição.
- A aba `Validação` deixa explícitas diferenças entre a planilha-modelo e a base atual
  da API, facilitando separar mudança de dados de erro de fórmula.
- Liquidez Geral e Endividamento mostram o critério técnico como principal e mantêm
  o critério observado no modelo em linha separada na aba `Indicadores`.
- A aba `Auditoria Fórmulas` documenta os pontos suspeitos, incluindo ROA, ROE,
  Liquidez Geral, Endividamento e a decomposição de impostos/devoluções em vendas.
