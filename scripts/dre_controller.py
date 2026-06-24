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
import calendar
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zipfile import ZipFile

try:
    from openpyxl import load_workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import column_index_from_string, get_column_letter
    from openpyxl.worksheet.table import Table, TableStyleInfo
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
        api_get,
        calculate_dre,
        calculate_indicators,
        dre_line_components_text,
        dre_line_formula_text,
        fetch_synthetic,
        format_formula_value,
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
        api_get,
        calculate_dre,
        calculate_indicators,
        dre_line_components_text,
        dre_line_formula_text,
        fetch_synthetic,
        format_formula_value,
        first_api_key,
        number,
        parse_years,
        safe_ratio,
        bp_value,
        assert_api_filter_supported,
    )


ROOT = Path(__file__).resolve().parents[1]

HEADER_FILL = PatternFill("solid", fgColor="0B5D1E")
WHITE_FONT = Font(color="FFFFFF", bold=True)
MONEY_FMT = '#,##0.00;[Red]-#,##0.00;""'
PERCENT_FMT = '0.00%;[Red]-0.00%;""'
NUMBER_FMT = '#,##0.00'
DATE_FMT = "dd/mm/yyyy hh:mm:ss"


@dataclass(frozen=True)
class BranchInfo:
    id: str
    nome: str
    situacao: str = "A"
    ativa: bool = True
    origem: str = "api"

    @property
    def label(self) -> str:
        return f"{self.nome} ({self.id})" if self.id not in str(self.nome) else self.nome

DRE_EXERCICIO_VALUE_COLS = [5, 8, 11, 14, 16]  # E, H, K, N, P
DRE_EXERCICIO_AH_COLS = [4, 7, 10, 13]         # D, G, J, M
DRE_EXERCICIO_AV_COLS = [6, 9, 12, 15, 17]     # F, I, L, O, Q

BP_YEAR_COLS = [4, 5, 6, 7, 8]  # D:H

TRIM_LIMITS = {
    "SGA_Planejamento": (80, 160),
    "SGA_BP": (8, 120),
    "SGA_DRE Comparativa": (80, 120),
    "SGA_DRE Comparativa Exercicio": (17, 120),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replica a planilha DRE/BP do controller com cálculos via ActionAPI."
    )
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--anos", help="Intervalo/lista de anos. Ex.: 2021-2025.")
    parser.add_argument("--ano-comparativa", type=int, help="Ano da aba SGA_DRE Comparativa. Padrão: maior ano.")
    parser.add_argument("--modelo", default=str(DEFAULT_MODEL), help="Arquivo .xlsx usado como template visual.")
    parser.add_argument("--arquivo", help="Arquivo .xlsx de saída.")
    parser.add_argument("--historico-encerramento", default=ENCERRAMENTO_HISTORICO)
    parser.add_argument(
        "--com-balancete-mensal",
        dest="balancete_mensal",
        action="store_true",
        help="Inclui linhas mensais no SGA_Balancete Geral.",
    )
    parser.add_argument(
        "--sem-balancete-mensal",
        dest="balancete_mensal",
        action="store_false",
        help="Gera apenas o balancete anual, mais rapido.",
    )
    parser.set_defaults(balancete_mensal=None)
    parser.add_argument(
        "--nao-interativo",
        action="store_true",
        help="Nao pergunta nada; usa defaults quando algum parametro nao for informado.",
    )
    parser.add_argument(
        "--permitir-api-sem-filtro",
        action="store_true",
        help="Permite continuar mesmo se a API em execução não aplicar excluirEncerramento=true.",
    )
    return parser.parse_args()


def ask_with_default(question: str, default: str) -> str:
    answer = input(f"{question} [{default}]: ").strip()
    return answer or default


