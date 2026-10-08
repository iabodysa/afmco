import argparse
import csv
import io
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
CSV_PATH = "afmco/translations/ar.csv"
LETTER = "ء-ي"
PLACEHOLDER = re.compile(r"\{[^{}]*\}|%\([^)]*\)[sd]|%[sd]|<[^<>]+>")
SHORT_VOWEL = re.compile("[ٌ-ِْ]")
ADVERBIAL = re.compile(f"(?:اً|ًا)(?![{LETTER}])")
INDIC_DIGIT = re.compile("[٠-٩۰-۹]")
LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z0-9]+")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
LABEL = re.compile(r"[A-Z][A-Za-z()]*(?: [A-Za-z()]+){0,4}")
DATE_LABEL = re.compile(r"(?:[A-Z][\w()]* ){0,4}Date")
TERMINAL = {".": ".", "?": "؟", "!": "!", ":": ":"}
CLOSERS = ".؟!?"
RULES = ("R03", "R04", "R10", "R11", "R22", "R23", "R24", "R25", "R26", "R27", "R28", "R29", "R30")


def read_tsv(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def load_config():
    cfg = {"deny": [], "allow": {}, "abbr": set(), "brand": set(), "preposition": set(), "control": []}
    for row in read_tsv(HERE / "wording_checks.tsv"):
        rule, kind, value = row["rule"], row["kind"], row["value"]
        if kind == "deny":
            cfg["deny"].append((rule, re.compile(value)))
        elif kind == "allow" and rule == "R29":
            cfg["abbr"].add(value)
        elif kind == "allow":
            cfg["allow"].setdefault(rule, set()).add(value)
        elif kind == "brand":
            cfg["brand"].add(value)
        elif kind == "preposition":
            cfg["preposition"].add(value)
        elif kind == "control":
            cfg["control"].append((rule, row["source"], value, row["context"] or ""))
        else:
            cfg[kind] = value
    return cfg


def load_glossary():
    entries, problems = {}, []
    for row in read_tsv(HERE / "glossary.tsv"):
        problems.extend(glossary_problems(row, entries))
        entries[(row["english"].strip().lower(), row["context"].strip())] = row["arabic"].strip()
    return entries, problems


def glossary_problems(row, seen):
    key = (row["english"].strip().lower(), row["context"].strip())
    found = []
    if not row["decider"].strip() or not row["reason"].strip():
        found.append(("R06", row["english"], row["context"]))
    if key in seen:
        found.append(("R04", row["english"], row["context"]))
    return found


def parse_rows(text):
    return [r + [""] * (3 - len(r)) for r in csv.reader(io.StringIO(text)) if r]


def bare(value, article):
    value = value.strip()
    return value[len(article):] if value.startswith(article) else value


def check(source, value, context, cfg, glossary):
    hits = set()
    article = cfg["article"]
    key = (source.strip().lower(), context.strip())
    if key in glossary and bare(value, article) != bare(glossary[key], article):
        hits.add("R04")
    if SHORT_VOWEL.search(value) or value.count("ً") > len(ADVERBIAL.findall(value)):
        hits.add("R03")
    for rule, pattern in cfg["deny"]:
        allowed = cfg["allow"].get(rule, set())
        if any(m.group(0) not in allowed for m in pattern.finditer(value)):
            hits.add(rule)
    if value != value.strip() or "  " in value:
        hits.add("R25")
    end, vend = source.rstrip()[-1:], value.rstrip()[-1:]
    if end in TERMINAL and vend != TERMINAL[end]:
        hits.add("R25")
    if end.isalnum() and vend in CLOSERS:
        hits.add("R25")
    if Counter(PLACEHOLDER.findall(source)) != Counter(PLACEHOLDER.findall(value)):
        hits.add("R26")
    starts_range = source.split(" ", 1)[0] in ("From", "To")
    if DATE_LABEL.fullmatch(source) and not starts_range and not value.startswith(cfg["date_head"]):
        hits.add("R27")
    if (cfg["hijri"] in value) != ("hijri" in source.lower()):
        hits.add("R27")
    words = value.split()
    if LABEL.fullmatch(source) and words and words[0] in cfg["preposition"] and not starts_range:
        hits.add("R10")
    if source.isalpha() and source.istitle() and key not in glossary and len(words) == 1 and not value.startswith(article) and not LATIN_WORD.fullmatch(value):
        hits.add("R11")
    for token in LATIN_WORD.findall(PLACEHOLDER.sub(" ", EMAIL.sub(" ", value))):
        if token in cfg["abbr"] or token in cfg["brand"]:
            continue
        hits.add("R28" if token.isupper() and len(token) <= 5 else "R29")
    if INDIC_DIGIT.search(value) or any(e not in value for e in EMAIL.findall(source)):
        hits.add("R30")
    return hits


def violations(text, cfg, glossary):
    rows = parse_rows(text)
    found = Counter()
    for source, value, context in (r[:3] for r in rows):
        for rule in check(source, value, context, cfg, glossary):
            found[(rule, source, context)] += 1
    return rows, found


def run_control(cfg, glossary):
    caught, missing = 0, []
    for rule, source, value, context in cfg["control"]:
        if rule in check(source, value, context, cfg, glossary):
            caught += 1
        else:
            missing.append(rule)
    if glossary_problems({"english": "control", "context": "", "decider": "", "reason": ""}, {}):
        caught += 1
    else:
        missing.append("R06")
    uncovered = sorted(set(RULES) - {c[0] for c in cfg["control"]})
    return caught, len(cfg["control"]) + 1, missing + uncovered


def repo_root():
    out = subprocess.run(["git", "-C", str(HERE), "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    return Path(out.stdout.strip())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--against")
    parser.add_argument("--list", type=int, default=10)
    args = parser.parse_args()
    cfg = load_config()
    glossary, gproblems = load_glossary()
    rows, found = violations((HERE / "ar.csv").read_text(encoding="utf-8"), cfg, glossary)
    for problem in gproblems:
        found[problem] += 1
    caught, total, missing = run_control(cfg, glossary)
    by_rule = Counter()
    for (rule, _, _), n in found.items():
        by_rule[rule] += n
    print(f"consumed:{len(rows)} glossary:{len(glossary)} hits:{sum(found.values())} control:{caught}/{total} caught")
    print("by_rule:" + " ".join(f"{r}:{by_rule[r]}" for r in sorted(by_rule)))
    if missing:
        print("control_missed:" + ",".join(missing))
        return 1
    if args.against:
        base_text = subprocess.run(["git", "-C", str(repo_root()), "show", f"{args.against}:{CSV_PATH}"], capture_output=True, text=True, check=True).stdout
        _, base = violations(base_text, cfg, glossary)
        new = found - base
        print(f"against:{args.against} base_hits:{sum(base.values())} new:{sum(new.values())}")
        for (rule, source, context), _ in list(new.items())[: args.list]:
            print(f"new:{rule}|{source}|{context}")
        return 1 if new else 0
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
