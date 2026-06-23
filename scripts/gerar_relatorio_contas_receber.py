#!/usr/bin/env python3
r"""Gera relatório avançado de Contas a Receber consumindo a ActionAPI.

Exemplo:

    .\.venv\Scripts\python.exe scripts\gerar_relatorio_contas_receber.py \
      --vencimento-de 2026-07-01 \
      --vencimento-ate 2026-12-31 \
      --arquivo relatorios\contas-receber-segundo-semestre.xlsx

O script não acessa Oracle nem PostgreSQL. A API key é lida de API_KEYS no
.env e nunca é gravada na planilha.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from gerar_relatorios_executivos import (
        add_data_base_argument,
        add_period_arguments,
        has_period_argument,
        parse_user_date,
        prompt_data_base_if_needed,
        resolve_data_base,
        resolve_period,
    )
except ModuleNotFoundError:
    from scripts.gerar_relatorios_executivos import (
        add_data_base_argument,
        add_period_arguments,
        has_period_argument,
        parse_user_date,
        prompt_data_base_if_needed,
        resolve_data_base,
        resolve_period,
    )

try:
    from openpyxl import Workbook, load_workbook
    from openpyxl.chart import BarChart, PieChart, Reference
    from openpyxl.formatting.rule import FormulaRule
    from openpyxl.styles import Alignment, Font, PatternFill
except ModuleNotFoundError:
    print(
        "Dependência ausente. Execute:\n"
        "  py -m pip install -r scripts/requirements-relatorio-contas-pagar.txt",
        file=sys.stderr,
    )
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API_URL = "http://127.0.0.1:3000"
PAGE_SIZE = 10_000

BLUE = "17365D"
LIGHT_RED = "F4CCCC"
LIGHT_ORANGE = "FCE4D6"
WHITE = "FFFFFF"
MONEY_FORMAT = 'R$ #,##0.00;[Red]-R$ #,##0.00'
NUMBER_FORMAT = "#,##0"
DECIMAL_FORMAT = '#,##0.00;[Red]-#,##0.00'
DATE_FORMAT = "dd/mm/yyyy"


DETAIL_COLUMNS = [
    ("filial_id", "Filial"),
    ("filial_identificacao", "Identificação da filial"),
    ("cliente_id", "Código cliente"),
    ("cliente_nome", "Cliente"),
    ("cliente_cnpj_cpf", "CPF/CNPJ"),
    ("vendedor_id", "Código vendedor do título"),
    ("vendedor_nome", "Vendedor do título"),
    ("vendedor_status", "Situação do vendedor"),
    ("titulo_id", "Controle do título"),
    ("parcela_id", "Controle da parcela"),
    ("numero_documento", "Número do documento"),
    ("serie_documento", "Série"),
    ("parcela_nr", "Parcela"),
    ("tipo_documento", "Tipo documento"),
    ("tipo_documento_descricao", "Descrição tipo documento"),
    ("natureza_tipo_documento", "Natureza documento"),
    ("fidc", "FIDC?"),
    ("historico", "Histórico/referência"),
    ("data_emissao", "Data emissão"),
    ("data_vencimento", "Data vencimento"),
    ("valor_titulo", "Valor do título"),
    ("valor_parcela", "Valor da parcela"),
    ("saldo_parcela", "Saldo oficial"),
    ("unidade_saldo", "Unidade do saldo"),
    ("saldo_convertido_atual", "Saldo convertido atual"),
    ("indexador_id", "Código indexador"),
    ("indexador_descricao", "Indexador"),
    ("valor_indexador_origem", "Cotação de origem"),
    ("valor_indexador_atual", "Cotação atual"),
    ("situacao", "Situação"),
    ("dias_atraso", "Dias em atraso"),
    ("faixa_vencimento", "Faixa de vencimento"),
    ("qtd_baixas", "Quantidade de recebimentos"),
    ("valor_baixado", "Valor recebido"),
    ("valor_liquido_baixas", "Valor líquido recebido"),
    ("juros", "Juros"),
    ("multa", "Multa"),
    ("desconto", "Desconto"),
    ("acrescimo", "Acréscimo"),
    ("valor_complementar", "Valor complementar"),
    ("primeira_baixa", "Primeiro recebimento"),
    ("ultima_baixa", "Último recebimento"),
    ("saldo_local", "Saldo reproduzido local"),
    ("diferenca_saldo_local", "Diferença saldo local"),
    ("flag_assinatura_digital", "Assinatura digital"),
    ("status_parcela", "Status da parcela"),
    ("status_titulo", "Status do título"),
    ("data_calculo", "Data do saldo"),
]

VIEW_COLUMNS = [
    ("filial_id", "Filial"),
    ("cliente_id", "Código cliente"),
    ("cliente_nome", "Cliente"),
    ("titulo_id", "Controle do título"),
    ("parcela_id", "Controle da parcela"),
    ("numero_documento", "Número do documento"),
    ("parcela_nr", "Parcela"),
    ("data_emissao", "Data emissão"),
    ("data_vencimento", "Data vencimento"),
    ("valor_parcela", "Valor da parcela"),
    ("saldo_parcela", "Saldo oficial"),
    ("unidade_saldo", "Unidade do saldo"),
    ("saldo_convertido_atual", "Saldo convertido atual"),
    ("situacao", "Situação"),
    ("dias_atraso", "Dias em atraso"),
    ("faixa_vencimento", "Faixa de vencimento"),
    ("qtd_baixas", "Quantidade de recebimentos"),
    ("valor_baixado", "Valor recebido"),
    ("ultima_baixa", "Último recebimento"),
    ("vendedor_nome", "Vendedor do título"),
]

MONEY_HEADERS = {
    "Valor do título",
    "Valor da parcela",
    "Saldo convertido atual",
    "Valor recebido",
    "Valor líquido recebido",
    "Juros",
    "Multa",
    "Desconto",
    "Acréscimo",
    "Valor complementar",
    "Saldo convertido",
    "Saldo vencido convertido",
    "Saldo a vencer convertido",
    "Recebido acumulado",
    "Em aberto",
    "Diferença",
}

DECIMAL_HEADERS = {
    "Saldo oficial",
    "Saldo reproduzido local",
    "Diferença saldo local",
    "Cotação de origem",
    "Cotação atual",
    "Saldo aberto",
    "Saldo vencido",
    "Saldo a vencer",
}

DATE_HEADERS = {
    "Data emissão",
    "Data vencimento",
    "Primeiro recebimento",
    "Último recebimento",
    "Data do saldo",
    "Primeiro vencimento",
    "Último vencimento",
}

INTEGER_HEADERS = {
    "Parcela",
    "Dias em atraso",
    "Quantidade de recebimentos",
    "Quantidade de parcelas",
    "Quantidade de títulos",
    "Quantidade de clientes",
    "Maior atraso em dias",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gera relatório Excel avançado de Contas a Receber via ActionAPI."
    )
    parser.add_argument("--api-url", default=os.getenv("ACTIONAPI_URL", DEFAULT_API_URL))
    parser.add_argument("--arquivo", help="Caminho do arquivo .xlsx de saída.")
    parser.add_argument("--vencimento-de", help="Vencimento inicial, AAAA-MM-DD.")
    parser.add_argument("--vencimento-ate", help="Vencimento final, AAAA-MM-DD.")
    parser.add_argument("--emissao-de", help="Emissão inicial, AAAA-MM-DD.")
    parser.add_argument("--emissao-ate", help="Emissão final, AAAA-MM-DD.")
    parser.add_argument("--filial-id", help="Código da filial.")
    parser.add_argument("--cliente-id", help="Código do cliente.")
    parser.add_argument("--tipo-documento", help="Código do tipo de documento.")
    add_period_arguments(parser)
    add_data_base_argument(parser)
    parser.add_argument(
        "--situacao",
        choices=["VENCIDA", "VENCE_HOJE", "A_VENCER", "CREDITO_EM_ABERTO"],
    )
    parser.add_argument("--unidade-saldo", help="R$, SJ$, US$ ou ER.")
    parser.add_argument("--vendedor-id", help="Código do vendedor.")
    return parser.parse_args()


def apply_period_selection(args: argparse.Namespace) -> None:
    """Aplica filtro de vencimento/emissão somente se informado explicitamente.

    Saldo em aberto é uma posição "no momento" (mesma regra do saldo
    histórico): por padrão trazemos o snapshot completo, sem perguntar
    período. O filtro só existe para quem passa --safra/--bayer/--ano-contabil/
    --data-inicio/--data-fim ou --vencimento-de/--ate/--emissao-de/--ate
    explicitamente na linha de comando.
    """
    explicit_dates = any(
        (args.vencimento_de, args.vencimento_ate, args.emissao_de, args.emissao_ate)
    )
    if has_period_argument(args):
        if explicit_dates:
            raise SystemExit(
                "erro: use o período do menu/parâmetros gerais ou os filtros "
                "específicos de vencimento/emissão, não ambos."
            )
        try:
            args.vencimento_de, args.vencimento_ate, _slug = resolve_period(args)
        except ValueError as exc:
            raise SystemExit(f"erro: {exc}") from exc
        return

    for field in ("vencimento_de", "vencimento_ate", "emissao_de", "emissao_ate"):
        value = getattr(args, field)
        if value:
            try:
                parsed = parse_user_date(value, f"--{field.replace('_', '-')}")
            except ValueError as exc:
                raise SystemExit(f"erro: {exc}") from exc
            setattr(args, field, parsed.isoformat())


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value.startswith(("'", '"')):
            value = value[1:-1]
        values[key.strip()] = value
    return values


def first_api_key() -> str:
    env = {**read_env(ROOT / ".env"), **os.environ}
    keys = [item.strip() for item in env.get("API_KEYS", "").split(",") if item.strip()]
    if not keys:
        raise RuntimeError("API_KEYS não está configurada no .env.")
    return keys[0]


def api_get(base_url: str, api_key: str, endpoint: str, params: dict[str, Any]) -> dict:
    clean = {key: value for key, value in params.items() if value not in (None, "")}
    url = f"{base_url.rstrip('/')}{endpoint}"
    if clean:
        url += "?" + urlencode(clean)
    request = Request(url, headers={"X-API-Key": api_key, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ActionAPI respondeu HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Não foi possível acessar a ActionAPI em {url}: {exc}") from exc


NODE_SALDO_HISTORICO = ROOT / "packages" / "etl" / "src" / "scripts" / "saldo-aberto-historico.js"


def fetch_historico_cr(data_base: str) -> dict:
    """Reproduz o saldo em aberto de CR numa data-base passada/futura via PostgreSQL.

    Não usa a ActionAPI nem o Oracle: reaproveita, parametrizada, a mesma
    fórmula validada contra VALOR_ABERTO_RECEBER_DATA (zero divergências).
    Inclui também as parcelas já recebidas (saldo ≈ 0, com baixa) dos títulos
    que ainda têm saldo em aberto, para as abas Recebidas/Conciliação.
    """
    print(
        f"[relatorio-receber] reproduzindo saldo em {data_base} via PostgreSQL "
        "(sem Oracle, fórmula validada)...",
        flush=True,
    )
    result = subprocess.run(
        [
            "node",
            str(NODE_SALDO_HISTORICO),
            "--tipo",
            "CR",
            "--data-base",
            data_base,
            "--incluir-baixadas",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(NODE_SALDO_HISTORICO.parents[2]),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Falha ao calcular saldo histórico de CR: {result.stderr}")
    payload = json.loads(result.stdout)
    return payload["cr"]


def fetch_recebidas_cr(data_base: str, titulos_abertos: set[str]) -> list[dict]:
    """Parcelas já recebidas (saldo ≈ 0) dos títulos em aberto, via PostgreSQL.

    Usado no caminho "hoje", em que a API de CR só enxerga o snapshot em aberto
    (raw.duplicatas_saldo). As recebidas vêm da reprodução local (raw.duplicatas),
    limitadas aos títulos que ainda têm saldo, para a conciliação fechar.
    """
    print(
        f"[relatorio-receber] buscando parcelas recebidas em {data_base} via PostgreSQL...",
        flush=True,
    )
    payload = fetch_historico_cr(data_base)
    return [
        row
        for row in payload["rows"]
        if abs(as_number(row.get("saldo_parcela"))) <= 0.01
        and row.get("titulo_id") in titulos_abertos
    ]


def fetch_all(base_url: str, api_key: str, filters: dict[str, Any]) -> list[dict]:
    rows: list[dict] = []
    page = 1
    while True:
        payload = api_get(
            base_url,
            api_key,
            "/api/v1/financeiro/contas-receber",
            {**filters, "page": page, "pageSize": PAGE_SIZE},
        )
        current = payload.get("data", [])
        rows.extend(current)
        if not current or len(rows) >= int(payload.get("total", len(rows))):
            return rows
        page += 1


def as_number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def as_date(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def cnpj_format(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 14:
        return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return str(value or "")


def converted_value(key: str, value: Any) -> Any:
    if key in {
        "valor_titulo",
        "valor_parcela",
        "saldo_parcela",
        "saldo_convertido_atual",
        "valor_indexador_origem",
        "valor_indexador_atual",
        "valor_baixado",
        "valor_liquido_baixas",
        "juros",
        "multa",
        "desconto",
        "acrescimo",
        "valor_complementar",
        "saldo_local",
        "diferenca_saldo_local",
    }:
        return as_number(value)
    if key in {
        "data_emissao",
        "data_vencimento",
        "primeira_baixa",
        "ultima_baixa",
        "data_calculo",
    }:
        return as_date(value)
    if key in {"parcela_nr", "dias_atraso", "qtd_baixas"}:
        return as_number(value)
    if key == "cliente_cnpj_cpf":
        return cnpj_format(value)
    return value


def selected_rows(
    rows: list[dict],
    columns: list[tuple[str, str]],
) -> list[list[Any]]:
    return [
        [converted_value(key, row.get(key)) for key, _header in columns]
        for row in rows
    ]


def detail_rows(rows: list[dict]) -> list[list[Any]]:
    return selected_rows(rows, DETAIL_COLUMNS)


def view_rows(rows: list[dict]) -> list[list[Any]]:
    return selected_rows(rows, VIEW_COLUMNS)


def client_rows(rows: list[dict]) -> list[list[Any]]:
    headers = [
        "Filial",
        "Identificação da filial",
        "Código cliente",
        "Cliente",
        "CPF/CNPJ",
        "Unidade do saldo",
        "Quantidade de parcelas",
        "Quantidade de títulos",
        "Valor das parcelas",
        "Saldo aberto",
        "Saldo convertido",
        "Saldo vencido",
        "Saldo vencido convertido",
        "Saldo a vencer",
        "Primeiro vencimento",
        "Último vencimento",
        "Maior atraso em dias",
    ]
    output = []
    for row in sorted(
        rows,
        key=lambda item: as_number(item.get("saldo_convertido_atual")),
        reverse=True,
    ):
        output.append(
            [
                row.get("filial_id"),
                row.get("filial_identificacao"),
                row.get("cliente_id"),
                row.get("cliente_nome"),
                cnpj_format(row.get("cliente_cnpj_cpf")),
                row.get("unidade_saldo"),
                as_number(row.get("qtd_parcelas")),
                as_number(row.get("qtd_titulos")),
                as_number(row.get("valor_parcelas")),
                as_number(row.get("saldo_aberto")),
                as_number(row.get("saldo_convertido_atual")),
                as_number(row.get("saldo_vencido")),
                as_number(row.get("saldo_vencido_convertido")),
                as_number(row.get("saldo_a_vencer")),
                as_date(row.get("primeiro_vencimento")),
                as_date(row.get("ultimo_vencimento")),
                as_number(row.get("maior_atraso_dias")),
            ]
        )
    return [headers, *output]


def unit_rows(rows: list[dict]) -> list[list[Any]]:
    headers = [
        "Unidade do saldo",
        "Quantidade de parcelas",
        "Quantidade de títulos",
        "Quantidade de clientes",
        "Saldo aberto",
        "Saldo convertido",
        "Saldo vencido",
        "Saldo vencido convertido",
    ]
    return [
        headers,
        *[
            [
                row.get("unidade_saldo"),
                as_number(row.get("qtd_parcelas")),
                as_number(row.get("qtd_titulos")),
                as_number(row.get("qtd_clientes")),
                as_number(row.get("saldo_aberto")),
                as_number(row.get("saldo_convertido_atual")),
                as_number(row.get("saldo_vencido")),
                as_number(row.get("saldo_vencido_convertido")),
            ]
            for row in rows
        ],
    ]


def expiry_rows(rows: list[dict]) -> list[list[Any]]:
    order = [
        "CREDITO_EM_ABERTO",
        "VENCIDO_ACIMA_90_DIAS",
        "VENCIDO_31_A_90_DIAS",
        "VENCIDO_1_A_30_DIAS",
        "VENCE_HOJE",
        "VENCE_EM_1_A_7_DIAS",
        "VENCE_EM_8_A_30_DIAS",
        "VENCE_EM_31_A_60_DIAS",
        "VENCE_EM_61_A_90_DIAS",
        "VENCE_ACIMA_90_DIAS",
    ]
    grouped: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {"parcelas": 0, "titulos": set(), "saldo": 0.0, "convertido": 0.0}
    )
    for row in rows:
        key = (
            row.get("faixa_vencimento") or "SEM_CLASSIFICACAO",
            row.get("unidade_saldo") or "R$",
        )
        group = grouped[key]
        group["parcelas"] += 1
        group["titulos"].add(row.get("titulo_id"))
        group["saldo"] += as_number(row.get("saldo_parcela"))
        group["convertido"] += as_number(row.get("saldo_convertido_atual"))

    output = [[
        "Faixa de vencimento",
        "Unidade do saldo",
        "Quantidade de parcelas",
        "Quantidade de títulos",
        "Saldo aberto",
        "Saldo convertido",
    ]]
    for key in sorted(
        grouped,
        key=lambda item: (order.index(item[0]) if item[0] in order else 99, item[1]),
    ):
        group = grouped[key]
        output.append([
            key[0],
            key[1],
            group["parcelas"],
            len(group["titulos"]),
            group["saldo"],
            group["convertido"],
        ])
    return output


def split_aberto_recebidas(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Separa parcelas em aberto (saldo ≠ 0) das já recebidas (saldo ≈ 0)."""
    abertas: list[dict] = []
    recebidas: list[dict] = []
    for row in rows:
        if abs(as_number(row.get("saldo_parcela"))) > 0.01:
            abertas.append(row)
        else:
            recebidas.append(row)
    return abertas, recebidas


