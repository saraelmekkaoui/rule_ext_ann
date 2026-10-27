"""Minimal BibTeX reader/writer for this repository (standard library only, no @string macros)."""
import re
import unicodedata

ENTRY_START = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,")
FIELD_NAME = re.compile(r"\s*,?\s*([A-Za-z][\w-]*)\s*=\s*")
BARE_VALUE = re.compile(r"[^,}\s]+")

# LaTeX accent commands -> Unicode combining marks
ACCENTS = {'"': "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304",
           ".": "\u0307", "c": "\u0327", "v": "\u030C", "u": "\u0306", "H": "\u030B", "k": "\u0328"}
SYMBOL_ACCENT = re.compile(r"\\([\"'`^~=.])\s*\{?\s*\\?([A-Za-z])\s*\}?")
LETTER_ACCENT = re.compile(r"\\([cvuHk])\s*(?:\{\s*([A-Za-z])\s*\}|\s([A-Za-z]))")

# Fields written when exporting an entry; anything else (abstract, keywords, file...) is dropped.
EXPORT_FIELDS = ["author", "title", "journal", "booktitle", "editor", "volume", "number", "pages",
                 "year", "publisher", "address", "organization", "institution", "school", "series",
                 "howpublished", "note", "doi", "url", "isbn", "issn"]


def parse(text):
    """Return a list of {type, key, fields, raw} in file order."""
    entries, i = [], 0
    while True:
        m = ENTRY_START.search(text, i)
        if not m:
            return entries
        depth, j = 1, m.end()
        while j < len(text) and depth:
            depth += {"{": 1, "}": -1}.get(text[j], 0)
            j += 1
        entries.append({"type": m.group(1).lower(), "key": m.group(2),
                        "fields": _fields(text[m.end():j - 1]), "raw": text[m.start():j]})
        i = j


def _fields(body):
    fields, i, n = {}, 0, len(body)
    while i < n:
        m = FIELD_NAME.match(body, i)
        if not m:
            break
        name, i = m.group(1).lower(), m.end()
        if i < n and body[i] == "{":
            depth, j = 0, i
            while j < n:
                depth += {"{": 1, "}": -1}.get(body[j], 0)
                if depth == 0:
                    break
                j += 1
            value, i = body[i + 1:j], j + 1
        elif i < n and body[i] == '"':
            j = body.index('"', i + 1)
            value, i = body[i + 1:j], j + 1
        else:
            m2 = BARE_VALUE.match(body, i)
            value, i = (m2.group(0), m2.end()) if m2 else ("", i)
        fields[name] = " ".join(value.split())
    return fields


def plain(s):
    """LaTeX field value -> readable Unicode text."""
    s = s or ""
    s = SYMBOL_ACCENT.sub(lambda m: m.group(2) + ACCENTS[m.group(1)], s)
    s = LETTER_ACCENT.sub(lambda m: (m.group(2) or m.group(3)) + ACCENTS[m.group(1)], s)
    s = s.replace("{\\i}", "ı").replace("\\i ", "ı").replace("\\ss", "ß").replace("\\o", "ø")
    s = s.replace("\\&", "&").replace("---", "—").replace("--", "–").replace("~", " ")
    s = re.sub(r"\\(emph|textit|textbf|mbox)\s*", "", s)
    s = s.replace("{", "").replace("}", "")
    return unicodedata.normalize("NFC", " ".join(s.split()))


def authors(field):
    """'Last, First and First Last' -> ['First Last', 'First Last']."""
    out = []
    for name in re.split(r"\s+and\s+", plain(field)):
        if "," in name:
            last, first = name.split(",", 1)
            name = f"{first.strip()} {last.strip()}"
        if name.strip():
            out.append(name.strip())
    return out


def to_bibtex(entry):
    """Clean export of one entry (no abstract/keywords)."""
    f = entry["fields"]
    lines = [f"@{entry['type']}{{{entry['key']},"]
    for name in EXPORT_FIELDS:
        if f.get(name):
            lines.append(f"  {name} = {{{f[name]}}},")
    lines[-1] = lines[-1].rstrip(",")
    return "\n".join(lines) + "\n}"


def title_key(s, n=60):
    """Normalised title prefix used to match the same paper across sources."""
    s = unicodedata.normalize("NFKD", plain(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())[:n]