def complete_interactive_args(args: argparse.Namespace) -> argparse.Namespace:
    """Pergunta no uso manual, mas preserva execução por serviço/Docker."""
    if args.nao_interativo or not sys.stdin.isatty():
        args.anos = args.anos or "2021-2025"
        if args.balancete_mensal is None:
            args.balancete_mensal = True
        return args

    if not args.anos:
        args.anos = ask_with_default(
            "Quais exercícios deseja gerar? Use intervalo/lista, ex.: 2021-2025 ou 2023,2024,2025",
            "2021-2025",
        )

    if args.balancete_mensal is None:
        print("\nComo deseja gerar o balancete?")
        print("  1 - Completo, com visão anual e mensal (mais demorado)")
        print("  2 - Rápido, somente visão anual")
        choice = ask_with_default("Escolha 1 ou 2", "1")
        args.balancete_mensal = choice.strip() != "2"

    years = parse_years(args.anos)
    if args.ano_comparativa is None:
        default_year = str(max(years))
        answer = ask_with_default(
            "Qual exercício deve aparecer na aba SGA_DRE Comparativa?",
            default_year,
        )
        args.ano_comparativa = int(answer)

    return args


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
    "SGA_Planejamento": {
        58: "resultado_contabil_antes_impostos",
        59: "resultado_gerencial_antes_impostos",
        62: "resultado_exercicio_contabil",
        63: "resultado_exercicio",
        70: "ebitda",
        71: "margem_bruta_valor",
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
    ("SGA_Planejamento", 58): "RESULTADO CONTÁBIL ANTES DOS IMPOSTOS",
    ("SGA_Planejamento", 59): "RESULTADO GERENCIAL ANTES DOS IMPOSTOS",
    ("SGA_Planejamento", 62): "RESULTADO DO EXERCÍCIO CONTÁBIL",
    ("SGA_Planejamento", 63): "RESULTADO DO EXERCÍCIO GERENCIAL",
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

def month_bounds(year: int, month: int) -> tuple[str, str]:
    last_day = calendar.monthrange(year, month)[1]
    return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last_day:02d}"


def fetch_branch_registry(api_url: str, api_key: str) -> tuple[list[BranchInfo], str]:
    """Busca filiais na ActionAPI; usa lista operacional antiga como fallback."""
    try:
        payload = api_get(api_url, api_key, "/api/v1/executivo/filiais", {})
        rows = payload.get("filiais", [])
        branches = [
            BranchInfo(
                id=str(row.get("id") or row.get("codigo") or "").strip(),
                nome=str(row.get("identificacao") or row.get("fantasia") or row.get("id") or "").strip(),
                situacao=str(row.get("situacao") or "").strip() or "SEM_STATUS",
                ativa=bool(row.get("ativa")),
                origem="api",
            )
            for row in rows
            if str(row.get("id") or row.get("codigo") or "").strip()
        ]
        branches.sort(key=lambda b: (int(b.id) if b.id.isdigit() else 999999, b.id))
        if branches:
            return branches, "ActionAPI /api/v1/executivo/filiais"
    except Exception as exc:
        print(
            f"[dre-controller] aviso: nao foi possivel consultar /executivo/filiais ({exc}); "
            "usando lista operacional padrao.",
            flush=True,
        )

    fallback = [BranchInfo(id=branch_id, nome=name, origem="fallback") for branch_id, name in BRANCHES]
    return fallback, "fallback BRANCHES em relatorio_dre.py; reinicie a API para usar /executivo/filiais"


def active_branches(branches: list[BranchInfo]) -> list[BranchInfo]:
    active = [branch for branch in branches if branch.ativa]
    return active or branches


def inactive_branches_text(branches: list[BranchInfo], source: str) -> str:
    inactive = [branch for branch in branches if (not branch.ativa) or branch.situacao.upper() == "I"]
    if not inactive:
        return f"Filiais INATIVAS: nenhuma conforme {source}."
    names = ", ".join(f"{branch.nome} ({branch.id})" for branch in inactive)
    return f"Filiais INATIVAS: {names} conforme {source}."


def set_number_format(cell, kind: str = "money") -> None:
    if kind == "percent":
        cell.number_format = PERCENT_FMT
    elif kind == "number":
        cell.number_format = NUMBER_FMT
    else:
        cell.number_format = MONEY_FMT


def write_audit(
    audit_rows: list[list[Any]],
    sheet: str,
    cell: str,
    bloco: str,
    tipo: str,
    year: int | str | None,
    month: int | str | None,
    branch: str,
    label: str,
    value: Any,
    criterio: str,
    fonte: str,
    observacao: str = "",
) -> None:
    audit_rows.append([
        sheet,
        cell,
        bloco,
        tipo,
        year,
        month,
        branch,
        label,
        value,
        criterio,
        fonte,
        observacao,
    ])


def clear_range(ws, min_row: int, max_row: int, min_col: int, max_col: int) -> None:
    for row in range(min_row, max_row + 1):
        for col in range(min_col, max_col + 1):
            ws.cell(row, col).value = None


