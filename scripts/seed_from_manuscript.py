"""One-time seeding of data/ from the review manuscript (kept for provenance).

The method tables of the manuscript are authoritative: each table row becomes one row of
data/methods.csv, and every paper cited in those tables is copied from the manuscript's
.bib file into data/papers.bib.

Usage (from the repository root):
    python scripts/seed_from_manuscript.py --tex <manuscript.tex> --bib <manuscript.bib>
"""
import argparse
import csv
import re
from pathlib import Path

from bibtex import parse

ROOT = Path(__file__).resolve().parent.parent
APPROACH = {"explore_test": "explore_test", "induced_models_methods": "induced_models",
            "attribution_methods": "attribution", "optimization_methods": "optimization",
            "hybrid_methods": "hybrid"}
HEADER = {"Translucency": "translucency", "Design": "design", "Application": "application",
          "Scope": "scope", "Reference": "papers", "Tool name": "name", "Technique": "technique"}
DESIGN = {"Post-hoc": "post-hoc", "Intrinsic": "intrinsic"}
APPLICATION = {"A": "agnostic", "S": "specific"}
SCOPE = {"G": "global", "L": "local"}
LOCAL_WITHOUT_SCOPE_COLUMN = {"ribeiro2018"}  # Anchors: its table has no Scope column
COLUMNS = ["id", "name", "papers", "approach", "translucency", "design", "application", "scope", "technique"]


def clean(cell):
    cell = re.sub(r"\\multirow\[t\]\{[^}]*\}\{[^}]*\}\{([^}]*)\}", r"\1", cell)
    cell = re.sub(r"\\hline|\\cline\{[^}]*\}", "", cell)
    cell = re.sub(r"\\textendash\s*", "-", cell).replace("\\&", "&")
    cell = " ".join(cell.split())
    return "" if cell == "-" else cell


def methods_from_tables(tex):
    methods = []
    for table in re.finditer(r"(?s)\\begin\{table\*\}.*?\\label\{tab:([a-z_]+)\}(.*?)\\end\{table\*\}", tex):
        approach = APPROACH[table.group(1)]
        header, translucency, design = None, "", ""
        for row in table.group(2).split("\\\\"):
            if "Translucency" in row and "Reference" in row:
                header = [HEADER[clean(c)] for c in re.split(r"(?<!\\)&", row[row.index("Translucency"):])]
                continue
            cells = [clean(c) for c in re.split(r"(?<!\\)&", row)]
            if "\\cite{" not in row:
                continue
            values = dict(zip(header, cells))
            translucency = values.get("translucency") or translucency
            design = values.get("design") or design
            papers = [k.strip() for c in re.findall(r"\\cite\{([^}]*)\}", row) for k in c.split(",")]
            scope = SCOPE[values["scope"]] if values.get("scope") else (
                "local" if set(papers) & LOCAL_WITHOUT_SCOPE_COLUMN else "global")
            methods.append({
                "name": values.get("name", ""),
                "papers": ";".join(papers),
                "approach": approach,
                "translucency": translucency.lower(),
                "design": DESIGN[design],
                # optimization and hybrid tables have no Application column: all model-specific
                "application": APPLICATION[values["application"]] if values.get("application") else "specific",
                "scope": scope,
                "technique": values.get("technique", "")[:1].upper() + values.get("technique", "")[1:],
            })
    for i, m in enumerate(methods, 1):
        m["id"] = f"M{i:02d}"
    return methods


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tex", required=True)
    ap.add_argument("--bib", required=True)
    args = ap.parse_args()

    tex = Path(args.tex).read_text(encoding="utf-8")
    methods = methods_from_tables(tex)
    keys = {k for m in methods for k in m["papers"].split(";")}
    entries = [e for e in parse(Path(args.bib).read_text(encoding="utf-8")) if e["key"] in keys]
    missing = keys - {e["key"] for e in entries}
    if missing:
        raise SystemExit(f"cited in tables but missing from the .bib file: {sorted(missing)}")
    entries.sort(key=lambda e: (e["fields"].get("year", ""), e["key"].lower()))

    data = ROOT / "data"
    data.mkdir(exist_ok=True)
    with open(data / "methods.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(methods)
    header = "% Papers included in the systematic review (one entry per paper).\n% Seeded from the manuscript's bibliography; edit here, then run scripts/build.py.\n\n"
    (data / "papers.bib").write_text(header + "\n\n".join(e["raw"].strip() for e in entries) + "\n", encoding="utf-8")
    print(f"wrote {len(methods)} methods and {len(entries)} papers to {data}")


if __name__ == "__main__":
    main()