def valor_assinado(row: dict) -> float:
    """Valor da parcela com o mesmo sinal do saldo (crédito = negativo)."""
    valor = as_number(row.get("valor_parcela"))
    return -valor if row.get("natureza_tipo_documento") == "C" else valor


def conciliacao_rows(rows: list[dict]) -> list[list[Any]]:
    """Uma linha por título: Valor das parcelas, Recebido acumulado e Em aberto.

    A coluna "Diferença" (= Valor − Recebido − Em aberto) fica ~0 para títulos em
    R$. Contratos indexados (SJ$, US$, ER) podem gerar diferença, pois o saldo é
    mantido na unidade e o recebido em reais — é esperado e está na Metodologia.
    """
    headers = [
        "Filial",
        "Código cliente",
        "Cliente",
        "CPF/CNPJ",
        "Controle do título",
        "Unidade do saldo",
        "Quantidade de parcelas",
        "Valor das parcelas",
        "Recebido acumulado",
        "Em aberto",
        "Diferença",
        "Situação",
    ]
    grupos: dict[Any, dict[str, Any]] = {}
    for row in rows:
        chave = (row.get("filial_id"), row.get("cliente_id"), row.get("titulo_id"))
        grupo = grupos.get(chave)
        if grupo is None:
            grupo = {
                "filial_id": row.get("filial_id"),
                "cliente_id": row.get("cliente_id"),
                "cliente_nome": row.get("cliente_nome"),
                "cliente_cnpj_cpf": row.get("cliente_cnpj_cpf"),
                "titulo_id": row.get("titulo_id"),
                "unidade_saldo": row.get("unidade_saldo") or "R$",
                "qtd": 0,
                "valor": 0.0,
                "recebido": 0.0,
                "aberto": 0.0,
            }
            grupos[chave] = grupo
        grupo["qtd"] += 1
        grupo["valor"] += valor_assinado(row)
        grupo["recebido"] += as_number(row.get("valor_baixado"))
        grupo["aberto"] += as_number(row.get("saldo_parcela"))

    output: list[list[Any]] = []
    for grupo in sorted(grupos.values(), key=lambda item: item["aberto"], reverse=True):
        aberto = grupo["aberto"]
        recebido = grupo["recebido"]
        if abs(aberto) <= 0.01:
            situacao = "RECEBIDO"
        elif recebido > 0.01:
            situacao = "PARCIAL"
        else:
            situacao = "ABERTO"
        output.append(
            [
                grupo["filial_id"],
                grupo["cliente_id"],
                grupo["cliente_nome"],
                cnpj_format(grupo["cliente_cnpj_cpf"]),
                grupo["titulo_id"],
                grupo["unidade_saldo"],
                grupo["qtd"],
                grupo["valor"],
                recebido,
                aberto,
                grupo["valor"] - recebido - aberto,
                situacao,
            ]
        )
    return [headers, *output]