def unmerge_intersecting(ws, min_row: int, max_row: int, min_col: int, max_col: int) -> None:
    for merged in list(ws.merged_cells.ranges):
        if (
            merged.max_row >= min_row
            and merged.min_row <= max_row
            and merged.max_col >= min_col
            and merged.min_col <= max_col
        ):
            ws.unmerge_cells(str(merged))


def reset_tables(ws) -> None:
    for name in list(ws.tables.keys()):
        del ws.tables[name]


def add_table(ws, display_name: str, ref: str) -> None:
    reset_tables(ws)
    table = Table(displayName=display_name, ref=ref)
    table.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium4",
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=True,
        showColumnStripes=False,
    )
    ws.add_table(table)


def fetch_all_data(args: argparse.Namespace, years: list[int], branches: list[BranchInfo]) -> tuple[
    dict[int, dict[str, dict[str, Any]]],
    dict[int, dict[str, float]],
    dict[int, dict[str, dict[str, Any]]],
    dict[int, dict[str, float]],
    dict[int, dict[str, dict[str, float]]],
    dict[tuple[int, int], dict[str, dict[str, Any]]],
]:
    api_key = first_api_key()
    dre_accounts_by_year: dict[int, dict[str, dict[str, Any]]] = {}
    dre_by_year: dict[int, dict[str, float]] = {}
    bp_accounts_by_year: dict[int, dict[str, dict[str, Any]]] = {}
    indicators_by_year: dict[int, dict[str, float]] = {}
    branch_dre_by_year: dict[int, dict[str, dict[str, float]]] = {}
    monthly_accounts: dict[tuple[int, int], dict[str, dict[str, Any]]] = {}

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

    def fetch_branch_year(year: int, branch: BranchInfo) -> tuple[int, BranchInfo, dict[str, float]]:
        accounts = fetch_synthetic(
            args.api_url,
            api_key,
            data_inicio=f"{year}-01-01",
            data_fim=f"{year}-12-31",
            filial_id=branch.id,
            excluir_encerramento=True,
            historico_encerramento=args.historico_encerramento,
        )
        return year, branch, with_extra_dre_values(calculate_dre(accounts))

    branch_tasks = [(year, branch) for year in years for branch in branches]
    max_workers = min(8, max(1, len(branch_tasks)))
    for year in years:
        branch_dre_by_year[year] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(fetch_branch_year, year, branch) for year, branch in branch_tasks]
        for future in as_completed(futures):
            year, branch, values = future.result()
            branch_dre_by_year[year][branch.id] = values
            print(f"[dre-controller] {year} filial {branch.id} {branch.nome}: DRE carregada", flush=True)

    if args.balancete_mensal:
        def fetch_month(year: int, month: int) -> tuple[int, int, dict[str, dict[str, Any]]]:
            data_inicio, data_fim = month_bounds(year, month)
            accounts = fetch_synthetic(
                args.api_url,
                api_key,
                data_inicio=data_inicio,
                data_fim=data_fim,
                excluir_encerramento=True,
                historico_encerramento=args.historico_encerramento,
            )
            return year, month, accounts

        month_tasks = [(year, month) for year in years for month in range(1, 13)]
        with ThreadPoolExecutor(max_workers=min(8, len(month_tasks))) as executor:
            futures = [executor.submit(fetch_month, year, month) for year, month in month_tasks]
            loaded_by_year: dict[int, int] = {year: 0 for year in years}
            for future in as_completed(futures):
                year, month, accounts = future.result()
                monthly_accounts[(year, month)] = accounts
                loaded_by_year[year] += 1
                if loaded_by_year[year] == 12:
                    print(f"[dre-controller] {year}: balancete mensal carregado", flush=True)

    return dre_accounts_by_year, dre_by_year, bp_accounts_by_year, indicators_by_year, branch_dre_by_year, monthly_accounts


def av_for_dre_key(key: str, values: dict[str, float]) -> float | None:
    line = next((item for item in DRE_LINES if item.key == key), None)
    if not line or not line.percent_base:
        return None
    return safe_ratio(values.get(key, 0.0), values.get(line.percent_base, 0.0))


