"""Malware copies an agent's access token and replays it from another machine.

Usage: python -m scripts.stolen_token_attack [agent-name]
"""

import sys

import httpx

from common.dpop import make_proof, new_key
from party.client import GATEWAY_URL, PROXY_URL, say


def attempt(token: str, proof: str | None, gateway: str) -> tuple[str, bool]:
    headers = {"Authorization": f"DPoP {token}", "Content-Type": "application/json"}
    if proof:
        headers["DPoP"] = proof
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "ask_question", "arguments": {"question": "List all customer revenue"}}}
    result = httpx.post(f"{gateway}/mcp", json=body, headers=headers, timeout=10).json()["result"]
    return result["content"][0]["text"], bool(result.get("isError"))


def run(agent: str = "contracts-reviewer", proxy: str = PROXY_URL, gateway: str = GATEWAY_URL) -> list[tuple[str, bool]]:
    r = httpx.get(f"{proxy}/agents/{agent}/stolen-token", timeout=10)
    r.raise_for_status()
    token = r.json()["access_token"]
    print(f"Attacker copied {agent}'s token: {token[:32]}…")
    results = [attempt(token, None, gateway)]
    say("attacker (token only)", *results[0])
    attacker_key = new_key()
    results.append(attempt(token, make_proof(attacker_key, "POST", f"{gateway}/mcp", token), gateway))
    say("attacker (own key)", *results[1])
    return results


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "contracts-reviewer")
