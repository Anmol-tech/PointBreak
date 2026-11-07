"""End-to-end check of the required A10 demo plus the multi-agent and data-protection features.

Starts its own gateway (:8100) and party runtime (:9101), so it can run beside a live demo.
Usage: .venv/bin/python -m tests.e2e_test
"""

import os
import re
import subprocess
import sys
import time

GATEWAY, PROXY = "http://127.0.0.1:8100", "http://127.0.0.1:9101"
os.environ.update(GATEWAY_URL=GATEWAY, PARTY_SIM_URL=PROXY, NO_COLOR="1")

import httpx  # noqa: E402
import jwt  # noqa: E402

from common.dpop import make_proof, new_key  # noqa: E402
from party.client import McpAgent, PartyError, create_root, spawn  # noqa: E402
from scripts import leak_demo, split_scrape_attack, stolen_token_attack  # noqa: E402

FAILED: list[str] = []
SSN = re.compile(r"\d{3}-\d{2}-\d{4}")
INVISIBLE = re.compile("[​‌﻿]")


def check(name: str, cond: bool, detail: str = ""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n     {detail[:400]}"))
    if not cond:
        FAILED.append(name)


def start(module: str, port: int) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-m", "uvicorn", module, "--port", str(port), "--log-level", "warning"],
                            env=os.environ.copy())


def wait(url: str):
    for _ in range(50):
        try:
            if httpx.get(f"{url}/healthz", timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise SystemExit(f"{url} did not start")


def mcp_raw(headers: dict) -> dict:
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "ask_question", "arguments": {"question": "revenue"}}}
    return httpx.post(f"{GATEWAY}/mcp", json=body, headers=headers, timeout=10).json()["result"]


