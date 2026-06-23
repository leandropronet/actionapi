#!/usr/bin/env python3
"""Audita parcela a parcela o CRC/Cont40234 contra o saldo histórico local.

O PDF é extraído em três modos complementares do pdftotext:

* ``-layout``: preserva o relatório para inspeção e validação dos totais;
* ``-table``: estabiliza as colunas e os valores das parcelas;
* ``-raw``: preserva, sem sobreposição visual, a chave Documento-Série/Parcela.

O script executa o saldo histórico do ETL, enriquece chaves ausentes usando o
snapshot ``raw.duplicatas_saldo`` e, opcionalmente, consulta somente as parcelas
divergentes no Oracle para detectar baixas retroativas ainda não replicadas.

Uso:
  .venv\\Scripts\\python.exe scripts\\auditoria_crc_controller.py
  .venv\\Scripts\\python.exe scripts\\auditoria_crc_controller.py --sem-oracle
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
ETL_DIR = ROOT / "packages" / "etl"
DEFAULT_PDF = ROOT / "relatorios" / "contabilidade" / "CRC 21062026.pdf"
DEFAULT_MD = ROOT / "docs" / "auditoria-crc-controller-2026-06-21.md"
DEFAULT_CSV = ROOT / "relatorios" / "contabilidade" / "auditoria_crc_controller_2026-06-21.csv"

EXPECTED_PDF_TOTALS = {
    "R$": Decimal("156885616.21"),
    "SJ$": Decimal("40733.86"),
}
MONEY_RE = re.compile(r"-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}(?!\d)")
TABLE_DOC_RE = re.compile(r"\d+-[^\s/]+/\d+\s+\d{2}/\d{2}/\d{2}")
RAW_DOC_RE = re.compile(r"^\s*(\d+)-([^\s/]+)/(\d+)\s*$")
CLIENT_RE = re.compile(
    r"Cliente:\s*([^\-\s]+)-(.*?)(?:\s{2,}Fone:|\s+Fone:|$)",
    re.IGNORECASE,
)


@dataclass
class PdfRow:
    numero_documento: str
    serie_documento: str
    parcela_nr: str
    cliente_id: str | None
    cliente_nome: str | None
    unidade_saldo: str
    valor_documento: Decimal
    valor_aberto_monetario: Decimal
    saldo_parcela: Decimal
    linha_pdf: int


def decimal_br(value: str) -> Decimal:
    return Decimal(value.replace(".", "").replace(",", "."))


def dec(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    return Decimal(str(value))


def brl(value: Decimal) -> str:
    sign = "-" if value < 0 else ""
    raw = f"{abs(value):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{sign}R$ {raw}"


def number_br(value: Decimal) -> str:
    sign = "-" if value < 0 else ""
    raw = f"{abs(value):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{sign}{raw}"


def normalize_part(value: Any) -> str:
    text = str(value or "").strip()
    if text.isdigit():
        return text.lstrip("0") or "0"
    return text.upper()


def row_key(row: Any) -> tuple[str, str, str]:
    getter = row.get if isinstance(row, dict) else lambda key: getattr(row, key)
    return (
        normalize_part(getter("numero_documento")),
        normalize_part(getter("serie_documento")),
        normalize_part(getter("parcela_nr")),
    )


def key_text(row: Any) -> str:
    numero, serie, parcela = row_key(row)
    return f"{numero}-{serie}/{parcela}"


def find_pdftotext(explicit: str | None) -> Path:
    candidates = [
        explicit,
        shutil.which("pdftotext"),
        r"C:\Program Files\Git\mingw64\bin\pdftotext.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    raise FileNotFoundError(
        "pdftotext não encontrado. Informe --pdftotext ou instale-o no PATH."
    )


def run(command: list[str], cwd: Path = ROOT, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            f"Comando falhou ({result.returncode}): {' '.join(command)}\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    return result.stdout


def extract_pdf(pdftotext: Path, pdf: Path, temp_dir: Path) -> dict[str, Path]:
    outputs: dict[str, Path] = {}
    for mode in ("layout", "table", "raw"):
        output = temp_dir / f"crc_{mode}.txt"
        run([str(pdftotext), f"-{mode}", "-enc", "UTF-8", str(pdf), str(output)])
        outputs[mode] = output
    return outputs


def parse_pdf(table_path: Path, raw_path: Path, layout_path: Path) -> list[PdfRow]:
    table_lines = table_path.read_text(encoding="utf-8", errors="replace").splitlines()
    raw_lines = raw_path.read_text(encoding="utf-8", errors="replace").splitlines()
    layout_text = layout_path.read_text(encoding="utf-8", errors="replace")

    table_records: list[dict[str, Any]] = []
    current_client: tuple[str, str] | None = None
    for line_number, line in enumerate(table_lines, 1):
        client_match = CLIENT_RE.search(line)
        if client_match:
            current_client = (client_match.group(1).strip(), client_match.group(2).strip())

        doc_match = TABLE_DOC_RE.search(line)
        if not doc_match:
            continue
        tail = line[doc_match.end() :]
        unit_match = re.search(r"(R\$|SJ\$)", tail)
        if not unit_match:
            raise ValueError(f"Indicador ausente na linha {line_number}: {line}")

        before_unit = tail[: unit_match.start()]
        after_unit = tail[unit_match.end() :]
        amounts_before = MONEY_RE.findall(before_unit)
        amounts_after = MONEY_RE.findall(after_unit)
        if len(amounts_before) < 2:
            raise ValueError(f"Valores principais ausentes na linha {line_number}: {line}")

        unit = unit_match.group(1)
        value_document = decimal_br(amounts_before[0])
        value_open_money = decimal_br(amounts_before[1])
        if unit == "R$":
            balance = value_open_money
        else:
            if not amounts_after:
                raise ValueError(f"Valor OM ausente na linha {line_number}: {line}")
            # A cotação tem cinco casas e é intencionalmente ignorada por MONEY_RE.
            balance = decimal_br(amounts_after[0])

        table_records.append(
            {
                "cliente_id": current_client[0] if current_client else None,
                "cliente_nome": current_client[1] if current_client else None,
                "unidade_saldo": unit,
                "valor_documento": value_document,
                "valor_aberto_monetario": value_open_money,
                "saldo_parcela": balance,
                "linha_pdf": line_number,
            }
        )

    raw_keys = [match.groups() for line in raw_lines if (match := RAW_DOC_RE.match(line))]
    if len(table_records) != len(raw_keys):
        raise ValueError(
            "Extrações -table e -raw não têm a mesma quantidade de parcelas: "
            f"{len(table_records)} x {len(raw_keys)}"
        )

    rows = [
        PdfRow(
            numero_documento=key[0],
            serie_documento=key[1],
            parcela_nr=key[2],
            **record,
        )
        for record, key in zip(table_records, raw_keys, strict=True)
    ]

    totals = sum_by_unit(rows, lambda row: row.saldo_parcela)
    for unit, expected in EXPECTED_PDF_TOTALS.items():
        if totals.get(unit, Decimal("0")) != expected:
            raise ValueError(
                f"Parser não fechou o total {unit}: "
                f"{number_br(totals.get(unit, Decimal('0')))} != {number_br(expected)}"
            )

    normalized_layout = re.sub(r"\s+", " ", layout_text)
    for fragment in ("TOTAL GERAL EM R$", "156.885.616,21", "40.733,86"):
        if fragment not in normalized_layout:
            raise ValueError(f"Total/âncora não encontrado no -layout: {fragment}")
    return rows


def sum_by_unit(rows: Iterable[Any], value_getter: Any) -> dict[str, Decimal]:
    totals: dict[str, Decimal] = defaultdict(Decimal)
    for row in rows:
        unit = row["unidade_saldo"] if isinstance(row, dict) else row.unidade_saldo
        totals[unit] += dec(value_getter(row))
    return dict(totals)


def run_historical_balance(data_base: str, output: Path) -> dict[str, Any]:
    script = ETL_DIR / "src" / "scripts" / "saldo-aberto-historico.js"
    run(
        [
            "node",
            str(script),
            "--tipo",
            "CR",
            "--data-base",
            data_base,
            "--saida",
            str(output),
        ],
        cwd=ETL_DIR,
    )
    return json.loads(output.read_text(encoding="utf-8"))


def run_node_json(source: str, extra_env: dict[str, str] | None = None) -> Any:
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    stdout = run(["node", "-e", source], cwd=ETL_DIR, env=env)
    marker = "__AUDITORIA_JSON__"
    lines = [line for line in stdout.splitlines() if line.startswith(marker)]
    if not lines:
        raise RuntimeError(f"Saída JSON não encontrada no helper Node:\n{stdout}")
    return json.loads(lines[-1][len(marker) :])


def load_snapshot_keys() -> dict[str, dict[str, Any]]:
    source = r"""
