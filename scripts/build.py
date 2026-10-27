"""Validate data/ and generate everything derived from it.

    python scripts/build.py           # validate, then regenerate the outputs below
    python scripts/build.py --check   # validate, and fail if any output is out of date (used in CI)

Inputs:   data/papers.bib, data/methods.csv
Outputs:  docs/data/database.json                    data for the website
          docs/downloads/rule-extraction-papers.bib  clean BibTeX of all papers
          docs/downloads/rule-extraction-methods.csv one row per method
          README.md                                  method tables between the generated markers
"""
import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path

from bibtex import authors, parse, plain, to_bibtex

ROOT = Path(__file__).resolve().parent.parent
COLUMNS = ["id", "name", "papers", "approach", "translucency", "design", "application", "scope", "technique"]

# Controlled vocabulary: value -> (label, description). Order here is display order.
VOCAB = {
    "approach": {
        "explore_test": ("Explore & test", "Search the space of candidate rules and test them against the network's outputs."),
        "induced_models": ("Induced models", "Fit an interpretable proxy (decision tree, decision table, Boolean function) to the network and read the rules from it."),
        "attribution": ("Attribution", "Rank the importance of inputs or hidden units for an output and build rules from the most important ones."),
        "optimization": ("Optimization", "Search for the input values that maximize the activation of an output class."),
        "hybrid": ("Hybrid", "Combine several of the other approaches."),
    },
    "translucency": {
        "pedagogical": ("Pedagogical", "Treats the network as a black box: rules map inputs directly to outputs."),
        "decompositional": ("Decompositional", "Extracts rules at each hidden and output unit, then aggregates them."),
        "eclectic": ("Eclectic", "Uses the network internals but extracts rules linking inputs to outputs directly."),
    },
    "design": {
        "post-hoc": ("Post-hoc", "Applied after training, with no training requirements."),
        "intrinsic": ("Intrinsic", "Requires a modified network or a special training regime, such as regularization or pruning."),
    },
    "application": {
        "agnostic": ("Model-agnostic", "Applicable to any machine learning model."),
        "specific": ("Model-specific", "Designed for neural networks."),
    },
    "scope": {
        "global": ("Global", "Explains the behavior of the whole network."),
        "local": ("Local", "Explains a single prediction."),
    },
}
DIMENSION_LABELS = {"approach": "Approach", "translucency": "Translucency", "design": "Design",
                    "application": "Application", "scope": "Scope"}


def load(errors):
    entries = parse((ROOT / "data/papers.bib").read_text(encoding="utf-8"))
    papers = {}
    for e in entries:
        if e["key"] in papers:
            errors.append(f"papers.bib: duplicate key {e['key']}")
        for field in ("title", "author", "year"):
            if not e["fields"].get(field):
                errors.append(f"papers.bib: {e['key']} has no {field}")
        papers[e["key"]] = e

    with open(ROOT / "data/methods.csv", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            errors.append(f"methods.csv: columns must be {COLUMNS}, found {reader.fieldnames}")
        methods = list(reader)

    seen = set()
    for n, m in enumerate(methods, 2):
        where = f"methods.csv line {n} ({m.get('id')})"
        if not re.fullmatch(r"M\d{2,}", m["id"] or ""):
            errors.append(f"{where}: id must look like M01")
        if m["id"] in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(m["id"])
        for dim, values in VOCAB.items():
            if m[dim] not in values:
                errors.append(f"{where}: {dim} '{m[dim]}' is not one of {list(values)}")
        m["papers"] = [k.strip() for k in m["papers"].split(";") if k.strip()]
        if not m["papers"]:
            errors.append(f"{where}: no papers")
        for k in m["papers"]:
            if k not in papers:
                errors.append(f"{where}: paper '{k}' is not in papers.bib")
    used = {k for m in methods for k in m["papers"]}
    for k in sorted(set(papers) - used):
        errors.append(f"papers.bib: {k} is not cited by any method")
    return papers, methods


def year(entry):
    return int(re.search(r"\d{4}", entry["fields"]["year"]).group())


def citations(papers):
    """{key: 'Towell and Shavlik (1993)'}, with a/b suffixes when two papers would read the same."""
    base = {}
    for key, entry in papers.items():
        last = [n.split()[-1] for n in authors(entry["fields"]["author"])] or ["Anon."]
        who = last[0] if len(last) == 1 else f"{last[0]} and {last[1]}" if len(last) == 2 else f"{last[0]} et al."
        base[key] = (who, year(entry))
    out = {}
    for key, (who, yr) in base.items():
        same = sorted(k for k, v in base.items() if v == (who, yr))
        suffix = "abcdefghij"[same.index(key)] if len(same) > 1 else ""
        out[key] = f"{who} ({yr}{suffix})"
    return out


def venue(f):
    for field in ("journal", "booktitle", "institution", "school", "publisher", "howpublished"):
        if f.get(field):
            return plain(f[field])
    return ""


def link(f):
    if f.get("doi"):
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", f["doi"])
        return f"https://doi.org/{doi}"
    return f.get("url", "").replace("\\%", "%").replace("\\_", "_").replace("\\&", "&")


def database(papers, methods):
    cite = citations(papers)
    by_paper = {}
    for m in methods:
        for k in m["papers"]:
            by_paper.setdefault(k, []).append(m["id"])
    out_methods = []
    for m in methods:
        first = min(m["papers"], key=lambda k: year(papers[k]))
        out_methods.append({
            **{c: m[c] for c in COLUMNS if c != "papers"},
            "label": m["name"] or cite[first],
            "papers": m["papers"],
            "year": year(papers[first]),
        })
    out_papers = []
    for key, e in sorted(papers.items(), key=lambda kv: (year(kv[1]), kv[0].lower())):
        f = e["fields"]
        out_papers.append({
            "key": key,
            "title": plain(f["title"]),
            "authors": authors(f["author"]),
            "citation": cite[key],
            "year": year(e),
            "venue": venue(f),
            "link": link(f),
            "abstract": plain(f.get("abstract", "")),
            "bibtex": to_bibtex(e),
            "methods": by_paper.get(key, []),
        })
    vocab = {dim: {"label": DIMENSION_LABELS[dim],
                   "values": [{"value": v, "label": l, "description": d} for v, (l, d) in values.items()]}
             for dim, values in VOCAB.items()}
    return {"vocabulary": vocab, "methods": out_methods, "papers": out_papers}


def methods_csv(db):
    titles = {p["key"]: p["citation"] for p in db["papers"]}
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["id", "name", "year", "approach", "translucency", "design", "application", "scope",
                "technique", "paper_keys", "papers"])
    for m in db["methods"]:
        w.writerow([m["id"], m["name"], m["year"], m["approach"], m["translucency"], m["design"],
                    m["application"], m["scope"], m["technique"], ";".join(m["papers"]),
                    "; ".join(titles[k] for k in m["papers"])])
    return buf.getvalue()