def fill_dre_exercicio(
    ws,
    years: list[int],
    dre_by_year: dict[int, dict[str, float]],
    audit_rows: list[list[Any]],
) -> None:
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
            value_cell = ws.cell(row, DRE_EXERCICIO_VALUE_COLS[idx], current)
            set_number_format(value_cell, "money")
            line = next((item for item in DRE_LINES if item.key == key), None)
            write_audit(
                audit_rows,
                ws.title,
                value_cell.coordinate,
                "DRE por exercicio",
                "Valor",
                year,
                "Anual",
                "Consolidado",
                str(ws.cell(row, 3).value or ""),
                current,
                dre_line_formula_text(line) if line else "linha calculada em Python",
                f"/api/v1/executivo/contabilidade/sintetico?dataInicio={year}-01-01&dataFim={year}-12-31&excluirEncerramento=true",
                dre_line_components_text(line, values) if line else "",
            )
            av = av_for_dre_key(key, values)
            av_cell = ws.cell(row, DRE_EXERCICIO_AV_COLS[idx], av)
            set_number_format(av_cell, "percent")
            if av is not None:
                write_audit(
                    audit_rows,
                    ws.title,
                    av_cell.coordinate,
                    "DRE por exercicio",
                    "Analise vertical",
                    year,
                    "Anual",
                    "Consolidado",
                    str(ws.cell(row, 3).value or ""),
                    av,
                    "AV = valor da linha / Receita Operacional Liquida ou base definida na linha",
                    "valores calculados na propria DRE",
                    "",
                )
            if idx < len(display_years) - 1:
                previous = dre_by_year[display_years[idx + 1]].get(key, 0.0)
                ah = safe_ratio(current, previous) - 1 if previous else 0.0
                ah_cell = ws.cell(row, DRE_EXERCICIO_AH_COLS[idx], ah)
                set_number_format(ah_cell, "percent")
                write_audit(
                    audit_rows,
                    ws.title,
                    ah_cell.coordinate,
                    "DRE por exercicio",
                    "Analise horizontal",
                    year,
                    "Anual",
                    "Consolidado",
                    str(ws.cell(row, 3).value or ""),
                    ah,
                    "AH = (valor do ano atual / valor do ano anterior) - 1",
                    "valores calculados na propria DRE",
                    f"{year}={format_formula_value(current)}; {display_years[idx + 1]}={format_formula_value(previous)}",
                )


def fill_dre_comparativa(
    ws,
    year: int,
    dre_by_year: dict[int, dict[str, float]],
    branch_dre_by_year: dict[int, dict[str, dict[str, float]]],
    branches: list[BranchInfo],
    audit_rows: list[list[Any]],
) -> None:
    unmerge_intersecting(ws, 7, 7, 4, 80)
    clear_range(ws, 7, 120, 4, 80)
    ws.cell(4, 4, year)
    ws.cell(7, 4, f"Consolidado - {year}")
    ws.cell(7, 5, "Soma filiais")
    ws.cell(7, 6, "Confere")
    ws.cell(7, 7, f"(%) A.V. - {year}")
    for col in range(4, 8):
        ws.cell(7, col).fill = HEADER_FILL
        ws.cell(7, col).font = WHITE_FONT

    for idx, branch in enumerate(branches):
        col = 8 + (idx * 3)
        ws.cell(7, col, branch.nome)
        ws.cell(7, col + 1, f"(%) A.V. - {year}")
        ws.cell(7, col + 2, "(%) no Consolidado")
        for header_col in range(col, col + 3):
            ws.cell(7, header_col).fill = HEADER_FILL
            ws.cell(7, header_col).font = WHITE_FONT

    consolidated = dre_by_year[year]
    for row in range(8, 73):
        corrected = CORRECTED_LABELS.get((ws.title, row))
        if corrected:
            ws.cell(row, 3, corrected)
        key = dre_key_for_row(ws.title, row, ws.cell(row, 3).value)
        if not key:
            continue

        value = consolidated.get(key, 0.0)
        value_cell = ws.cell(row, 4, value)
        set_number_format(value_cell, "money")
        line = next((item for item in DRE_LINES if item.key == key), None)
        write_audit(
            audit_rows,
            ws.title,
            value_cell.coordinate,
            "DRE comparativa",
            "Valor",
            year,
            "Anual",
            "Consolidado",
            str(ws.cell(row, 3).value or ""),
            value,
            dre_line_formula_text(line) if line else "linha calculada em Python",
            f"/api/v1/executivo/contabilidade/sintetico?dataInicio={year}-01-01&dataFim={year}-12-31&excluirEncerramento=true",
            dre_line_components_text(line, consolidated) if line else "",
        )
        branch_sum = 0.0
        av_cell = ws.cell(row, 7, av_for_dre_key(key, consolidated))
        set_number_format(av_cell, "percent")
        for idx, branch in enumerate(branches):
            col = 8 + (idx * 3)
            branch_values = branch_dre_by_year[year].get(branch.id, {})
            branch_value = branch_values.get(key, 0.0)
            branch_sum += branch_value
            branch_cell = ws.cell(row, col, branch_value)
            set_number_format(branch_cell, "money")
            branch_av_cell = ws.cell(row, col + 1, av_for_dre_key(key, branch_values))
            branch_share_cell = ws.cell(row, col + 2, safe_ratio(branch_value, value))
            set_number_format(branch_av_cell, "percent")
            set_number_format(branch_share_cell, "percent")
            write_audit(
                audit_rows,
                ws.title,
                branch_cell.coordinate,
                "DRE comparativa",
                "Valor por filial",
                year,
                "Anual",
                branch.label,
                str(ws.cell(row, 3).value or ""),
                branch_value,
                dre_line_formula_text(line) if line else "linha calculada em Python",
                f"/api/v1/executivo/contabilidade/sintetico?dataInicio={year}-01-01&dataFim={year}-12-31&filialId={branch.id}&excluirEncerramento=true",
                dre_line_components_text(line, branch_values) if line else "",
            )
        sum_cell = ws.cell(row, 5, branch_sum)
        ws.cell(row, 6, abs(branch_sum - value) < 0.01)
        set_number_format(sum_cell, "money")