def style_sheet(ws, freeze: str = "A2") -> None:
    if ws.max_row < 1 or ws.max_column < 1:
        return
    for cell in ws[1]:
        cell.fill = PatternFill("solid", fgColor=BLUE)
        cell.font = Font(color=WHITE, bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.freeze_panes = freeze
    if ws.max_row >= 2:
        # AutoFiltro simples é mais compatível entre versões do Excel que
        # tabelas OOXML combinadas com formatação condicional.
        ws.auto_filter.ref = ws.dimensions

    # Atribuir estilo individualmente a centenas de milhares de células torna
    # o openpyxl muito lento. Nas abas menores mantemos a formatação completa;
    # na base detalhada, os valores permanecem numéricos e as datas continuam
    # sendo gravadas como datas reais, prontas para filtros e tabelas dinâmicas.
    if ws.max_row <= 1000:
        headers = {cell.value: cell.column for cell in ws[1]}
        for header, column in headers.items():
            letter = ws.cell(1, column).column_letter
            if header in MONEY_HEADERS or header == "Valor das parcelas":
                for cell in ws[letter][1:]:
                    cell.number_format = MONEY_FORMAT
            elif header in DECIMAL_HEADERS:
                for cell in ws[letter][1:]:
                    cell.number_format = DECIMAL_FORMAT
            elif header in DATE_HEADERS:
                for cell in ws[letter][1:]:
                    cell.number_format = DATE_FORMAT
            elif header in INTEGER_HEADERS:
                for cell in ws[letter][1:]:
                    cell.number_format = NUMBER_FORMAT

    # Medir uma amostra mantém a largura útil sem percorrer centenas de
    # milhares de células repetidas nas abas de visão.
    sample_last_row = min(ws.max_row, 250)
    for column_cells in ws.iter_cols(min_row=1, max_row=sample_last_row):
        width = max(
            10,
            min(48, max(len(str(cell.value or "")) for cell in column_cells) + 2),
        )
        ws.column_dimensions[column_cells[0].column_letter].width = width


def add_data_sheet(wb: Workbook, name: str, headers: list[str], rows: list[list[Any]]) -> None:
    print(f"[relatorio-receber] montando aba {name} ({len(rows)} linhas)...", flush=True)
    ws = wb.create_sheet(name)
    ws.append(headers)
    for row in rows:
        ws.append(row)
    style_sheet(ws)

    header_map = {cell.value: cell.column_letter for cell in ws[1]}
    situation_col = header_map.get("Situação")
    difference_col = header_map.get("Diferença saldo local")
    if situation_col and ws.max_row > 1:
        ws.conditional_formatting.add(
            f"{situation_col}2:{situation_col}{ws.max_row}",
            FormulaRule(
                formula=[f'ISNUMBER(SEARCH("VENCIDA",{situation_col}2))'],
                fill=PatternFill("solid", fgColor=LIGHT_RED),
            ),
        )
        ws.conditional_formatting.add(
            f"{situation_col}2:{situation_col}{ws.max_row}",
            FormulaRule(
                formula=[f'ISNUMBER(SEARCH("CREDITO",{situation_col}2))'],
                fill=PatternFill("solid", fgColor=LIGHT_ORANGE),
            ),
        )
    if difference_col and ws.max_row > 1:
        ws.conditional_formatting.add(
            f"{difference_col}2:{difference_col}{ws.max_row}",
            FormulaRule(
                formula=[f"ABS({difference_col}2)>0.01"],
                fill=PatternFill("solid", fgColor=LIGHT_RED),
            ),
        )


def create_dashboard(
    wb: Workbook,
    totals: dict[str, Any],
    clients: list[dict],
    units: list[dict],
    rows: list[dict],
    filters: dict[str, Any],
    recebidas: list[dict] | None = None,
) -> None:
    recebidas = recebidas or []
    ws = wb.active
    ws.title = "Painel"
    ws.merge_cells("A1:D1")
    ws["A1"] = "RELATÓRIO AVANÇADO DE CONTAS A RECEBER"
    ws["A1"].font = Font(size=18, bold=True, color=WHITE)
    ws["A1"].fill = PatternFill("solid", fgColor=BLUE)
    ws["A1"].alignment = Alignment(horizontal="center")

    ws["A3"] = "Gerado em"
    ws["B3"] = datetime.now()
    ws["B3"].number_format = "dd/mm/yyyy hh:mm"
    ws["A4"] = "Data-base do saldo"
    ws["B4"] = as_date(totals.get("data_calculo"))
    ws["B4"].number_format = DATE_FORMAT
    ws["A5"] = "Fonte"
    ws["B5"] = "ActionAPI — /api/v1/financeiro/contas-receber"
    ws["A6"] = "Filtros"
    ws["B6"] = ", ".join(
        f"{key}={value}" for key, value in filters.items() if value not in (None, "")
    ) or "Posição atual completa"

    indicators = [
        ("Saldo convertido atual", totals.get("saldo_convertido_atual"), True),
        ("Saldo vencido convertido", totals.get("saldo_vencido_convertido"), True),
        ("Próximos 7 dias — convertido", totals.get("saldo_proximos_7_dias_convertido"), True),
        ("Próximos 30 dias — convertido", totals.get("saldo_proximos_30_dias_convertido"), True),
        ("Quantidade de clientes", totals.get("qtd_clientes"), False),
        ("Quantidade de títulos", totals.get("qtd_titulos"), False),
        ("Quantidade de parcelas", totals.get("qtd_parcelas"), False),
        ("Parcelas vencidas", totals.get("qtd_parcelas_vencidas"), False),
        ("Parcelas indexadas", totals.get("qtd_parcelas_indexadas"), False),
        ("Parcelas ligadas a FIDC", totals.get("qtd_parcelas_fidc"), False),
        ("Saldo ligado a FIDC — convertido", totals.get("saldo_fidc_convertido"), True),
    ]
    ws["A8"] = "INDICADORES"
    ws["B8"] = "VALOR"
    for cell in ws[8]:
        cell.fill = PatternFill("solid", fgColor=BLUE)
        cell.font = Font(color=WHITE, bold=True)
    for row_number, (label, value, monetary) in enumerate(indicators, 9):
        ws.cell(row_number, 1, label)
        ws.cell(row_number, 2, as_number(value))
        ws.cell(row_number, 2).number_format = MONEY_FORMAT if monetary else NUMBER_FORMAT

    top = sorted(
        clients,
        key=lambda item: as_number(item.get("saldo_convertido_atual")),
        reverse=True,
    )[:10]
    start = 20
    ws.cell(start, 1, "10 MAIORES CLIENTES")
    ws.cell(start, 2, "Saldo convertido")
    ws.cell(start, 3, "% do total")
    for cell in ws[start]:
        cell.fill = PatternFill("solid", fgColor=BLUE)
        cell.font = Font(color=WHITE, bold=True)
    total_balance = as_number(totals.get("saldo_convertido_atual"))
    for offset, client in enumerate(top, 1):
        row_number = start + offset
        ws.cell(
            row_number,
            1,
            f"{client.get('cliente_nome')} — filial {client.get('filial_id')}",
        )
        balance = as_number(client.get("saldo_convertido_atual"))
        ws.cell(row_number, 2, balance).number_format = MONEY_FORMAT
        ws.cell(row_number, 3, balance / total_balance if total_balance else 0).number_format = "0.00%"

    chart = BarChart()
    chart.title = "Concentração por cliente"
    chart.y_axis.title = "Cliente"
    chart.x_axis.title = "Saldo convertido"
    chart.add_data(
        Reference(ws, min_col=2, min_row=start, max_row=start + len(top)),
        titles_from_data=True,
    )
    chart.set_categories(
        Reference(ws, min_col=1, min_row=start + 1, max_row=start + len(top))
    )
    chart.height = 8
    chart.width = 15
    ws.add_chart(chart, "E8")

    ws["E25"] = "Unidade"
    ws["F25"] = "Parcelas"
    for offset, unit in enumerate(units, 1):
        ws.cell(25 + offset, 5, unit.get("unidade_saldo"))
        ws.cell(25 + offset, 6, as_number(unit.get("qtd_parcelas")))
    if units:
        pie = PieChart()
        pie.title = "Parcelas por unidade"
        pie.add_data(
            Reference(ws, min_col=6, min_row=25, max_row=25 + len(units)),
            titles_from_data=True,
        )
        pie.set_categories(
            Reference(ws, min_col=5, min_row=26, max_row=25 + len(units))
        )
        pie.height = 7
        pie.width = 9
        ws.add_chart(pie, "E28")

    combinado = list(rows) + list(recebidas)
    valor_parcelas = sum(valor_assinado(r) for r in combinado)
    recebido_acumulado = sum(as_number(r.get("valor_baixado")) for r in combinado)
    base = 35
    ws.cell(base, 1, "CONCILIAÇÃO A RECEBER × RECEBIDAS")
    ws.cell(base, 2, "VALOR")
    for cell in ws[base]:
        cell.fill = PatternFill("solid", fgColor=BLUE)
        cell.font = Font(color=WHITE, bold=True)
    reconciliacao = [
        ("Valor das parcelas (documento)", valor_parcelas, True),
        ("Recebido acumulado", recebido_acumulado, True),
        ("Saldo em aberto convertido", as_number(totals.get("saldo_convertido_atual")), True),
        ("Parcelas em aberto", len(rows), False),
        ("Parcelas recebidas (de títulos abertos)", len(recebidas), False),
    ]
    for offset, (label, value, monetary) in enumerate(reconciliacao, 1):
        ws.cell(base + offset, 1, label)
        ws.cell(base + offset, 2, as_number(value))
        ws.cell(base + offset, 2).number_format = MONEY_FORMAT if monetary else NUMBER_FORMAT

    # Comparativo por filial (em aberto, convertido para R$), para evitar
    # filtrar e somar à mão.
    filiais: dict[Any, dict[str, Any]] = {}
    for row in rows:
        fid = row.get("filial_id")
        item = filiais.get(fid)
        if item is None:
            item = {
                "filial_id": fid,
                "nome": row.get("filial_nome") or row.get("filial_identificacao") or "",
                "saldo": 0.0,
                "vencido": 0.0,
                "qtd": 0,
            }
            filiais[fid] = item
        conv = as_number(row.get("saldo_convertido_atual"))
        item["saldo"] += conv
        item["qtd"] += 1
        if row.get("situacao") == "VENCIDA":
            item["vencido"] += conv

    fbase = base + len(reconciliacao) + 2
    ws.cell(fbase, 1, "POR FILIAL (EM ABERTO — CONVERTIDO R$)")
    ws.cell(fbase, 2, "Saldo convertido")
    ws.cell(fbase, 3, "Saldo vencido convertido")
    ws.cell(fbase, 4, "% do total")
    for cell in ws[fbase]:
        cell.fill = PatternFill("solid", fgColor=BLUE)
        cell.font = Font(color=WHITE, bold=True)
    total_conv = as_number(totals.get("saldo_convertido_atual"))
    for offset, item in enumerate(
        sorted(filiais.values(), key=lambda x: x["saldo"], reverse=True), 1
    ):
        linha = fbase + offset
        nome = item["nome"] or item["filial_id"]
        ws.cell(linha, 1, f"{item['filial_id']} — {nome} ({item['qtd']} parc.)")
        ws.cell(linha, 2, item["saldo"]).number_format = MONEY_FORMAT
        ws.cell(linha, 3, item["vencido"]).number_format = MONEY_FORMAT
        ws.cell(
            linha, 4, item["saldo"] / total_conv if total_conv else 0
        ).number_format = "0.00%"

    ws["A33"] = "Observação"
    ws["B33"] = (
        "Saldo oficial preserva a unidade do título. Para contratos SJ$, US$ ou ER, "
        "o painel usa a conversão atual estimada apenas para consolidação em reais."
    )
    ws["B33"].alignment = Alignment(wrap_text=True)
    ws.column_dimensions["A"].width = 48
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 4


def create_methodology(wb: Workbook) -> None:
    ws = wb.create_sheet("Metodologia")
    content = [
        ("RELATÓRIO DE CONTAS A RECEBER — METODOLOGIA", ""),
        ("Granularidade", "Uma linha por parcela em aberto de RECEBER."),
        ("Saldo oficial", "Snapshot de VALOR_ABERTO_RECEBER_DATA, função oficial do Oracle/SiAGRI."),
        ("Fonte do título", "CABREC ligado às parcelas de RECEBER."),
        ("Cliente", "CODI_TRA enriquecido pelo cadastro de transacionadores/clientes."),
        ("Filial", "Razão social do transacionador ligado a CADEMP.COD1_TRA; fantasia e identificação ficam separadas."),
        ("Recebimentos", "CRCBAIXA com SITU_BAI='N' e data de pagamento até a data atual."),
        ("Estornos", "CRCBAIXA com SITU_BAI='E' não reduz o saldo."),
        ("Contratos indexados", "O saldo oficial permanece em SJ$, US$ ou ER; não é automaticamente um valor em reais."),
        ("Conversão atual", "Estimativa adicional: saldo em unidades multiplicado pela cotação mais recente replicada."),
        ("Saldo local", "Reprodução PostgreSQL da função oficial, incluindo indexador, data de cada baixa, agrupamentos e tolerância."),
        ("Abas A receber × Recebidas", "Aba 'Em Aberto' = parcelas com saldo (= relatório do controller). Aba 'Recebidas' = parcelas já quitadas (saldo ≈ 0) com baixa até a data-base, restritas aos títulos que ainda têm saldo em aberto. Aba 'Conciliação' resume por título: Valor das parcelas (assinado), Recebido acumulado e Em aberto."),
        ("Coluna Diferença (Conciliação)", "Diferença = Valor das parcelas − Recebido − Em aberto. Fica ~0 para títulos em R$; contratos indexados (SJ$, US$, ER) podem gerar diferença esperada, pois o saldo é mantido na unidade e o recebido em reais."),
        ("Sinal do saldo", "Documentos de natureza crédito (ex.: adiantamento de cliente) entram negativos e abatem o que há a receber, igual ao controller."),
        ("Validação", "Em 20/06/2026, 156.487 parcelas comparadas com a função Oracle: zero divergências. Conferido contra o relatório do controller (CRC) de 21/06/2026: Valor em Aberto R$ 156.885.616,21 (R$) + 40.733,86 SJ$ vs reprodução local R$ 157.052.025,10 (R$) + 40.733,86 SJ$ — diferença de ~0,1% no R$ (defasagem de lançamentos FIDC, documentada)."),
        ("Snapshot validado", "3.879 parcelas abertas; saldo oficial agregado de 157.092.758,96 nas unidades originais (159.448.804,32 convertido para R$)."),
        ("Compatibilidade Excel", "As abas usam AutoFiltro simples, sem tabelas OOXML sobrepostas."),
    ]
    for row in content:
        ws.append(row)
    ws.merge_cells("A1:B1")
    ws["A1"].fill = PatternFill("solid", fgColor=BLUE)
    ws["A1"].font = Font(color=WHITE, bold=True, size=14)
    ws["A1"].alignment = Alignment(horizontal="center")
    ws.column_dimensions["A"].width = 42
    ws.column_dimensions["B"].width = 115
    for row in ws.iter_rows(min_row=2):
        row[0].font = Font(bold=True)
        row[1].alignment = Alignment(wrap_text=True, vertical="top")


def validate_workbook(
    path: Path,
    expected_rows: int,
    expected_converted_balance: float,
) -> None:
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb["Em Aberto"]
    row_count = ws.max_row - 1
    headers = {cell.value: cell.column for cell in next(ws.iter_rows(min_row=1, max_row=1))}
    balance_column = headers["Saldo convertido atual"]
    balance = sum(
        as_number(row[balance_column - 1].value)
        for row in ws.iter_rows(min_row=2)
    )
    error_cells = sum(
        1
        for sheet in wb.worksheets
        for row in sheet.iter_rows()
        for cell in row
        if cell.data_type == "e"
    )
    wb.close()
    if (
        row_count != expected_rows
        or abs(balance - expected_converted_balance) > 0.01
        or error_cells
    ):
        raise RuntimeError(
            f"Validação do XLSX falhou: linhas {row_count}/{expected_rows}, "
            f"saldo convertido {balance:.2f}/{expected_converted_balance:.2f}, "
            f"células com erro {error_cells}"
        )


def generate_report(args: argparse.Namespace) -> Path:
    data_base = resolve_data_base(args) if getattr(args, "data_base", None) else None
    historico = bool(data_base) and data_base != date.today().isoformat()

    output = (
        Path(args.arquivo).resolve()
        if args.arquivo
        else ROOT / "relatorios" / f"contas-a-receber-python-{date.today().isoformat()}.xlsx"
    )

    if historico:
        filters = {"dataBase": data_base}
        payload = fetch_historico_cr(data_base)
        rows = payload["rows"]
        clients = payload["data"]
        units = payload["unidades"]
        totals = payload["totalizadores"]
        abertas, recebidas = split_aberto_recebidas(rows)
        print(
            f"[relatorio-receber] {len(abertas)} parcelas em aberto + {len(recebidas)} "
            f"recebidas (reprodução local em {data_base}, sem Oracle).",
            flush=True,
        )
    else:
        api_key = first_api_key()
        filters = {
            "vencimentoDe": args.vencimento_de,
            "vencimentoAte": args.vencimento_ate,
            "emissaoDe": args.emissao_de,
            "emissaoAte": args.emissao_ate,
            "filialId": args.filial_id,
            "clienteId": args.cliente_id,
            "tipoDocumento": args.tipo_documento,
            "situacao": args.situacao,
            "unidadeSaldo": args.unidade_saldo,
            "vendedorId": args.vendedor_id,
        }
        print(f"[relatorio-receber] consultando {args.api_url}...", flush=True)
        abertas = fetch_all(args.api_url, api_key, filters)
        summary = api_get(
            args.api_url,
            api_key,
            "/api/v1/financeiro/contas-receber/resumo",
            filters,
        )
        clients = summary.get("data", [])
        units = summary.get("unidades", [])
        totals = summary.get("totalizadores", {})
        print(f"[relatorio-receber] API retornou {len(abertas)} parcelas em aberto.", flush=True)
        # A API de CR só enxerga o snapshot em aberto (raw.duplicatas_saldo); as
        # parcelas recebidas vêm da reprodução local, limitadas aos títulos abertos.
        titulos_abertos = {row.get("titulo_id") for row in abertas}
        recebidas = fetch_recebidas_cr(date.today().isoformat(), titulos_abertos)
        print(f"[relatorio-receber] {len(recebidas)} parcelas recebidas anexadas.", flush=True)

    wb = Workbook()
    create_dashboard(wb, totals, clients, units, abertas, filters, recebidas=recebidas)
    headers = [header for _key, header in DETAIL_COLUMNS]
    add_data_sheet(wb, "Em Aberto", headers, detail_rows(abertas))
    add_data_sheet(wb, "Recebidas", headers, detail_rows(recebidas))
    conc = conciliacao_rows(abertas + recebidas)
    add_data_sheet(wb, "Conciliação", conc[0], conc[1:])

    clients_data = client_rows(clients)
    add_data_sheet(wb, "Por Cliente", clients_data[0], clients_data[1:])
    units_data = unit_rows(units)
    add_data_sheet(wb, "Por Unidade", units_data[0], units_data[1:])
    expiry_data = expiry_rows(abertas)
    add_data_sheet(wb, "Faixas Vencimento", expiry_data[0], expiry_data[1:])
    add_data_sheet(
        wb,
        "Indexados",
        headers,
        detail_rows([row for row in abertas if row.get("unidade_saldo") != "R$"]),
    )
    add_data_sheet(
        wb,
        "Divergencias Saldo",
        headers,
        detail_rows(
            [
                row
                for row in abertas
                if abs(as_number(row.get("diferenca_saldo_local"))) > 0.01
            ]
        ),
    )
    add_data_sheet(
        wb,
        "FIDC",
        headers,
        detail_rows([row for row in abertas if row.get("fidc")]),
    )
    create_methodology(wb)

    output.parent.mkdir(parents=True, exist_ok=True)
    print("[relatorio-receber] gravando arquivo XLSX...", flush=True)
    wb.save(output)
    print("[relatorio-receber] validando arquivo XLSX...", flush=True)
    expected_balance = as_number(totals.get("saldo_convertido_atual"))
    validate_workbook(output, len(abertas), expected_balance)
    print(
        f"[relatorio-receber] {len(abertas)} em aberto / {len(recebidas)} recebidas exportadas"
    )
    print(f"[relatorio-receber] saldo convertido validado: R$ {expected_balance:,.2f}")
    print(f"[relatorio-receber] arquivo: {output}")
    return output


def main() -> None:
    args = parse_args()
    prompt_data_base_if_needed(args)
    data_base = resolve_data_base(args) if getattr(args, "data_base", None) else None
    if not data_base or data_base == date.today().isoformat():
        apply_period_selection(args)
    generate_report(args)


if __name__ == "__main__":
    main()