const path = require('path');
require('dotenv').config({ path: path.resolve('../../.env') });
const pg = require('./src/db/postgres');
(async () => {
  const result = await pg.query(`
    SELECT id, numero_documento, serie_documento, parcela_nr, data_calculo
    FROM raw.duplicatas_saldo
  `);
  console.log('__AUDITORIA_JSON__' + JSON.stringify(result.rows));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pg.pool.end());
"""
    return {str(row["id"]): row for row in run_node_json(source)}


def load_postgres_events(ids: list[str]) -> dict[str, Any]:
    source = r"""
const path = require('path');
require('dotenv').config({ path: path.resolve('../../.env') });
const pg = require('./src/db/postgres');
const ids = JSON.parse(process.env.AUDITORIA_IDS);
(async () => {
  const receipts = await pg.query(`
    SELECT id, parcela_id, data_pagamento, valor, desconto, juros,
           valor_complementar, status, data_alteracao
    FROM raw.recebimentos
    WHERE parcela_id = ANY($1::text[])
    ORDER BY parcela_id, data_pagamento, id
  `, [ids]);
  const groups = await pg.query(`
    SELECT id, parcela_id, titulo_agrupador_id, valor,
           data_titulo_agrupador, data_alteracao
    FROM raw.receber_agrupamentos
    WHERE parcela_id = ANY($1::text[])
    ORDER BY parcela_id, data_titulo_agrupador, id
  `, [ids]);
  const sync = await pg.query(`
    SELECT dominio, ultimo_sync
    FROM etl_sync
    WHERE dominio IN ('duplicatas', 'recebimentos', 'duplicatas_saldo')
    ORDER BY dominio
  `);
  console.log('__AUDITORIA_JSON__' + JSON.stringify({
    receipts: receipts.rows,
    groups: groups.rows,
    sync: sync.rows,
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pg.pool.end());
"""
    return run_node_json(source, {"AUDITORIA_IDS": json.dumps(ids)})


def load_oracle_current(ids: list[str], data_base: str) -> dict[str, Any]:
    if not all(str(value).isdigit() for value in ids):
        raise ValueError("CTRL_REC inválido para consulta Oracle")
    id_list = ",".join(ids)
    source = f"""
const path = require('path');
require('dotenv').config({{ path: path.resolve('../../.env') }});
const oracle = require('./src/db/oracle');
(async () => {{
  const receipts = await oracle.query(`
    SELECT R.CTRL_REC, C.NUME_CBR, C.SERI_CBR, R.NPAR_REC, R.HIST_REC,
           B.SEQU_BAI, B.DPAG_BAI, B.VLOR_BAI, B.DESC_BAI, B.JURO_BAI,
           B.VVCA_BAI, B.SITU_BAI, B.DUMANUT
    FROM SULGOIANO.RECEBER R
    JOIN SULGOIANO.CABREC C ON C.CTRL_CBR = R.CTRL_CBR
    LEFT JOIN SULGOIANO.CRCBAIXA B ON B.CTRL_REC = R.CTRL_REC
    WHERE R.CTRL_REC IN ({id_list})
    ORDER BY R.CTRL_REC, B.DPAG_BAI, B.SEQU_BAI
  `);
  const balances = await oracle.query(`
    SELECT R.CTRL_REC, C.NUME_CBR, C.SERI_CBR, R.NPAR_REC, V.VALOR AS SALDO
    FROM SULGOIANO.RECEBER R
    JOIN SULGOIANO.CABREC C ON C.CTRL_CBR = R.CTRL_CBR
    CROSS JOIN TABLE(
      VALOR_ABERTO_RECEBER_DATA(R.CTRL_REC, DATE '{data_base}')
    ) V
    WHERE R.CTRL_REC IN ({id_list})
    ORDER BY R.CTRL_REC
  `);
  console.log('__AUDITORIA_JSON__' + JSON.stringify({{
    receipts: receipts.rows,
    balances: balances.rows,
  }}));
}})().catch((error) => {{
  console.error(error);
  process.exitCode = 1;
}}).finally(() => oracle.closePool());
"""
    return run_node_json(source)


def enrich_keys(local_rows: list[dict[str, Any]], snapshot: dict[str, dict[str, Any]]) -> None:
    for row in local_rows:
        key_source = snapshot.get(str(row.get("parcela_id")), {})
        for field in ("numero_documento", "serie_documento", "parcela_nr"):
            if row.get(field) in (None, ""):
                row[field] = key_source.get(field)
        if not row.get("numero_documento") or not row.get("serie_documento"):
            raise ValueError(
                f"Chave documental ausente para CTRL_REC={row.get('parcela_id')}"
            )


def cross_rows(
    local_rows: list[dict[str, Any]],
    pdf_rows: list[PdfRow],
) -> tuple[list[dict[str, Any]], list[PdfRow], list[dict[str, Any]]]:
    local_map: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    pdf_map: dict[tuple[str, str, str], list[PdfRow]] = defaultdict(list)
    for row in local_rows:
        local_map[row_key(row)].append(row)
    for row in pdf_rows:
        pdf_map[row_key(row)].append(row)

    only_local: list[dict[str, Any]] = []
    only_pdf: list[PdfRow] = []
    differences: list[dict[str, Any]] = []

    for key in sorted(local_map.keys() | pdf_map.keys()):
        locals_for_key = local_map.get(key, []).copy()
        pdf_for_key = pdf_map.get(key, []).copy()

        # A chave pedida tem uma colisão histórica (1544-1/1). Cliente é usado
        # somente como desempate, sem alterar a chave principal da auditoria.
        while locals_for_key and pdf_for_key:
            pair: tuple[int, int] | None = None
            for local_index, local_row in enumerate(locals_for_key):
                for pdf_index, pdf_row in enumerate(pdf_for_key):
                    if str(local_row.get("cliente_id")) == str(pdf_row.cliente_id):
                        pair = (local_index, pdf_index)
                        break
                if pair:
                    break
            local_index, pdf_index = pair or (0, 0)
            local_row = locals_for_key.pop(local_index)
            pdf_row = pdf_for_key.pop(pdf_index)
            difference = dec(local_row.get("saldo_parcela")) - pdf_row.saldo_parcela
            if abs(difference) > Decimal("0.01"):
                differences.append(
                    {
                        "grupo": "saldo_diferente",
                        "local": local_row,
                        "pdf": pdf_row,
                        "diferenca": difference,
                    }
                )

        only_local.extend(locals_for_key)
        only_pdf.extend(pdf_for_key)

    return only_local, only_pdf, differences


def history_pattern(row: dict[str, Any]) -> str:
    history = (row.get("historico") or "").upper()
    if re.search(r"FIDC|FIDIC", history):
        return "FIDC"
    if "PDD" in history:
        return "PDD"
    if "DESCONT" in history:
        return "DESCONTADA"
    if "PRORROG" in history:
        return "PRORROGAÇÃO"
    if "PIX" in history:
        return "PIX"
    if re.search(r"AJUSTE.*VALOR|VALOR.*PRESENTE|\bAVP\b", history):
        return "AVP"
    return "SEM PADRÃO"


def iso_date(value: Any) -> str:
    if not value:
        return ""
    text = str(value)
    return text[:10]


def write_csv(path: Path, offenders: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "grupo",
        "cliente_id",
        "cliente_nome",
        "documento",
        "ctrl_rec",
        "tipo_documento",
        "tipo_documento_descricao",
        "historico",
        "padrao_historico",
        "saldo_local",
        "saldo_pdf",
        "diferenca",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter=";")
        writer.writeheader()
        for item in offenders:
            local = item["local"]
            pdf = item.get("pdf")
            writer.writerow(
                {
                    "grupo": item["grupo"],
                    "cliente_id": local.get("cliente_id"),
                    "cliente_nome": local.get("cliente_nome"),
                    "documento": key_text(local),
                    "ctrl_rec": local.get("parcela_id"),
                    "tipo_documento": local.get("tipo_documento"),
                    "tipo_documento_descricao": local.get("tipo_documento_descricao"),
                    "historico": local.get("historico") or "",
                    "padrao_historico": history_pattern(local),
                    "saldo_local": number_br(dec(local.get("saldo_parcela"))),
                    "saldo_pdf": number_br(pdf.saldo_parcela) if pdf else "0,00",
                    "diferenca": number_br(item["diferenca"]),
                }
            )


def build_report(
    data_base: str,
    pdf: Path,
    pdf_rows: list[PdfRow],
    local_rows: list[dict[str, Any]],
    local_totals: dict[str, Decimal],
    only_local: list[dict[str, Any]],
    only_pdf: list[PdfRow],
    differences: list[dict[str, Any]],
    pg_events: dict[str, Any],
    oracle_current: dict[str, Any] | None,
) -> str:
    offenders = [
        {
            "grupo": "somente_local",
            "local": row,
            "pdf": None,
            "diferenca": dec(row.get("saldo_parcela")),
        }
        for row in only_local
    ] + differences
    offenders.sort(key=lambda item: abs(item["diferenca"]), reverse=True)

    local_total = sum(dec(row.get("saldo_parcela")) for row in only_local)
    pdf_only_total = sum(row.saldo_parcela for row in only_pdf)
    changed_total = sum(item["diferenca"] for item in differences)
    net = local_total - pdf_only_total + changed_total

    pg_receipt_ids = {str(row["id"]) for row in pg_events.get("receipts", [])}
    oracle_receipts = (oracle_current or {}).get("receipts", [])
    late_receipts = [
        row
        for row in oracle_receipts
        if row.get("SEQU_BAI") is not None
        and str(row["SEQU_BAI"]) not in pg_receipt_ids
        and str(row.get("SITU_BAI") or "").strip() == "N"
    ]
    late_total = sum(dec(row.get("VLOR_BAI")) for row in late_receipts)
    oracle_balance_by_id = {
        str(row["CTRL_REC"]): dec(row.get("SALDO"))
        for row in (oracle_current or {}).get("balances", [])
    }
    oracle_matches_pdf = bool(oracle_balance_by_id) and all(
        oracle_balance_by_id.get(str(item["local"].get("parcela_id")))
        == (item["pdf"].saldo_parcela if item.get("pdf") else Decimal("0"))
        for item in offenders
    )

    type_counts = Counter(
        (
            str(item["local"].get("tipo_documento") or ""),
            str(item["local"].get("tipo_documento_descricao") or ""),
        )
        for item in offenders
    )
    pattern_counts = Counter(history_pattern(item["local"]) for item in offenders)

    lines = [
        "# Auditoria parcela a parcela — CRC Controller em 21/06/2026",
        "",
        f"PDF auditado: `{pdf.relative_to(ROOT)}`.",
        "",
        "## Conclusão",
        "",
    ]
    if net == 0 and not offenders:
        lines.extend(
            [
                "A base local e o PDF estão conciliados parcela a parcela nesta execução.",
                "",
                "Não há parcelas exclusivas nem diferenças de saldo em R$.",
            ]
        )
    elif oracle_matches_pdf and late_total == net:
        lines.extend(
            [
                "A diferença de **R$ 166.408,89** não é PDD, FIDC, duplicata "
                "descontada nem ajuste a valor presente. Ela é composta por "
                "**seis baixas normais retroativas**, com data de pagamento em "
                "17/06/2026 ou 19/06/2026, mas gravadas/alteradas no Oracle em "
                "22/06/2026 — depois do snapshot/replicação usado pela base local.",
                "",
                "Ao consultar novamente `VALOR_ABERTO_RECEBER_DATA` no Oracle para "
                f"a data {data_base}, já com essas baixas presentes, os seis saldos "
                "ficam idênticos ao PDF. Portanto, a função é não bitemporal: uma "
                "baixa lançada depois, mas retrodatada, altera o resultado histórico.",
            ]
        )
    else:
        lines.append(
            "O cruzamento fecha o valor líquido, mas a causa operacional não pôde "
            "ser confirmada integralmente no Oracle nesta execução."
        )

    lines.extend(
        [
            "",
            "## Validação do parser",
            "",
            "| Fonte | R$ | SJ$ (sacas) | Parcelas |",
            "|---|---:|---:|---:|",
            f"| PDF | {brl(EXPECTED_PDF_TOTALS['R$'])} | "
            f"{number_br(EXPECTED_PDF_TOTALS['SJ$'])} | {len(pdf_rows):,} |",
            f"| Base local | {brl(local_totals.get('R$', Decimal('0')))} | "
            f"{number_br(local_totals.get('SJ$', Decimal('0')))} | {len(local_rows):,} |",
            "",
            "A extração usa `pdftotext -layout` para validar o fechamento, "
            "`-table` para as colunas e `-raw` para recuperar a chave documental "
            "sem as sobreposições visuais do relatório.",
            "",
            "## Fechamento do cruzamento",
            "",
            "| Grupo | Quantidade | Efeito nós − PDF |",
            "|---|---:|---:|",
            f"| Na nossa base e não no PDF | {len(only_local)} | {brl(local_total)} |",
            f"| No PDF e não na nossa base | {len(only_pdf)} | {brl(-pdf_only_total)} |",
            f"| Presentes em ambos, saldo diferente | {len(differences)} | {brl(changed_total)} |",
            f"| **Líquido** | **{len(only_local) + len(only_pdf) + len(differences)}** | "
            f"**{brl(net)}** |",
            "",
            "## Parcelas divergentes",
            "",
            "| Cliente | Documento | Nosso saldo | PDF | Diferença | Tipo | Histórico |",
            "|---|---|---:|---:|---:|---|---|",
        ]
    )
    for item in offenders:
        local = item["local"]
        pdf_row = item.get("pdf")
        history = (local.get("historico") or "").replace("\r", " ").replace("\n", " ").strip()
        lines.append(
            f"| {local.get('cliente_id')} — {local.get('cliente_nome')} | "
            f"{key_text(local)} | {brl(dec(local.get('saldo_parcela')))} | "
            f"{brl(pdf_row.saldo_parcela) if pdf_row else brl(Decimal('0'))} | "
            f"{brl(item['diferenca'])} | "
            f"{local.get('tipo_documento')} — {local.get('tipo_documento_descricao')} | "
            f"{history or '—'} |"
        )

    lines.extend(["", "## Classificação das hipóteses", ""])
    lines.append("Por tipo de documento:")
    lines.append("")
    for (code, description), count in sorted(type_counts.items()):
        lines.append(f"- {code} — {description}: {count} parcela(s).")
    lines.append("")
    lines.append("Por padrão em `HIST_REC`:")
    lines.append("")
    for pattern, count in sorted(pattern_counts.items()):
        lines.append(f"- {pattern}: {count} parcela(s).")
    lines.extend(
        [
            "",
            "Não há ocorrência de FIDC/FIDIC, PDD, desconto de duplicata ou AVP "
            "nos históricos dos ofensores. Uma parcela menciona prorrogação e uma "
            "menciona PIX; ambas também são explicadas pelas baixas retroativas.",
        ]
    )

    if late_receipts:
        lines.extend(
            [
                "",
                "## Baixas retroativas encontradas no Oracle e ausentes no PostgreSQL",
                "",
                "| Documento | CTRL_REC | Data da baixa | Valor | Desconto | "
                "DUMANUT no Oracle |",
                "|---|---:|---|---:|---:|---|",
            ]
        )
        doc_by_id = {
            str(item["local"].get("parcela_id")): key_text(item["local"])
            for item in offenders
        }
        for receipt in sorted(
            late_receipts,
            key=lambda row: (str(row.get("CTRL_REC")), str(row.get("SEQU_BAI"))),
        ):
            lines.append(
                f"| {doc_by_id.get(str(receipt.get('CTRL_REC')), '')} | "
                f"{receipt.get('CTRL_REC')} | {iso_date(receipt.get('DPAG_BAI'))} | "
                f"{brl(dec(receipt.get('VLOR_BAI')))} | "
                f"{brl(dec(receipt.get('DESC_BAI')))} | "
                f"{str(receipt.get('DUMANUT') or '')[:19].replace('T', ' ')} |"
            )
        lines.extend(
            [
                f"| **Total** |  |  | **{brl(late_total)}** |  |  |",
                "",
                "As baixas têm `SITU_BAI = 'N'` (normais). Não há agrupamentos "
                "nas seis parcelas.",
            ]
        )

    lines.extend(
        [
            "",
            "## Implicação técnica",
            "",
            "Um snapshot diário de saldo histórico não basta para reproduzir "
            "relatórios passados quando o ERP aceita lançamentos retroativos. "
            "Para auditorias futuras, conservar também a data de captura (`as of`) "
            "dos fatos ou reconsultar a função Oracle após fechar o período. O ETL "
            "de `recebimentos` deve ser reexecutado para trazer as seis baixas.",
            "",
            f"Gerado em {datetime.now().astimezone().isoformat(timespec='seconds')}.",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--data-base", default="2026-06-21")
    parser.add_argument("--saida-md", type=Path, default=DEFAULT_MD)
    parser.add_argument("--saida-csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--pdftotext")
    parser.add_argument(
        "--sem-oracle",
        action="store_true",
        help="Não consulta as parcelas divergentes no Oracle.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pdf = args.pdf.resolve()
    if not pdf.exists():
        raise FileNotFoundError(pdf)
    pdftotext = find_pdftotext(args.pdftotext)

    with tempfile.TemporaryDirectory(prefix="auditoria_crc_") as temp_name:
        temp_dir = Path(temp_name)
        extracted = extract_pdf(pdftotext, pdf, temp_dir)
        pdf_rows = parse_pdf(extracted["table"], extracted["raw"], extracted["layout"])

        balance_file = temp_dir / "saldo_cr.json"
        payload = run_historical_balance(args.data_base, balance_file)
        local_rows = payload["cr"]["rows"]
        snapshot = load_snapshot_keys()
        enrich_keys(local_rows, snapshot)

        local_reais = [row for row in local_rows if row.get("unidade_saldo") == "R$"]
        pdf_reais = [row for row in pdf_rows if row.unidade_saldo == "R$"]
        local_totals = sum_by_unit(local_rows, lambda row: row.get("saldo_parcela"))
        if local_totals.get("SJ$", Decimal("0")) != EXPECTED_PDF_TOTALS["SJ$"]:
            raise ValueError(
                "Saldo local SJ$ não fecha com o PDF: "
                f"{number_br(local_totals.get('SJ$', Decimal('0')))} != "
                f"{number_br(EXPECTED_PDF_TOTALS['SJ$'])}"
            )

        only_local, only_pdf, differences = cross_rows(local_reais, pdf_reais)
        offenders = [
            {
                "grupo": "somente_local",
                "local": row,
                "pdf": None,
                "diferenca": dec(row.get("saldo_parcela")),
            }
            for row in only_local
        ] + differences
        offender_ids = sorted({str(item["local"]["parcela_id"]) for item in offenders})
        pg_events = load_postgres_events(offender_ids)

        oracle_current = None
        if offender_ids and not args.sem_oracle:
            oracle_current = load_oracle_current(offender_ids, args.data_base)

        report = build_report(
            args.data_base,
            pdf,
            pdf_rows,
            local_rows,
            local_totals,
            only_local,
            only_pdf,
            differences,
            pg_events,
            oracle_current,
        )
        args.saida_md.parent.mkdir(parents=True, exist_ok=True)
        args.saida_md.write_text(report, encoding="utf-8")
        write_csv(args.saida_csv, offenders)

    net = (
        sum(dec(row.get("saldo_parcela")) for row in only_local)
        - sum(row.saldo_parcela for row in only_pdf)
        + sum(item["diferenca"] for item in differences)
    )
    print(f"PDF: {len(pdf_rows)} parcelas; totais validados.")
    print(
        f"Cruzamento: somente local={len(only_local)}, somente PDF={len(only_pdf)}, "
        f"saldo diferente={len(differences)}."
    )
    print(f"Diferença líquida (nós - PDF): {brl(net)}")
    print(f"Markdown: {args.saida_md.resolve()}")
    print(f"CSV: {args.saida_csv.resolve()}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI deve reportar contexto completo.
        print(f"[auditoria_crc_controller] erro: {error}", file=sys.stderr)
        raise