def average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def fill_planejamento(
    ws,
    years: list[int],
    dre_by_year: dict[int, dict[str, float]],
    branch_dre_by_year: dict[int, dict[str, dict[str, float]]],
    branches: list[BranchInfo],
    audit_rows: list[list[Any]],
) -> None:
    last_year = max(years)
    plan_year = last_year + 1
    period_label = f"{min(years)}/{str(last_year)[-2:]}"
    max_col = min(80, 7 + len(branches) * 4)

    unmerge_intersecting(ws, 5, 6, 4, 80)
    clear_range(ws, 5, 120, 4, 80)
    ws.cell(1, 3, f"Planejamento {plan_year}")
    ws.cell(5, 4, "CONSOLIDADO")
    ws.merge_cells(start_row=5, start_column=4, end_row=5, end_column=7)

    headers = [
        f"Media {period_label}",
        last_year,
        f"{plan_year} (Planejado)",
        f"(%) A.V. - {last_year}",
    ]
    for offset, header in enumerate(headers):
        cell = ws.cell(6, 4 + offset, header)
        cell.fill = HEADER_FILL
        cell.font = WHITE_FONT

    for idx, branch in enumerate(branches):
        start_col = 8 + idx * 4
        ws.cell(5, start_col, branch.nome)
        ws.merge_cells(start_row=5, start_column=start_col, end_row=5, end_column=start_col + 3)
        for offset, header in enumerate(headers):
            cell = ws.cell(6, start_col + offset, header)
            cell.fill = HEADER_FILL
            cell.font = WHITE_FONT

    for row in range(7, 72):
        corrected = CORRECTED_LABELS.get((ws.title, row))
        if corrected:
            ws.cell(row, 3, corrected)
        key = dre_key_for_row(ws.title, row, ws.cell(row, 3).value)
        if not key:
            continue

        label = str(ws.cell(row, 3).value or "")
        consolidated_media = average([dre_by_year[year].get(key, 0.0) for year in years])
        consolidated_last = dre_by_year[last_year].get(key, 0.0)
        consolidated_av = av_for_dre_key(key, dre_by_year[last_year])
        line = next((item for item in DRE_LINES if item.key == key), None)

        values = [
            ("Media historica", consolidated_media, "money"),
            ("Ultimo exercicio fechado", consolidated_last, "money"),
            ("Planejado", None, "money"),
            ("Analise vertical", consolidated_av, "percent"),
        ]
        for offset, (tipo, value, kind) in enumerate(values):
            cell = ws.cell(row, 4 + offset, value)
            set_number_format(cell, kind)
            write_audit(
                audit_rows,
                ws.title,
                cell.coordinate,
                "Planejamento",
                tipo,
                last_year if tipo != "Media historica" else f"{min(years)}-{last_year}",
                "Anual",
                "Consolidado",
                label,
                value,
                "Media = media simples dos exercicios fechados; ultimo ano = valor calculado da DRE; planejado fica em branco; AV = valor / Receita Operacional Liquida.",
                "/api/v1/executivo/contabilidade/sintetico",
                dre_line_formula_text(line) if line and tipo != "Analise vertical" else "",
            )

        for idx, branch in enumerate(branches):
            start_col = 8 + idx * 4
            branch_values_last = branch_dre_by_year[last_year].get(branch.id, {})
            branch_media = average([
                branch_dre_by_year.get(year, {}).get(branch.id, {}).get(key, 0.0)
                for year in years
            ])
            branch_last = branch_values_last.get(key, 0.0)
            branch_av = av_for_dre_key(key, branch_values_last)
            branch_values = [
                ("Media historica por filial", branch_media, "money"),
                ("Ultimo exercicio fechado por filial", branch_last, "money"),
                ("Planejado por filial", None, "money"),
                ("Analise vertical por filial", branch_av, "percent"),
            ]
            for offset, (tipo, value, kind) in enumerate(branch_values):
                cell = ws.cell(row, start_col + offset, value)
                set_number_format(cell, kind)
                write_audit(
                    audit_rows,
                    ws.title,
                    cell.coordinate,
                    "Planejamento",
                    tipo,
                    last_year if "Media" not in tipo else f"{min(years)}-{last_year}",
                    "Anual",
                    branch.label,
                    label,
                    value,
                    "Media = media simples dos exercicios fechados da filial; ultimo ano = DRE da filial; planejado fica em branco; AV = valor / Receita Operacional Liquida da filial.",
                    f"/api/v1/executivo/contabilidade/sintetico?filialId={branch.id}",
                    dre_line_formula_text(line) if line and "Analise vertical" not in tipo else "",
                )

    for col in range(4, max_col + 1):
        ws.column_dimensions[get_column_letter(col)].width = 16
    ws.freeze_panes = "D7"
    ws.auto_filter.ref = f"A6:{get_column_letter(max_col)}71"


