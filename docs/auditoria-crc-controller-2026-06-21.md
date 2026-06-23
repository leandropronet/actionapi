# Auditoria parcela a parcela — CRC Controller em 21/06/2026

PDF auditado: `relatorios\contabilidade\CRC 21062026.pdf`.

## Conclusão

A diferença de **R$ 166.408,89** não é PDD, FIDC, duplicata descontada nem ajuste a valor presente. Ela é composta por **seis baixas normais retroativas**, com data de pagamento em 17/06/2026 ou 19/06/2026, mas gravadas/alteradas no Oracle em 22/06/2026 — depois do snapshot/replicação usado pela base local.

Ao consultar novamente `VALOR_ABERTO_RECEBER_DATA` no Oracle para a data 2026-06-21, já com essas baixas presentes, os seis saldos ficam idênticos ao PDF. Portanto, a função é não bitemporal: uma baixa lançada depois, mas retrodatada, altera o resultado histórico.

## Validação do parser

| Fonte | R$ | SJ$ (sacas) | Parcelas |
|---|---:|---:|---:|
| PDF | R$ 156.885.616,21 | 40.733,86 | 3,876 |
| Base local | R$ 157.052.025,10 | 40.733,86 | 3,879 |

A extração usa `pdftotext -layout` para validar o fechamento, `-table` para as colunas e `-raw` para recuperar a chave documental sem as sobreposições visuais do relatório.

## Fechamento do cruzamento

| Grupo | Quantidade | Efeito nós − PDF |
|---|---:|---:|
| Na nossa base e não no PDF | 3 | R$ 64.765,28 |
| No PDF e não na nossa base | 0 | R$ 0,00 |
| Presentes em ambos, saldo diferente | 3 | R$ 101.643,61 |
| **Líquido** | **6** | **R$ 166.408,89** |

## Parcelas divergentes

| Cliente | Documento | Nosso saldo | PDF | Diferença | Tipo | Histórico |
|---|---|---:|---:|---:|---|---|
| 10005804 — WEIDER BORGES DE OLIVEIRA | 28965-6/1 | R$ 56.781,08 | R$ 0,00 | R$ 56.781,08 | 101 — DUPLICATA A RECEBER | — |
| 10005804 — WEIDER BORGES DE OLIVEIRA | 29124-6/1 | R$ 149.742,50 | R$ 106.156,74 | R$ 43.585,76 | 101 — DUPLICATA A RECEBER | — |
| 10000869 — VADERLEI FRANSOLIN | 43469-4/1 | R$ 111.200,76 | R$ 72.547,41 | R$ 38.653,35 | 101 — DUPLICATA A RECEBER | 1300 HA DUPLICATA Prorrogação: 10001871 |
| 10005552 — CYRO NAKAMURA | 28268-6/1 | R$ 90.327,90 | R$ 70.923,40 | R$ 19.404,50 | 101 — DUPLICATA A RECEBER | — |
| 10010010 — NILTON TIETZ | 46119-4/1 | R$ 5.764,20 | R$ 0,00 | R$ 5.764,20 | 101 — DUPLICATA A RECEBER | PIX |
| 30004729 — BIOACAI NEGOCIOS SUSTENTAVEIS LTDA | 11980-5/1 | R$ 2.220,00 | R$ 0,00 | R$ 2.220,00 | 101 — DUPLICATA A RECEBER | — |

## Classificação das hipóteses

Por tipo de documento:

- 101 — DUPLICATA A RECEBER: 6 parcela(s).

Por padrão em `HIST_REC`:

- PIX: 1 parcela(s).
- PRORROGAÇÃO: 1 parcela(s).
- SEM PADRÃO: 4 parcela(s).

Não há ocorrência de FIDC/FIDIC, PDD, desconto de duplicata ou AVP nos históricos dos ofensores. Uma parcela menciona prorrogação e uma menciona PIX; ambas também são explicadas pelas baixas retroativas.

## Baixas retroativas encontradas no Oracle e ausentes no PostgreSQL

| Documento | CTRL_REC | Data da baixa | Valor | Desconto | DUMANUT no Oracle |
|---|---:|---|---:|---:|---|
| 43469-4/1 | 20105642 | 2026-06-19 | R$ 38.653,35 | R$ 0,00 | 2026-06-22 13:44:26 |
| 28268-6/1 | 20112563 | 2026-06-17 | R$ 19.404,50 | R$ 0,00 | 2026-06-22 12:55:54 |
| 28965-6/1 | 20115366 | 2026-06-19 | R$ 56.781,08 | R$ 207,54 | 2026-06-22 11:23:04 |
| 29124-6/1 | 20116082 | 2026-06-19 | R$ 43.585,76 | R$ 159,30 | 2026-06-22 11:23:04 |
| 46119-4/1 | 20120369 | 2026-06-19 | R$ 5.764,20 | R$ 0,00 | 2026-06-22 12:12:25 |
| 11980-5/1 | 20120371 | 2026-06-19 | R$ 2.220,00 | R$ 0,00 | 2026-06-22 12:21:47 |
| **Total** |  |  | **R$ 166.408,89** |  |  |

As baixas têm `SITU_BAI = 'N'` (normais). Não há agrupamentos nas seis parcelas.

## Implicação técnica

Um snapshot diário de saldo histórico não basta para reproduzir relatórios passados quando o ERP aceita lançamentos retroativos. Para auditorias futuras, conservar também a data de captura (`as of`) dos fatos ou reconsultar a função Oracle após fechar o período. O ETL de `recebimentos` deve ser reexecutado para trazer as seis baixas.

Gerado em 2026-06-22T20:41:49-03:00.

## Correção aplicada em 22/06/2026

O job incremental de recebimentos foi executado novamente, trazendo as seis
baixas retroativas. Em seguida, os saldos financeiros locais foram recalculados.

Uma nova execução da auditoria produziu:

- parcelas somente na base local: 0;
- parcelas somente no PDF: 0;
- parcelas com saldo diferente: 0;
- diferença líquida: **R$ 0,00**.

Também foram implementados cursor incremental com sobreposição de 48 horas,
reconciliação diária dos últimos 30 dias, monitoramento persistente, alertas
Telegram configuráveis e execução permanente do ETL.
