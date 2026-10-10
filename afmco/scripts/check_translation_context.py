# Copyright (c) 2026, AFMCO and contributors

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import re
from pathlib import Path


def read_rows(csv_path: Path) -> list[list[str]]:
    if not csv_path.exists():
        return []
    with csv_path.open(encoding="utf-8", newline="") as handle:
        return list(csv.reader(handle))


def plain_and_context_keys(rows: list[list[str]]) -> tuple[set, dict]:
    plain = set()
    ctx_only = {}
    for row in rows:
        if len(row) >= 3 and row[2].strip():
            ctx_only.setdefault(row[0], set()).add(row[2].strip())
        elif len(row) >= 2 and row[0].strip():
            plain.add(row[0])
    return plain, ctx_only


def po_translated_msgids(po_path: Path) -> set:
    found = set()
    if not po_path.exists():
        return found
    content = po_path.read_text(encoding="utf-8")
    for block in re.split(r"\n\n+", content):
        msgid = re.search(r'msgid "((?:[^"\\]|\\.)*)"', block)
        msgstr = re.search(r'msgstr "((?:[^"\\]|\\.)*)"', block)
        if msgid and msgstr and msgstr.group(1):
            found.add(msgid.group(1))
    return found


def context_less_surfaces(package: Path) -> dict:
    names = {}

    def add(name: str, source: str) -> None:
        if name:
            names.setdefault(name, []).append(source)

    for path in glob.glob(str(package / "**" / "sidebar" / "*" / "*.json"), recursive=True):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        for item in data.get("items", []) or []:
            add(item.get("label"), path)

    for path in glob.glob(str(package / "**" / "workspace" / "*" / "*.json"), recursive=True):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        add(data.get("title"), path)
        for link in data.get("links", []) or []:
            add(link.get("label"), path)
        for shortcut in data.get("shortcuts", []) or []:
            add(shortcut.get("label"), path)

    for path in glob.glob(str(package / "**" / "doctype" / "*" / "*.json"), recursive=True):
        if "__pycache__" in path:
            continue
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("doctype") == "DocType" and data.get("name"):
            add(data["name"], path)

    for path in glob.glob(str(package / "**" / "page" / "*" / "*.json"), recursive=True):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("title"):
            add(data["title"], path)

    for path in glob.glob(str(package / "**" / "report" / "*" / "*.json"), recursive=True):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("report_name"):
            add(data["report_name"], path)

    return names


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flags a source string whose only afmco ar.csv row carries a context, "
        "while a sidebar, workspace, DocType, Page or Report name in this app needs the "
        "plain, context-less key that frappe._()/__() fall back to when no context is "
        "passed. A context-tagged row never satisfies that lookup (frappe/utils/"
        "translations.py _(), frappe/public/js/frappe/translate.js frappe._()), so the "
        "stock check-translations gate reading only row[0] certifies these as covered "
        "while they render in English at the context-less call site."
    )
    parser.add_argument("--package", required=True)
    parser.add_argument("--lang", required=True)
    parser.add_argument("--bench-apps", action="append", default=[],
                        help="Extra app path whose locale/<lang>.po translated msgids "
                             "also satisfy a plain lookup (e.g. frappe, erpnext, hrms).")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    package = Path(args.package).resolve()
    csv_path = package / "translations" / f"{args.lang}.csv"
    plain, ctx_only = plain_and_context_keys(read_rows(csv_path))

    for app_path in args.bench_apps:
        plain |= po_translated_msgids(Path(app_path) / "locale" / f"{args.lang}.po")

    surfaces = context_less_surfaces(package)
    hits = []
    for name, sources in sorted(surfaces.items()):
        if name not in plain and name in ctx_only:
            hits.append({
                "text": name,
                "only_context": sorted(ctx_only[name]),
                "sources": sorted(set(sources)),
            })

    payload = {
        "lang": args.lang,
        "surface_count": len(surfaces),
        "context_blind_count": len(hits),
        "hits": hits,
        "passed": len(hits) == 0,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    else:
        for hit in hits:
            print(f"{hit['text']} | only_context={hit['only_context']} | {hit['sources']}")
        print(f"context_blind_count={len(hits)} surface_count={len(surfaces)}")
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