def fill_bp(
    ws,
    years: list[int],
    bp_accounts_by_year: dict[int, dict[str, dict[str, Any]]],
    indicators_by_year: dict[int, dict[str, float]],
    inactive_text: str,
    audit_rows: list[list[Any]],
) -> None:
    ws.cell(4, 2, inactive_text)
    display_years = sorted(years)[: len(BP_YEAR_COLS)]
    for idx, year in enumerate(display_years):
        ws.cell(5, BP_YEAR_COLS[idx], year)

    for row in range(6, 96):
        account = ws.cell(row, 2).value
        account_text = str(account or "").strip()
        for idx, year in enumerate(display_years):
            col = BP_YEAR_COLS[idx]
            if account_text and re.fullmatch(r"\d+", account_text):
                value = bp_value(bp_accounts_by_year[year], account_text)
                cell = ws.cell(row, col, value)
                set_number_format(cell, "money")
                write_audit(
                    audit_rows,
                    ws.title,
                    cell.coordinate,
                    "BP",
                    "Valor",
                    year,
                    "Anual",
                    "Consolidado",
                    f"{account_text} - {ws.cell(row, 3).value or ''}",
                    value,
                    "Saldo acumulado; Ativo = D-C; Passivo/PL = sinal invertido para apresentacao positiva.",
                    f"/api/v1/executivo/contabilidade/sintetico?dataInicio={DATA_INICIO_PLANO_ATUAL}&dataFim={year}-12-31",
                    "",
                )

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
            value = indicators_by_year[year].get(key, 0.0)
            cell = ws.cell(row, BP_YEAR_COLS[idx], value)
            set_number_format(cell, "number")
            write_audit(
                audit_rows,
                ws.title,
                cell.coordinate,
                "BP",
                "Indicador",
                year,
                "Anual",
                "Consolidado",
                str(ws.cell(row, 2).value or key),
                value,
                description,
                "DRE + BP calculados pela ActionAPI",
                "Indicador corrigido quando havia erro no modelo do controller.",
            )

    # Check Ativo x Passivo nas linhas originais do template.
    for idx, year in enumerate(display_years):
        col = BP_YEAR_COLS[idx]
        ativo = bp_value(bp_accounts_by_year[year], "1")
        passivo = bp_value(bp_accounts_by_year[year], "2")
        ws.cell(60, col, ativo)
        ws.cell(61, col, passivo)
        ws.cell(62, col, ativo - passivo)


