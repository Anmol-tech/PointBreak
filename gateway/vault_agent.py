"""Seller-side answer engine. It reads the documents; outside agents only get short, cited answers."""

import pathlib
import re

STOPWORDS = set(
    "a an and any are as at be by can do does for from has have how i in is it its me of on or our "
    "please show tell that the their them there these this to was what when where which who why will "
    "with you your about give list all every summarize summary".split()
)


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) > 4 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def terms(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {_stem(w) for w in words if w not in STOPWORDS and len(w) > 1}


def _money(value: str) -> float | None:
    cleaned = value.replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def summarize_table(lines: list[str]) -> str:
    """Tables never leave as rows: only row count and column totals."""
    rows = [[c.strip() for c in line.strip().strip("|").split("|")] for line in lines]
    rows = [r for r in rows if not all(set(c) <= set("-: ") for c in r)]
    if len(rows) < 2:
        return ""
    header, body = rows[0], rows[1:]
    totals = []
    for col, name in enumerate(header):
        values = [_money(r[col]) for r in body if col < len(r)]
        if values and all(v is not None for v in values) and any("$" in r[col] for r in body if col < len(r)):
            total = sum(values)
            totals.append(f"total {name.lower()} {'-' if total < 0 else ''}${abs(total):,.0f}")
    summary = f"[table with {len(body)} rows; row-level data withheld"
    return summary + (f"; {', '.join(totals)}]" if totals else "]")


class Section:
    def __init__(self, sid: str, folder: str, doc: str, title: str, heading: str, body: str):
        self.id, self.folder, self.doc, self.title, self.heading, self.body = sid, folder, doc, title, heading, body
        self.terms = terms(body)
        self.heading_terms = terms(heading) | terms(title)


class VaultAgent:
    def __init__(self, root: pathlib.Path, max_snippets: int = 2, max_chars: int = 300):
        self.root, self.max_snippets, self.max_chars = root, max_snippets, max_chars
        self.sections: list[Section] = []
        self.docs: dict[str, dict] = {}
        for path in sorted(root.glob("*/*.md")):
            folder, doc = path.parent.name, path.stem
            text = path.read_text()
            title_match = re.search(r"^# (.+)$", text, re.M)
            title = title_match.group(1).strip() if title_match else doc
            parts = re.split(r"^## (.+)$", text, flags=re.M)
            headings = []
            for i in range(1, len(parts), 2):
                heading, body = parts[i].strip(), parts[i + 1].strip()
                sid = f"{folder}/{doc}#{len(headings) + 1}"
                self.sections.append(Section(sid, folder, doc, title, heading, body))
                headings.append(heading)
            self.docs[f"{folder}/{doc}"] = {"folder": folder, "doc": doc, "title": title, "headings": headings}

    def folders(self) -> list[str]:
        return sorted({d["folder"] for d in self.docs.values()})

    def sections_in(self, folders: list[str]) -> list[Section]:
        return [s for s in self.sections if s.folder in folders]

    def index(self, folders: list[str]) -> list[dict]:
        return [d for d in self.docs.values() if d["folder"] in folders]

    def _snippet(self, section: Section) -> str:
        prose, table = [], []
        for line in section.body.splitlines():
            (table if line.strip().startswith("|") else prose).append(line.strip())
        text = " ".join(l for l in prose if l)
        sentences = re.split(r"(?<=[.!?])\s+", text)
        snippet = " ".join(sentences[:2]).strip()
        if len(snippet) > self.max_chars:
            snippet = snippet[: self.max_chars - 1].rsplit(" ", 1)[0] + "…"
        table_note = summarize_table(table) if table else ""
        return " ".join(p for p in (snippet, table_note) if p)

    def answer(self, question: str, folders: list[str]) -> dict:
        q = terms(question)
        scored = []
        for s in self.sections_in(folders):
            score = len(q & s.terms) + 2 * len(q & s.heading_terms)
            if score:
                scored.append((score, s))
        scored.sort(key=lambda x: -x[0])
        top = [s for _, s in scored[: self.max_snippets]]
        if not top:
            return {"answer": "No relevant information was found in the documents shared with you.", "citations": []}
        citations = [
            {"section_id": s.id, "source": f"{s.folder}/{s.title} § {s.heading}", "snippet": self._snippet(s)}
            for s in top
        ]
        lines = [f"Answer from {len(top)} section(s). Documents are not released; only these excerpts are shared."]
        for i, c in enumerate(citations, 1):
            lines.append(f"{i}. {c['snippet']} [{c['source']}]")
        return {"answer": "\n".join(lines), "citations": citations}
