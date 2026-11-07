"""Output protection: masking, per-agent fingerprints, and leak tracing."""

import re

SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
PHONE = re.compile(r"\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b")
# "Dana Whitfield, dana@..." — a person's name written right before their email address.
NAME_BEFORE_EMAIL = re.compile(r"\b[A-Z][a-z]+ [A-Z][a-z]+(?=,\s*[\w.+-]+@)")

ZERO, ONE, MARK = "​", "‌", "﻿"
FP_PATTERN = re.compile(f"{MARK}([{ZERO}{ONE}]{{24}}){MARK}")
INVISIBLE = re.compile(f"[{ZERO}{ONE}{MARK}]")


class Masker:
    def __init__(self, names: set[str]):
        self.names = sorted(names, key=len, reverse=True)

    def mask(self, text: str) -> str:
        text = SSN.sub("[SSN masked]", text)
        text = NAME_BEFORE_EMAIL.sub("[name masked]", text)
        text = EMAIL.sub("[email masked]", text)
        text = PHONE.sub("[phone masked]", text)
        for name in self.names:
            text = text.replace(name, "[name masked]")
        return text


def roster_names(vault) -> set[str]:
    """Personal names come from the HR roster table's Name column."""
    names = set()
    for section in vault.sections:
        if section.folder != "HR":
            continue
        rows = [l for l in section.body.splitlines() if l.strip().startswith("|")]
        if rows and "name" in rows[0].lower():
            for row in rows[2:]:
                names.add(row.strip().strip("|").split("|")[0].strip())
    return {n for n in names if n}


def embed(text: str, fingerprint: str) -> str:
    """Hide a 24-bit fingerprint (6 hex chars) after the first word of every line."""
    bits = format(int(fingerprint, 16), "024b")
    mark = MARK + "".join(ONE if b == "1" else ZERO for b in bits) + MARK
    out = []
    for line in text.split("\n"):
        head, sep, tail = line.partition(" ")
        out.append(head + mark + sep + tail if sep else line + mark)
    return "\n".join(out)


def extract(text: str) -> set[str]:
    found = set()
    for bits in FP_PATTERN.findall(text):
        found.add(format(int("".join("1" if c == ONE else "0" for c in bits), 2), "06x"))
    return found


def _shingles(text: str, n: int = 6) -> set[tuple]:
    words = re.findall(r"[a-z0-9$%]+", INVISIBLE.sub("", text).lower())
    return {tuple(words[i : i + n]) for i in range(max(0, len(words) - n + 1))}


def match_answers(text: str, answers: list[dict]) -> dict[str, float]:
    """Fallback when invisible marks were stripped: overlap with answers we served."""
    leaked = _shingles(text)
    if not leaked:
        return {}
    scores: dict[str, float] = {}
    for a in answers:
        overlap = len(leaked & _shingles(a["text"])) / len(leaked)
        if overlap > scores.get(a["agent"], 0):
            scores[a["agent"]] = overlap
    return {k: round(v, 2) for k, v in scores.items() if v >= 0.3}