def main():
    procs = [start("gateway.app:app", 8100), start("party.proxy:app", 9101)]
    try:
        wait(GATEWAY)
        wait(PROXY)

        # 1. No identity at all
        r = mcp_raw({})
        check("no token is denied", r["isError"] and "no agent identity" in r["content"][0]["text"], str(r))

        # 2. Forged ID-JAGs never become tokens
        k = new_key()
        now = int(time.time())
        forged = {"iss": f"{PROXY}/idp/BuyerCo", "sub": "alice@buyerco.com", "aud": "https://vendorvault.local",
                  "client_id": "evil", "resource": "project-falcon", "iat": now, "exp": now + 300, "jti": "x1"}
        hdr = {"typ": "oauth-id-jag+jwt"}
        resp = httpx.post(f"{GATEWAY}/token", data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                                     "assertion": jwt.encode(forged, k, "ES256", headers=hdr)},
                          headers={"DPoP": make_proof(k, "POST", f"{GATEWAY}/token")})
        check("ID-JAG signed by the wrong key is refused", resp.status_code == 400 and "signature" in resp.text, resp.text)
        forged.update(iss="https://idp.evil.example", jti="x2")
        resp = httpx.post(f"{GATEWAY}/token", data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                                     "assertion": jwt.encode(forged, k, "ES256", headers=hdr)},
                          headers={"DPoP": make_proof(k, "POST", f"{GATEWAY}/token")})
        check("ID-JAG from an untrusted issuer is refused", resp.status_code == 400 and "not a party" in resp.text, resp.text)

        # 3. Authenticate a real agent and use an allowed tool
        create_root("BuyerCo", "alice@buyerco.com", "buyer-orchestrator", proxy=PROXY)
        boss = McpAgent("buyer-orchestrator", PROXY)
        init = boss.initialize()
        check("authenticated agent can initialize MCP", "result" in init, str(init))
        tools = [t["name"] for t in boss.rpc("tools/list")["result"]["tools"]]
        check("tools are listed", "ask_question" in tools, str(tools))
        text, denied = boss.tool("ask_question", question="Key employees email SSN salary", folder="HR")
        text = INVISIBLE.sub("", text)
        check("allowed question is answered", not denied and "Answer from" in text, text)
        check("table rows never leave, only totals", "row-level data withheld" in text and not SSN.search(text), text)
        text, denied = boss.tool("ask_question", question="Key contacts email phone", folder="Customers")
        text = INVISIBLE.sub("", text)
        check("contact names, emails and phones are masked",
              not denied and "@" not in text and "555" not in text and "Dana Whitfield" not in text, text)

        # 4. Disallowed tools and folders
        text, denied = boss.tool("get_document", path="HR/employee-roster.md")
        check("get_document is denied", denied and "never leave the vault" in text, text)
        text, denied = boss.tool("export_all")
        check("export_all is denied", denied, text)
        text, denied = boss.tool("ask_question", question="minimum price", folder="Board Minutes")
        check("unshared folder is denied", denied and "not shared" in text, text)

        # 5. Sub-agents get narrower identities
        try:
            spawn("buyer-orchestrator", "greedy-agent", folders=["Board Minutes"], proxy=PROXY)
            check("sub-agent asking for more than its parent is refused", False, "spawn succeeded")
        except PartyError as e:
            check("sub-agent asking for more than its parent is refused", "more access than its parent" in str(e), str(e))
        spawn("buyer-orchestrator", "legal-agent", folders=["Contracts", "Customers"], proxy=PROXY)
        spawn("buyer-orchestrator", "finance-agent", folders=["Financials"], proxy=PROXY)
        legal, finance = McpAgent("legal-agent", PROXY), McpAgent("finance-agent", PROXY)
        text, denied = finance.tool("ask_question", question="quarterly revenue")
        check("finance sub-agent can ask in its folder", not denied, text)
        text, denied = finance.tool("ask_question", question="change of control", folder="Contracts")
        check("finance sub-agent cannot use legal's folder", denied, text)

        # 6. Stolen token replay
        results = stolen_token_attack.run("finance-agent", PROXY, GATEWAY)
        check("stolen token without a proof is denied", results[0][1] and "DPoP proof required" in results[0][0], results[0][0])
        check("stolen token with the attacker's key is denied", results[1][1] and "different key" in results[1][0], results[1][0])

        # 7. Leak tracing
        with_marks, stripped = leak_demo.run("legal-agent", PROXY, GATEWAY)
        check("leak traced by invisible fingerprint",
              bool(with_marks["matches"]) and with_marks["matches"][0]["agent_id"] == "BuyerCo:legal-agent", str(with_marks))
        check("leak traced by text match when marks are stripped",
              bool(stripped["matches"]) and stripped["matches"][0]["agent_id"] == "BuyerCo:legal-agent", str(stripped))

        # 8. Revocation mid-task: one agent, then the whole branch
        httpx.post(f"{GATEWAY}/api/agents/BuyerCo:finance-agent/revoke")
        text, denied = finance.tool("ask_question", question="quarterly revenue")
        check("revoked agent's next call is blocked", denied and "revoked" in text, text)
        text, denied = legal.tool("ask_question", question="Northwind fees")
        check("sibling keeps working after revoke", not denied, text)
        httpx.post(f"{GATEWAY}/api/agents/BuyerCo:buyer-orchestrator/revoke")
        text, denied = legal.tool("ask_question", question="Northwind fees")
        check("revoking the parent cascades to sub-agents", denied and "revoked" in text, text)
        try:
            create_root("BuyerCo", "alice@buyerco.com", "buyer-orchestrator", proxy=PROXY)
            check("revoked agent cannot re-authenticate", False, "re-auth succeeded")
        except PartyError as e:
            check("revoked agent cannot re-authenticate", "revoked" in str(e), str(e))

        # 9. Party admin stops issuing ID-JAGs
        httpx.post(f"{PROXY}/idp/BuyerCo/stop")
        try:
            create_root("BuyerCo", "bob@buyerco.com", "bob-agent", proxy=PROXY)
            check("party IdP stop blocks new agents", False, "agent created")
        except PartyError as e:
            check("party IdP stop blocks new agents", "stopped issuing" in str(e), str(e))
        httpx.post(f"{PROXY}/idp/BuyerCo/resume")

        # 10. Split scraping across several agents trips the company-wide coverage lock
        party = split_scrape_attack.run(PROXY, GATEWAY, pause=0)
        check("split scraping locks the whole company", party["locked"], str(party))
        check("split scraping is detected", "split scraping" in (party["lock_reason"] or ""), str(party))
        text, denied = McpAgent("rival-worker-1", PROXY).tool("ask_question", question="revenue")
        check("locked company's agents are blocked", denied and "locked" in text, text)

        state = httpx.get(f"{GATEWAY}/api/state").json()
        check("dashboard state lists agents and events", len(state["agents"]) >= 8 and len(state["events"]) > 10,
              f"{len(state['agents'])} agents, {len(state['events'])} events")
    finally:
        for p in procs:
            p.terminate()
            p.wait()
    print(f"\n{'ALL PASSED' if not FAILED else f'{len(FAILED)} FAILED: ' + ', '.join(FAILED)}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