def readme(db, current):
    papers = {p["key"]: p for p in db["papers"]}
    label = {dim: {v["value"]: v["label"] for v in spec["values"]} for dim, spec in db["vocabulary"].items()}
    lines = []
    for value, (name, description) in VOCAB["approach"].items():
        rows = [m for m in db["methods"] if m["approach"] == value]
        lines += [f"### {name} ({len(rows)})", "", description, "",
                  "| Method | Papers | Translucency | Design | Application | Scope | Technique |",
                  "|---|---|---|---|---|---|---|"]
        for m in rows:
            refs = ", ".join(f"[{papers[k]['citation']}]({papers[k]['link']})" if papers[k]["link"]
                             else papers[k]["citation"] for k in m["papers"])
            lines.append(f"| {m['name'] or '–'} | {refs} | {label['translucency'][m['translucency']]} | "
                         f"{label['design'][m['design']]} | {label['application'][m['application']]} | "
                         f"{label['scope'][m['scope']]} | {m['technique']} |")
        lines.append("")
    start, end = "<!-- methods:start (generated by scripts/build.py, do not edit) -->", "<!-- methods:end -->"
    if start not in current or end not in current:
        raise SystemExit("README.md is missing the generated-section markers")
    head, rest = current.split(start, 1)
    tail = rest.split(end, 1)[1]
    return f"{head}{start}\n\n" + "\n".join(lines) + f"\n{end}{tail}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="fail if outputs are out of date instead of writing them")
    args = ap.parse_args()

    errors = []
    papers, methods = load(errors)
    if errors:
        print("Invalid data:\n  " + "\n  ".join(errors))
        return 1

    db = database(papers, methods)
    readme_path = ROOT / "README.md"
    outputs = {
        ROOT / "docs/data/database.json": json.dumps(db, ensure_ascii=False, indent=1) + "\n",
        ROOT / "docs/downloads/rule-extraction-papers.bib": "\n\n".join(p["bibtex"] for p in db["papers"]) + "\n",
        ROOT / "docs/downloads/rule-extraction-methods.csv": methods_csv(db),
        readme_path: readme(db, readme_path.read_text(encoding="utf-8")),
    }
    stale = [p for p, text in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
    summary = (f"{len(papers)} papers, {len(methods)} methods "
               f"({sum(m['scope'] == 'global' for m in methods)} global, {sum(m['scope'] == 'local' for m in methods)} local)")
    if args.check:
        if stale:
            print("Out of date (run python scripts/build.py):\n  " + "\n  ".join(str(p.relative_to(ROOT)) for p in stale))
            return 1
        print(f"OK: {summary}")
        return 0
    for path in stale:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(outputs[path], encoding="utf-8", newline="\n")
    print(f"{summary}; updated {len(stale)} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
