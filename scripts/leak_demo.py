"""A vendor answer shows up outside the company; Falcon traces it back to the exact agent chain.

Usage: python -m scripts.leak_demo [agent-name]
"""

import re
import sys

import httpx

from party.client import GATEWAY_URL, PROXY_URL, McpAgent


def run(agent: str = "contracts-reviewer", proxy: str = PROXY_URL, gateway: str = GATEWAY_URL) -> tuple[dict, dict]:
    text, denied = McpAgent(agent, proxy).tool("ask_question", question="What are the Globex change of control terms?")
    if denied:
        raise SystemExit(f"{agent} could not get an answer: {text}")
    leaked = text.splitlines()[1] if len(text.splitlines()) > 1 else text
    clean = re.sub("[​‌﻿]", "", leaked)
    print(f"Leaked paragraph found on a public forum:\n  {clean}\n")
    with_marks = httpx.post(f"{gateway}/api/trace", json={"text": leaked}, timeout=10).json()
    stripped = httpx.post(f"{gateway}/api/trace", json={"text": clean}, timeout=10).json()
    for label, res in (("copied as-is", with_marks), ("invisible marks stripped", stripped)):
        if res["matches"]:
            m = res["matches"][0]
            print(f"{label}: traced to {' ← '.join(reversed(m['chain']))} via {m['method']} ({m['confidence']:.0%})")
        else:
            print(f"{label}: no match")
    return with_marks, stripped


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "contracts-reviewer")
