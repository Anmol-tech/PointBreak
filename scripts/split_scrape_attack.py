"""RivalBid splits a scrape across 5 sub-agents so no single agent looks suspicious.

Usage: python -m scripts.split_scrape_attack [--pause SECONDS]
"""

import argparse
import re
import time

import httpx

from party.client import GATEWAY_URL, PROXY_URL, McpAgent, PartyError, create_root, say, spawn


def run(proxy: str = PROXY_URL, gateway: str = GATEWAY_URL, pause: float = 0.4, workers: int = 5) -> dict:
    create_root("RivalBid", "mallory@rivalbid.com", "rival-orchestrator", proxy=proxy)
    names = [f"rival-worker-{i}" for i in range(1, workers + 1)]
    for n in names:
        spawn("rival-orchestrator", n, proxy=proxy)
    boss = McpAgent("rival-orchestrator", proxy)
    outline, _ = boss.tool("list_folders")

    # Turn every "Doc title: heading; heading" line into one targeted question per heading.
    questions = []
    for line in outline.splitlines()[1:]:
        m = re.match(r"- (.+?) / (.+?): (.+)", re.sub(r"[​‌﻿]", "", line))
        if m:
            questions += [f"{h} {m.group(2)}" for h in m.group(3).split("; ")]

    clients = [McpAgent(n, proxy) for n in names]
    for i, q in enumerate(questions):
        agent = clients[i % len(clients)]
        text, denied = agent.tool("ask_question", question=q)
        say(agent.name, text.splitlines()[0] if not denied else text, denied)
        if denied:
            break
        time.sleep(pause)
    state = httpx.get(f"{gateway}/api/state", timeout=10).json()
    return next(p for p in state["parties"] if p["name"] == "RivalBid")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pause", type=float, default=0.4)
    args = ap.parse_args()
    try:
        party = run(pause=args.pause)
    except PartyError as e:
        print(f"⛔ {e}")
        return
    print(f"\nRivalBid coverage {party['coverage']:.0%}, locked={party['locked']} ({party['lock_reason']})")


if __name__ == "__main__":
    main()
