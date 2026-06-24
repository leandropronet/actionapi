#!/usr/bin/env python3
r"""Replica a planilha DRE/BP do controller usando cálculos da ActionAPI.

Este script usa a planilha do controller como *template visual* e substitui as
fórmulas por valores estáticos calculados em Python. A saída preserva as mesmas
abas/conceito do arquivo-base, mas não depende de SOMASE/SUMIFS para calcular.

Correções já incorporadas:
  - filtro do encerramento contábil (HIST_HIS=1000191) para DRE;
  - Resultado Contábil antes dos impostos sem dupla contagem da perda de PCLD;
  - ROA/ROE calculados pelo Resultado do Exercício da DRE;
  - Liquidez Geral técnica e Endividamento técnico no BP;
  - impostos/devoluções em vendas abertos sem dupla contagem visual.

Exemplo:

    .\.venv\Scripts\python.exe scripts\dre_controller.py --anos 2021-2025
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zipfile import ZipFile

try:
    from openpyxl import load_workbook
    from openpyxl.utils import column_index_from_string
except ModuleNotFoundError:
    print(
        "Dependência ausente. Execute:\n"
        "  py -m pip install -r scripts/requirements-relatorio-contas-pagar.txt",
        file=sys.stderr,
    )
    raise SystemExit(2)

try:
    from relatorio_dre import (
        BP_LINES,
        BRANCHES,
        DATA_INICIO_PLANO_ATUAL,
        DEFAULT_API_URL,
        DEFAULT_MODEL,
        ENCERRAMENTO_HISTORICO,
        DRE_LINES,
        calculate_dre,
        calculate_indicators,
        fetch_synthetic,
        first_api_key,
        number,
        parse_years,
        safe_ratio,
        bp_value,
        assert_api_filter_supported,
    )
except ModuleNotFoundError:
    from scripts.relatorio_dre import (
        BP_LINES,
        BRANCHES,
        DATA_INICIO_PLANO_ATUAL,
        DEFAULT_API_URL,
        DEFAULT_MODEL,
        ENCERRAMENTO_HISTORICO,
        DRE_LINES,
        calculate_dre,
        calculate_indicators,
        fetch_synthetic,
        first_api_key,
        number,
        parse_years,
        safe_ratio,
        bp_value,
        assert_api_filter_supported,
    )


ROOT = Path(__file__).resolve().parents[1]

DRE_EXERCICIO_VALUE_COLS = [5, 8, 11, 14, 16]  # E, H, K, N, P
DRE_EXERCICIO_AH_COLS = [4, 7, 10, 13]         # D, G, J, M
DRE_EXERCICIO_AV_COLS = [6, 9, 12, 15, 17]     # F, I, L, O, Q

DRE_COMPARATIVA_BRANCH_COLS = [
    ("1", "Goiatuba", 8),      # H
    ("9", "Piracanjuba", 11),  # K
    ("8", "Alvorada", 14),     # N
    ("3", "Gurupi", 17),       # Q
    ("4", "Lagoa", 20),        # T
    ("5", "Porto", 23),        # W
]

BP_YEAR_COLS = [4, 5, 6, 7, 8]  # D:H

TRIM_LIMITS = {
    "SGA_Planejamento": (80, 160),
    "SGA_BP": (8, 120),
    "SGA_DRE Comparativa": (25, 120),
    "SGA_DRE Comparativa Exercicio": (17, 120),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replica a planilha DRE/BP do controller com cálculos via ActionAPI."
    )
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--anos", default="2021-2025", help="Intervalo/lista de anos. Ex.: 2021-2025.")
    parser.add_argument("--ano-comparativa", type=int, help="Ano da aba SGA_DRE Comparativa. Padrão: maior ano.")
    parser.add_argument("--modelo", default=str(DEFAULT_MODEL), help="Arquivo .xlsx usado como template visual.")
    parser.add_argument("--arquivo", help="Arquivo .xlsx de saída.")
    parser.add_argument("--historico-encerramento", default=ENCERRAMENTO_HISTORICO)
    parser.add_argument(
        "--permitir-api-sem-filtro",
        action="store_true",
        help="Permite continuar mesmo se a API em execução não aplicar excluirEncerramento=true.",
    )
    return parser.parse_args()


def normalize_label(value: Any) -> str:
    import unicodedata

    text = str(value or "").strip().lower()
    text = "".join(
        ch for ch in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(ch)
    )
    text = re.sub(r"\s+", " ", text)
    return text


DRE_LABEL_TO_KEY = {
    normalize_label("Receita Bruta Com Vendas"): "receita_bruta",
    normalize_label("Vendas De Mercadorias Em Geral"): "vendas_mercadorias",
    normalize_label("Venda De Defensivos"): "venda_defensivos",
    normalize_label("Venda De Fertilizantes"): "venda_fertilizantes",
    normalize_label("Venda De Sementes"): "venda_sementes",
    normalize_label("Prestaçao De Servico/Locacao"): "prestacao_servico",
    normalize_label("Prestação de Serviço/Locação"): "prestacao_servico",
    normalize_label("Avp Receitas"): "avp_receitas",
    normalize_label("Deducoes Da Receita Bruta De Vendas De Mercadorias"): "deducoes_receita",
    normalize_label("Devolucoes De Vendas"): "devolucoes_geral",
    normalize_label("Impostos nas Vendas em Geral"): "impostos_geral",
    normalize_label("Devolucoes De Vendas Defensivos"): "devolucoes_defensivos",
    normalize_label("Impostos nas Vendas de Defensivos"): "impostos_defensivos",
    normalize_label("Devolucoes De Vendas Fertilizantes"): "devolucoes_fertilizantes",
    normalize_label("Impostos nas Vendas de Fertilizantes"): "impostos_fertilizantes",
    normalize_label("Devolucoes De Vendas Sementes"): "devolucoes_sementes",
    normalize_label("Impostos nas Vendas de Sementes"): "impostos_sementes",
    normalize_label("Deducoes Da Receita Bruta De Servicos E Locacao"): "deducoes_servicos",
    normalize_label("RECEITA OPERACIONAL LÍQUIDA"): "receita_liquida",
    normalize_label("Custos S/ Vendas"): "custos_vendas",
    normalize_label("Custos Das Mercad Em Geral Vendidas"): "custos_mercadorias",
    normalize_label("Custos Do Defensivos Vendidos"): "custos_defensivos",
    normalize_label("Custos Dos Fertilizantes Vendidos"): "custos_fertilizantes",
    normalize_label("Custos Das Sementes Vendidas"): "custos_sementes",
    normalize_label("Custos Dos Servicos Prestados"): "custos_servicos",
    normalize_label("Avp Custo"): "avp_custo",
    normalize_label("LUCRO BRUTO (Margem Bruta)"): "lucro_bruto",
    normalize_label("Despesas Administrativas E Comerciais"): "despesas_adm_com",
    normalize_label("Despesas Com Rh Diretores"): "rh_diretores",
    normalize_label("Despesas C/ Rh Fixas"): "rh_fixas",
    normalize_label("Despesas C/ Rh Variaveis"): "rh_variaveis",
    normalize_label("Ocupaçao"): "ocupacao",
    normalize_label("Utilidades E Serviços"): "utilidades",
    normalize_label("Despesas De Funcionamento"): "funcionamento",
    normalize_label("Serviços Profissionais"): "servicos_profissionais",
    normalize_label("Comunicacao"): "comunicacao",
    normalize_label("Propaganda E Publicidade"): "propaganda",
    normalize_label("Frota"): "frota",
    normalize_label("Transporte/ Logisticas"): "transporte",
    normalize_label("Tributos E Contribuicoes"): "tributos",
    normalize_label("Despesas Bancarias"): "despesas_bancarias",
    normalize_label("LUCRO OPERCAIONAL ANTES DO RESULTADO FINANCEIRO E PROVISÕES"): "lucro_operacional",
    normalize_label("LUCRO OPERCAIONAL ANTES DO RESULTADO FINANCEIRO E PROVISŐES"): "lucro_operacional",
    normalize_label("Resultado Financeiro"): "resultado_financeiro",
    normalize_label("Receitas Financeiras Totais"): "receitas_financeiras",
    normalize_label("Despesas Financeiras Totais"): "despesas_financeiras",
    normalize_label("PCLD"): "pcld",
    normalize_label("4211250060 - Despesa Com Perda De Pcld"): "pcld_perda",
    normalize_label("4211250001 - Constituição do PCLD Contabil"): "pcld_constituicao",
    normalize_label("4211250001 - Constituiçăo do PCLD Contabil"): "pcld_constituicao",
    normalize_label("4211250006 - Reversão do PCLD Contabil"): "pcld_reversao",
    normalize_label("4211250006 - Reversăo do PCLD Contabil"): "pcld_reversao",
    normalize_label("Outras Receitas E Despesas Operacionais"): "outras_rec_desp",
    normalize_label("Contituicao De Perdas Estimadas Nos Estoques"): "perdas_estoque",
    normalize_label("Provisoes Fiscais"): "provisoes_fiscais",
    normalize_label("Imposto De Renda E Contribuicoes Social"): "ir_cs",
    normalize_label("RESULTADO DO EXERCÍCIO"): "resultado_exercicio",
    normalize_label("RESULTADO DO EXERCÍCIO GERENCIAL"): "resultado_exercicio",
    normalize_label("Depreciacao E Amortizacoes (Equipamentos/Veiculos)"): "depreciacao",
    normalize_label("4211130006 - Depreciacao E Amortizacoes Veiculos"): "depreciacao_veiculos",
    normalize_label("4211080003 - Depreciacao E Amortizaçoes Moveis E Equip Inform"): "depreciacao_equipamentos",
    normalize_label("EBITDA"): "ebitda",
    normalize_label("MARGEM BRUTA"): "margem_bruta_valor",
}

DRE_ROW_KEY_OVERRIDES = {
    "SGA_DRE Comparativa Exercicio": {
        59: "resultado_contabil_antes_impostos",
        60: "resultado_gerencial_antes_impostos",
        63: "resultado_exercicio",
        70: "ebitda",
        71: "margem_bruta_valor",
    },
    "SGA_DRE Comparativa": {
        59: "resultado_contabil_antes_impostos",
        60: "resultado_gerencial_antes_impostos",
        63: "resultado_exercicio_contabil",
        64: "resultado_exercicio",
        71: "ebitda",
        72: "margem_bruta_valor",
    },
}

CORRECTED_LABELS = {
    ("SGA_DRE Comparativa Exercicio", 59): "RESULTADO CONTÁBIL ANTES DOS IMPOSTOS",
    ("SGA_DRE Comparativa Exercicio", 60): "RESULTADO GERENCIAL ANTES DOS IMPOSTOS",
    ("SGA_DRE Comparativa Exercicio", 63): "RESULTADO DO EXERCÍCIO GERENCIAL",
    ("SGA_DRE Comparativa", 59): "RESULTADO CONTÁBIL ANTES DOS IMPOSTOS",
    ("SGA_DRE Comparativa", 60): "RESULTADO GERENCIAL ANTES DOS IMPOSTOS",
    ("SGA_DRE Comparativa", 63): "RESULTADO DO EXERCÍCIO CONTÁBIL",
    ("SGA_DRE Comparativa", 64): "RESULTADO DO EXERCÍCIO GERENCIAL",
}


def dre_key_for_row(sheet_name: str, row: int, label: Any) -> str | None:
    if row in DRE_ROW_KEY_OVERRIDES.get(sheet_name, {}):
        return DRE_ROW_KEY_OVERRIDES[sheet_name][row]
    return DRE_LABEL_TO_KEY.get(normalize_label(label))


def with_extra_dre_values(values: dict[str, float]) -> dict[str, float]:
    output = dict(values)
    output["resultado_exercicio_contabil"] = (
        output.get("resultado_contabil_antes_impostos", 0.0)
        - output.get("provisoes_fiscais", 0.0)
    )
    return output


def trim_worksheet_fast(ws, max_col: int, max_row: int | None = None) -> None:
    """Remove células/formatações fora da área útil do template.

    O arquivo do controller tem milhares de colunas "usadas" por formatação e
    fórmulas antigas. Usamos a API/Python como motor, então esses trechos não
    carregam informação relevante e só tornam o XLSX pesado/lento.
    """
    max_row = max_row or ws.max_row
    for key in list(ws._cells):
        row, col = key
        if col > max_col or row > max_row:
            del ws._cells[key]
    for key in list(ws.column_dimensions):
        try:
            if column_index_from_string(key) > max_col:
                del ws.column_dimensions[key]
        except ValueError:
            pass
    for key in list(ws.row_dimensions):
        if key > max_row:
            del ws.row_dimensions[key]
    for merged in list(ws.merged_cells.ranges):
        if merged.max_col > max_col or merged.max_row > max_row:
            ws.unmerge_cells(str(merged))
    for table in list(ws.tables.values()):
        if table.ref:
            # Mantém tabelas dentro da área útil quando possível. Caso a tabela
            # original ultrapasse a área podada, limitamos ao intervalo útil.
            start = table.ref.split(":", 1)[0]
            end_col = ws.cell(1, max_col).column_letter
            table.ref = f"{start}:{end_col}{max_row}"


def load_template_without_formulas(template: Path):
    wb = load_workbook(template, data_only=False, keep_links=False)
    cached = load_workbook(template, data_only=True, keep_links=False)
    for sheet_name, (max_col, max_row) in TRIM_LIMITS.items():
        if sheet_name in wb.sheetnames:
            trim_worksheet_fast(wb[sheet_name], max_col, max_row)
    for ws in wb.worksheets:
        cached_ws = cached[ws.title]
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    cell.value = cached_ws[cell.coordinate].value
    cached.close()
    return wb


def count_cell_formulas(workbook) -> int:
    return sum(
        1
        for ws in workbook.worksheets
        for row in ws.iter_rows()
        for cell in row
        if isinstance(cell.value, str) and cell.value.startswith("=") and cell.value.strip() != "="
    )


def list_cell_formulas(workbook, limit: int = 20) -> list[str]:
    formulas = []
    for ws in workbook.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("=") and cell.value.strip() != "=":
                    formulas.append(f"{ws.title}!{cell.coordinate}={cell.value}")
                    if len(formulas) >= limit:
                        return formulas
    return formulas


def save_controller_workbook(workbook, output: Path, required_sheets: list[str]) -> None:
    formulas = count_cell_formulas(workbook)
    if formulas:
        examples = "; ".join(list_cell_formulas(workbook, 10))
        raise RuntimeError(f"A planilha ainda contém {formulas} fórmulas em células: {examples}")
    output.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output)
    with ZipFile(output) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f"Arquivo XLSX inválido: falha em {bad}.")
    check = load_workbook(output, read_only=True, data_only=False)
    missing = [sheet for sheet in required_sheets if sheet not in check.sheetnames]
    formula_count = count_cell_formulas(check)
    check.close()
    if missing or formula_count:
        raise RuntimeError(f"Validação falhou: abas ausentes={missing}, fórmulas={formula_count}.")


def fetch_all_data(args: argparse.Namespace, years: list[int], branch_year: int) -> tuple[
    dict[int, dict[str, dict[str, Any]]],
    dict[int, dict[str, float]],
    dict[int, dict[str, dict[str, Any]]],
    dict[int, dict[str, float]],
    dict[int, dict[str, dict[str, float]]],
]:
    api_key = first_api_key()
    dre_accounts_by_year: dict[int, dict[str, dict[str, Any]]] = {}
    dre_by_year: dict[int, dict[str, float]] = {}
    bp_accounts_by_year: dict[int, dict[str, dict[str, Any]]] = {}
    indicators_by_year: dict[int, dict[str, float]] = {}
    branch_dre_by_year: dict[int, dict[str, dict[str, float]]] = {}

    for year in years:
        dre_accounts = fetch_synthetic(
            args.api_url,
            api_key,
            data_inicio=f"{year}-01-01",
            data_fim=f"{year}-12-31",
            excluir_encerramento=True,
            historico_encerramento=args.historico_encerramento,
        )
        if year == max(years):
            assert_api_filter_supported(dre_accounts, args.permitir_api_sem_filtro)
        bp_accounts = fetch_synthetic(
            args.api_url,
            api_key,
            data_inicio=DATA_INICIO_PLANO_ATUAL,
            data_fim=f"{year}-12-31",
        )
        dre_accounts_by_year[year] = dre_accounts
        dre_by_year[year] = with_extra_dre_values(calculate_dre(dre_accounts))
        bp_accounts_by_year[year] = bp_accounts
        indicators_by_year[year] = calculate_indicators(year, dre_by_year[year], bp_accounts)
        print(f"[dre-controller] {year}: DRE e BP carregados", flush=True)

    branch_dre_by_year[branch_year] = {}
    for branch_id, branch_name in BRANCHES:
        accounts = fetch_synthetic(
            args.api_url,
            api_key,
            data_inicio=f"{branch_year}-01-01",
            data_fim=f"{branch_year}-12-31",
            filial_id=branch_id,
            excluir_encerramento=True,
            historico_encerramento=args.historico_encerramento,
        )
        branch_dre_by_year[branch_year][branch_id] = with_extra_dre_values(calculate_dre(accounts))
        print(f"[dre-controller] {branch_year} filial {branch_id} {branch_name}: DRE carregada", flush=True)

    return dre_accounts_by_year, dre_by_year, bp_accounts_by_year, indicators_by_year, branch_dre_by_year


def av_for_dre_key(key: str, values: dict[str, float]) -> float | None:
    line = next((item for item in DRE_LINES if item.key == key), None)
    if not line or not line.percent_base:
        return None
    return safe_ratio(values.get(key, 0.0), values.get(line.percent_base, 0.0))


def fill_dre_exercicio(ws, years: list[int], dre_by_year: dict[int, dict[str, float]]) -> None:
    display_years = sorted(years, reverse=True)[: len(DRE_EXERCICIO_VALUE_COLS)]
    for idx, year in enumerate(display_years):
        ws.cell(8, DRE_EXERCICIO_VALUE_COLS[idx], year)
        ws.cell(8, DRE_EXERCICIO_AV_COLS[idx], f"(%) A.V. - {year}")
        if idx < len(display_years) - 1:
            prev_year = display_years[idx + 1]
            ws.cell(8, DRE_EXERCICIO_AH_COLS[idx], f"(%) A.H. - {year}/{prev_year}")

    for row in range(9, 72):
        corrected = CORRECTED_LABELS.get((ws.title, row))
        if corrected:
            ws.cell(row, 3, corrected)
        key = dre_key_for_row(ws.title, row, ws.cell(row, 3).value)
        if not key:
            continue
        for idx, year in enumerate(display_years):
            values = dre_by_year[year]
            current = values.get(key, 0.0)
            ws.cell(row, DRE_EXERCICIO_VALUE_COLS[idx], current)
            av = av_for_dre_key(key, values)
            ws.cell(row, DRE_EXERCICIO_AV_COLS[idx], av)
            if idx < len(display_years) - 1:
                previous = dre_by_year[display_years[idx + 1]].get(key, 0.0)
                ws.cell(row, DRE_EXERCICIO_AH_COLS[idx], safe_ratio(current, previous) - 1 if previous else 0.0)


def fill_dre_comparativa(
    ws,
    year: int,
    dre_by_year: dict[int, dict[str, float]],
    branch_dre_by_year: dict[int, dict[str, dict[str, float]]],
) -> None:
    ws.cell(4, 4, year)
    ws.cell(7, 4, f"Consolidado - {year}")
    ws.cell(7, 7, f"(%) A.V. - {year}")
    for branch_id, branch_name, col in DRE_COMPARATIVA_BRANCH_COLS:
        ws.cell(7, col, branch_name)
        ws.cell(7, col + 1, f"(%) A.V. - {year}")
        ws.cell(7, col + 2, "(%) no Consolidado")

    consolidated = dre_by_year[year]
    for row in range(8, 73):
        corrected = CORRECTED_LABELS.get((ws.title, row))
        if corrected:
            ws.cell(row, 3, corrected)
        key = dre_key_for_row(ws.title, row, ws.cell(row, 3).value)
        if not key:
            continue

        value = consolidated.get(key, 0.0)
        ws.cell(row, 4, value)
        branch_sum = 0.0
        ws.cell(row, 7, av_for_dre_key(key, consolidated))
        for branch_id, _branch_name, col in DRE_COMPARATIVA_BRANCH_COLS:
            branch_values = branch_dre_by_year[year][branch_id]
            branch_value = branch_values.get(key, 0.0)
            branch_sum += branch_value
            ws.cell(row, col, branch_value)
            ws.cell(row, col + 1, av_for_dre_key(key, branch_values))
            ws.cell(row, col + 2, safe_ratio(branch_value, value))
        ws.cell(row, 5, branch_sum)
        ws.cell(row, 6, abs(branch_sum - value) < 0.01)


def fill_bp(ws, years: list[int], bp_accounts_by_year: dict[int, dict[str, dict[str, Any]]], indicators_by_year: dict[int, dict[str, float]]) -> None:
    display_years = sorted(years)[: len(BP_YEAR_COLS)]
    for idx, year in enumerate(display_years):
        ws.cell(5, BP_YEAR_COLS[idx], year)

    for row in range(6, 96):
        account = ws.cell(row, 2).value
        account_text = str(account or "").strip()
        for idx, year in enumerate(display_years):
            col = BP_YEAR_COLS[idx]
            if account_text and re.fullmatch(r"\d+", account_text):
                ws.cell(row, col, bp_value(bp_accounts_by_year[year], account_text))

    indicator_rows = {
        66: ("liquidez_corrente", "Ativo Circulante / Passivo Circulante"),
        70: ("liquidez_imediata", "Disponível / Passivo Circulante"),
        73: ("liquidez_seca", "(Ativo Circulante - Estoques) / Passivo Circulante"),
        77: ("liquidez_geral", "(Ativo Circulante + Realizável a Longo Prazo) / (Passivo Circulante + Passivo Não Circulante)"),
        80: ("endividamento", "(Passivo Circulante + Passivo Não Circulante) / Patrimônio Líquido"),
        83: ("emprestimos_ebitda", "Empréstimos Bancários / EBITDA"),
        86: ("roa", "Resultado do Exercício / Ativo Total"),
        90: ("roe", "Resultado do Exercício / Patrimônio Líquido"),
        94: ("ebitda", "EBITDA da DRE gerencial"),
    }
    for row, (key, description) in indicator_rows.items():
        ws.cell(row, 3, description)
        for idx, year in enumerate(display_years):
            ws.cell(row, BP_YEAR_COLS[idx], indicators_by_year[year].get(key, 0.0))

    # Check Ativo x Passivo nas linhas originais do template.
    for idx, year in enumerate(display_years):
        col = BP_YEAR_COLS[idx]
        ws.cell(60, col, bp_value(bp_accounts_by_year[year], "1"))
        ws.cell(61, col, bp_value(bp_accounts_by_year[year], "2"))
        ws.cell(62, col, bp_value(bp_accounts_by_year[year], "1") - bp_value(bp_accounts_by_year[year], "2"))


def fill_fonte(ws, years: list[int], generated_at: str) -> None:
    rows = [
        ("Fonte dos dados", "ActionAPI /api/v1/executivo/contabilidade/sintetico"),
        ("Período", f"{min(years)} a {max(years)}"),
        ("Gerado em", generated_at),
        ("Cálculo", "Python; planilha gerada sem fórmulas em células."),
        ("DRE", f"excluirEncerramento=true; HIST_HIS <> {ENCERRAMENTO_HISTORICO}"),
        ("Correções", "PCLD sem dupla contagem da perda; ROA/ROE pelo resultado da DRE; Liquidez Geral e Endividamento técnicos; impostos/devoluções abertos sem dupla contagem visual."),
        ("Validação", "As abas preservam o layout/conceito do controller; os valores foram reescritos como números estáticos."),
    ]
    for idx, (label, text) in enumerate(rows, start=1):
        ws.cell(idx, 1, f"{label}: {text}")


def account_group_description(account_id: str) -> str:
    if account_id.startswith("1"):
        return "Ativo"
    if account_id.startswith("2"):
        return "Passivo"
    if account_id.startswith("3"):
        return "Receitas"
    if account_id.startswith("4"):
        return "Custos e Despesas"
    return "Outros"


def account_display_value(account_id: str, row: dict[str, Any]) -> float:
    saldo = number(row.get("saldo"))
    if account_id.startswith(("2", "3")):
        return -saldo
    return saldo


def clear_rows_from(ws, start_row: int) -> None:
    for key in list(ws._cells):
        row, _col = key
        if row >= start_row:
            del ws._cells[key]
    for key in list(ws.row_dimensions):
        if key >= start_row:
            del ws.row_dimensions[key]


def fill_balancete_geral(
    ws,
    years: list[int],
    dre_accounts_by_year: dict[int, dict[str, dict[str, Any]]],
    bp_accounts_by_year: dict[int, dict[str, dict[str, Any]]],
    generated_at: str,
) -> None:
    clear_rows_from(ws, 10)
    ws.cell(1, 13, generated_at)
    ws.cell(3, 1, "SULGOIANO AGRONEGÓCIOS LTDA")
    ws.cell(4, 1, "Balancete API - consolidado")
    ws.cell(5, 1, "Dados gerados pela ActionAPI; DRE sem encerramento HIST_HIS=1000191; BP acumulado.")

    headers = [
        "Loja",
        "Exercício",
        "Grau 1",
        "Grau 3",
        "Natureza da Conta",
        "Grau",
        "Conta Contábil",
        "Nomenclatura da Conta",
        "Saldo Anterior",
        "Débito",
        "Crédito",
        "Saldo do Mês",
        "Saldo Atual",
    ]
    for col, header in enumerate(headers, start=1):
        ws.cell(9, col, header)

    for year in years:
        rows_by_account: dict[str, dict[str, Any]] = {}
        for account_id, row in bp_accounts_by_year[year].items():
            if account_id.startswith(("1", "2")):
                rows_by_account[account_id] = row
        for account_id, row in dre_accounts_by_year[year].items():
            if account_id.startswith(("3", "4")):
                rows_by_account[account_id] = row

        for account_id in sorted(rows_by_account):
            row = rows_by_account[account_id]
            value = account_display_value(account_id, row)
            ws.append([
                "Consolidado",
                year,
                account_group_description(account_id),
                None,
                None if len(account_id) not in (4, 6, 10) else row.get("descricao"),
                len(account_id),
                account_id,
                row.get("descricao"),
                0.0,
                number(row.get("debitos")),
                number(row.get("creditos")),
                value,
                value,
            ])

    # Atualiza o range da tabela original, se existir. A planilha não usa mais
    # fórmulas, mas manter a tabela facilita filtro/visualização no Excel.
    for table in list(ws.tables.values()):
        table.ref = f"A9:M{ws.max_row}"


def generate_report(args: argparse.Namespace) -> Path:
    years = parse_years(args.anos)
    if len(years) > 5:
        raise ValueError("A réplica do template suporta até 5 anos, igual ao arquivo do controller.")
    model = Path(args.modelo).resolve()
    if not model.exists():
        raise FileNotFoundError(f"Template não encontrado: {model}")
    selected_year = args.ano_comparativa or max(years)
    if selected_year not in years:
        raise ValueError("--ano-comparativa deve estar dentro de --anos.")

    output = (
        Path(args.arquivo).resolve()
        if args.arquivo
        else ROOT / "relatorios" / f"dre-controller-{min(years)}-{max(years)}.xlsx"
    )
    generated_at = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    print(f"[dre-controller] carregando template: {model}", flush=True)
    wb = load_template_without_formulas(model)
    print(f"[dre-controller] consultando ActionAPI em {args.api_url}...", flush=True)
    dre_accounts_by_year, dre_by_year, bp_accounts_by_year, indicators_by_year, branch_dre_by_year = fetch_all_data(args, years, selected_year)

    fill_dre_exercicio(wb["SGA_DRE Comparativa Exercicio"], years, dre_by_year)
    fill_dre_comparativa(wb["SGA_DRE Comparativa"], selected_year, dre_by_year, branch_dre_by_year)
    fill_bp(wb["SGA_BP"], years, bp_accounts_by_year, indicators_by_year)
    fill_fonte(wb["Fonte de Pesquisa e Orientações"], years, generated_at)
    fill_balancete_geral(wb["SGA_Balancete Geral"], years, dre_accounts_by_year, bp_accounts_by_year, generated_at)

    required = [
        "SGA_Dados Copiados",
        "SGA_Planejamento",
        "Fonte de Pesquisa e Orientações",
        "SGA_Balancete Geral",
        "SGA_Tab_Cadastro",
        "SGA_BP",
        "SGA_DRE Comparativa",
        "SGA_DRE Comparativa Exercicio",
    ]
    save_controller_workbook(wb, output, required)
    print(f"[dre-controller] arquivo: {output}")
    return output


def main() -> None:
    try:
        generate_report(parse_args())
    except Exception as exc:
        print(f"[dre-controller] erro: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