def fill_fonte(ws, years: list[int], generated_at: str, branch_source: str, inactive_text: str) -> None:
    rows = [
        ("Fonte dos dados", "ActionAPI /api/v1/executivo/contabilidade/sintetico"),
        ("Período", f"{min(years)} a {max(years)}"),
        ("Gerado em", generated_at),
        ("Cálculo", "Python; planilha gerada sem fórmulas em células."),
        ("DRE", f"excluirEncerramento=true; HIST_HIS <> {ENCERRAMENTO_HISTORICO}"),
        ("Filiais", f"{branch_source}. {inactive_text}"),
        ("Balancete", "Aba com filtro por exercício, mês e tipo de período. Linhas anuais usam saldos anuais/acumulados; linhas mensais usam movimento do mês."),
        ("Planejamento", "Cada bloco possui Média dos exercícios fechados, último exercício fechado, planejado em branco e A.V. do último exercício."),
        ("Mapa de Cálculo", "Aba criada pelo Python para documentar células calculadas, fonte e critério, já que o arquivo final não contém fórmulas."),
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
    ws._current_row = start_row - 1


def fill_balancete_geral(
    ws,
    years: list[int],
    dre_accounts_by_year: dict[int, dict[str, dict[str, Any]]],
    bp_accounts_by_year: dict[int, dict[str, dict[str, Any]]],
    monthly_accounts: dict[tuple[int, int], dict[str, dict[str, Any]]],
    generated_at: str,
    audit_rows: list[list[Any]],
) -> None:
    clear_rows_from(ws, 10)
    clear_range(ws, 9, 9, 1, 20)
    ws.cell(1, 15, generated_at)
    ws.cell(3, 1, "SULGOIANO AGRONEGÓCIOS LTDA")
    ws.cell(4, 1, "Balancete API - consolidado")
    ws.cell(5, 1, "Dados gerados pela ActionAPI; DRE sem encerramento HIST_HIS=1000191; BP acumulado. Inclui filtros por exercicio e mes.")

    headers = [
        "Loja",
        "Exercício",
        "Mês",
        "Tipo período",
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
        cell = ws.cell(9, col, header)
        cell.fill = HEADER_FILL
        cell.font = WHITE_FONT

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
                "Anual",
                "Anual",
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
            excel_row = ws.max_row
            for col in range(11, 16):
                set_number_format(ws.cell(excel_row, col), "money")
            if len(account_id) <= 4 and abs(value) > 0.004:
                write_audit(
                    audit_rows,
                    ws.title,
                    f"N{excel_row}:O{excel_row}",
                    "Balancete",
                    "Anual",
                    year,
                    "Anual",
                    "Consolidado",
                    f"{account_id} - {row.get('descricao') or ''}",
                    value,
                    "Saldo exibido conforme criterio gerencial; contas 2 e 3 com sinal invertido.",
                    "/api/v1/executivo/contabilidade/sintetico",
                    f"Debitos={format_formula_value(number(row.get('debitos')))}; Creditos={format_formula_value(number(row.get('creditos')))}",
                )

    for (year, month), accounts in sorted(monthly_accounts.items()):
        for account_id in sorted(accounts):
            row = accounts[account_id]
            debits = number(row.get("debitos"))
            credits = number(row.get("creditos"))
            saldo = number(row.get("saldo"))
            if abs(debits) < 0.005 and abs(credits) < 0.005 and abs(saldo) < 0.005:
                continue
            value = account_display_value(account_id, row)
            ws.append([
                "Consolidado",
                year,
                month,
                "Mensal",
                account_group_description(account_id),
                None,
                None if len(account_id) not in (4, 6, 10) else row.get("descricao"),
                len(account_id),
                account_id,
                row.get("descricao"),
                0.0,
                debits,
                credits,
                value,
                value,
            ])
            excel_row = ws.max_row
            for col in range(11, 16):
                set_number_format(ws.cell(excel_row, col), "money")

    ws.freeze_panes = "A10"
    ws.auto_filter.ref = f"A9:O{ws.max_row}"
    add_table(ws, "TabelaBalanceteGeral", f"A9:O{ws.max_row}")
    widths = {
        "A": 14, "B": 12, "C": 10, "D": 14, "E": 18, "F": 14, "G": 28,
        "H": 10, "I": 16, "J": 48, "K": 16, "L": 16, "M": 16, "N": 16, "O": 16,
    }
    for col, width in widths.items():
        ws.column_dimensions[col].width = width
    trim_worksheet_fast(ws, 15, ws.max_row)


def create_mapa_calculo(wb, audit_rows: list[list[Any]]) -> None:
    sheet_name = "Mapa de Cálculo"
    if sheet_name in wb.sheetnames:
        del wb[sheet_name]
    ws = wb.create_sheet(sheet_name)
    headers = [
        "Aba",
        "Célula",
        "Bloco",
        "Tipo de valor",
        "Ano",
        "Mês",
        "Filial",
        "Linha/Indicador",
        "Valor",
        "Fórmula/Critério",
        "Fonte",
        "Observação",
    ]
    ws.append(headers)
    for cell in ws[1]:
        cell.fill = HEADER_FILL
        cell.font = WHITE_FONT
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    for row in audit_rows:
        ws.append(row)
        value_cell = ws.cell(ws.max_row, 9)
        if isinstance(value_cell.value, (int, float)):
            if "vertical" in str(ws.cell(ws.max_row, 4).value).lower() or "horizontal" in str(ws.cell(ws.max_row, 4).value).lower():
                set_number_format(value_cell, "percent")
            else:
                set_number_format(value_cell, "money")
        for col in range(10, 13):
            ws.cell(ws.max_row, col).alignment = Alignment(wrap_text=True, vertical="top")

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    widths = {
        "A": 32, "B": 14, "C": 22, "D": 28, "E": 14, "F": 12,
        "G": 24, "H": 42, "I": 16, "J": 70, "K": 70, "L": 70,
    }
    for col, width in widths.items():
        ws.column_dimensions[col].width = width


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
    api_key = first_api_key()
    branch_registry, branch_source = fetch_branch_registry(args.api_url, api_key)
    report_branches = active_branches(branch_registry)
    inactive_text = inactive_branches_text(branch_registry, branch_source)
    print(
        f"[dre-controller] filiais ativas para DRE/Planejamento: "
        f"{', '.join(branch.id for branch in report_branches)}",
        flush=True,
    )
    print(f"[dre-controller] {inactive_text}", flush=True)
    audit_rows: list[list[Any]] = []
    (
        dre_accounts_by_year,
        dre_by_year,
        bp_accounts_by_year,
        indicators_by_year,
        branch_dre_by_year,
        monthly_accounts,
    ) = fetch_all_data(args, years, report_branches)

    fill_dre_exercicio(wb["SGA_DRE Comparativa Exercicio"], years, dre_by_year, audit_rows)
    fill_dre_comparativa(wb["SGA_DRE Comparativa"], selected_year, dre_by_year, branch_dre_by_year, report_branches, audit_rows)
    fill_planejamento(wb["SGA_Planejamento"], years, dre_by_year, branch_dre_by_year, report_branches, audit_rows)
    fill_bp(wb["SGA_BP"], years, bp_accounts_by_year, indicators_by_year, inactive_text, audit_rows)
    fill_fonte(wb["Fonte de Pesquisa e Orientações"], years, generated_at, branch_source, inactive_text)
    fill_balancete_geral(wb["SGA_Balancete Geral"], years, dre_accounts_by_year, bp_accounts_by_year, monthly_accounts, generated_at, audit_rows)
    create_mapa_calculo(wb, audit_rows)

    required = [
        "SGA_Dados Copiados",
        "SGA_Planejamento",
        "Fonte de Pesquisa e Orientações",
        "SGA_Balancete Geral",
        "SGA_Tab_Cadastro",
        "SGA_BP",
        "SGA_DRE Comparativa",
        "SGA_DRE Comparativa Exercicio",
        "Mapa de Cálculo",
    ]
    save_controller_workbook(wb, output, required)
    print(f"[dre-controller] arquivo: {output}")
    return output


def main() -> None:
    try:
        generate_report(complete_interactive_args(parse_args()))
    except Exception as exc:
        print(f"[dre-controller] erro: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
