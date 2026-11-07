"""End-to-end check of the required A10 demo, vendor onboarding, multi-agent delegation and data protection.

Starts its own gateway (:8100) and vendor runtime (:9101), so it can run beside a live demo.
Usage: .venv/bin/python -m tests.e2e_test
"""

import os
import re
import subprocess
import sys
import time

GATEWAY, PROXY = "http://127.0.0.1:8100", "http://127.0.0.1:9101"
# VAULT_LLM=off keeps answers deterministic even if a Bedrock key is loaded in this shell.
os.environ.update(GATEWAY_URL=GATEWAY, PARTY_SIM_URL=PROXY, NO_COLOR="1", VAULT_LLM="off")

import httpx  # noqa: E402
import jwt  # noqa: E402

from common.dpop import make_proof, new_key  # noqa: E402
from party.client import McpAgent, PartyError, create_root, spawn  # noqa: E402
from scripts import leak_demo, split_scrape_attack, stolen_token_attack  # noqa: E402

FAILED: list[str] = []
SSN = re.compile(r"\d{3}-\d{2}-\d{4}")
INVISIBLE = re.compile("[​‌﻿]")
JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"


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


def forged_token_request(claims: dict, key) -> httpx.Response:
    assertion = jwt.encode(claims, key, "ES256", headers={"typ": "oauth-id-jag+jwt"})
    return httpx.post(f"{GATEWAY}/token", data={"grant_type": JWT_BEARER, "assertion": assertion},
                      headers={"DPoP": make_proof(key, "POST", f"{GATEWAY}/token")})


def ask(agent: McpAgent, question: str, folder: str | None = None) -> tuple[str, bool]:
    text, denied = agent.tool("ask_question", **({"question": question, "folder": folder} if folder else {"question": question}))
    return INVISIBLE.sub("", text), denied


def main():
    procs = [start("gateway.app:app", 8100), start("party.proxy:app", 9101)]
    try:
        wait(GATEWAY)
        wait(PROXY)

        # 1. No identity at all
        r = mcp_raw({})
        check("no token is denied", r["isError"] and "no agent identity" in r["content"][0]["text"], str(r))

        # 2. Forged ID-JAGs never become tokens
        k, now = new_key(), int(time.time())
        forged = {"iss": f"{PROXY}/idp/LexPartners", "sub": "dana@lexpartners.com", "aud": "https://vendorvault.local",
                  "client_id": "evil", "resource": "project-falcon", "iat": now, "exp": now + 300, "jti": "x1"}
        resp = forged_token_request(forged, k)
        check("ID-JAG signed by the wrong key is refused", resp.status_code == 400 and "signature" in resp.text, resp.text)
        resp = forged_token_request({**forged, "iss": "https://idp.evil.example", "jti": "x2"}, k)
        check("ID-JAG from a non-vendor is refused", resp.status_code == 400 and "not an onboarded vendor" in resp.text, resp.text)

        # 3. Authenticate a vendor's agent and use an allowed tool
        lead_info = create_root("LexPartners", "dana@lexpartners.com", "lex-lead", proxy=PROXY)
        check("agent badge is limited to the vendor's folders",
              lead_info["granted_folders"] == ["Contracts", "Customers"], str(lead_info))
        lead = McpAgent("lex-lead", PROXY)
        check("authenticated agent can initialize MCP", "result" in lead.initialize())
        tools = [t["name"] for t in lead.rpc("tools/list")["result"]["tools"]]
        check("tools are listed", "ask_question" in tools, str(tools))
        text, denied = ask(lead, "Key contacts email phone", "Customers")
        check("allowed question is answered", not denied and "Answer from" in text, text)
        check("contact names, emails and phones are masked",
              "@" not in text and "555" not in text and "Dana Whitfield" not in text, text)

        # 4. Disallowed tools, folders outside the vendor's work, unshared folders
        text, denied = lead.tool("get_document", path="Contracts/globex-customer-agreement.md")
        check("get_document is denied", denied and "never leave the vault" in text, text)
        text, denied = lead.tool("export_all")
        check("export_all is denied", denied, text)
        text, denied = ask(lead, "quarterly revenue", "Financials")
        check("folder outside the vendor's work is denied", denied and "not shared" in text, text)
        text, denied = ask(lead, "minimum price", "Board Minutes")
        check("unshared folder is denied", denied and "not shared" in text, text)

        # 5. Tables only leave as totals (Ledgerly's audit work covers HR)
        create_root("Ledgerly", "li@ledgerly.io", "ledgerly-check", proxy=PROXY)
        text, denied = ask(McpAgent("ledgerly-check", PROXY), "Key employees email SSN salary", "HR")
        check("table rows never leave, only totals", not denied and "row-level data withheld" in text and not SSN.search(text), text)

        # 6. Sub-agents get narrower identities
        try:
            spawn("lex-lead", "greedy-agent", folders=["Financials"], proxy=PROXY)
            check("helper asking for more than its parent is refused", False, "spawn succeeded")
        except PartyError as e:
            check("helper asking for more than its parent is refused", "more access than its parent" in str(e), str(e))
        spawn("lex-lead", "contracts-reviewer", folders=["Contracts"], proxy=PROXY)
        spawn("lex-lead", "customer-reviewer", folders=["Customers"], proxy=PROXY)
        contracts, customers = McpAgent("contracts-reviewer", PROXY), McpAgent("customer-reviewer", PROXY)
        text, denied = ask(customers, "top customers")
        check("helper can ask in its own folder", not denied, text)
        text, denied = ask(customers, "change of control", "Contracts")
        check("helper cannot use its sibling's folder", denied, text)

        # 7. Stolen badge replay
        results = stolen_token_attack.run("contracts-reviewer", PROXY, GATEWAY)
        check("stolen badge without a proof is denied", results[0][1] and "DPoP proof required" in results[0][0], results[0][0])
        check("stolen badge with the attacker's key is denied", results[1][1] and "different key" in results[1][0], results[1][0])

        # 8. Leak tracing
        with_marks, stripped = leak_demo.run("contracts-reviewer", PROXY, GATEWAY)
        check("leak traced by invisible fingerprint",
              bool(with_marks["matches"]) and with_marks["matches"][0]["agent_id"] == "LexPartners:contracts-reviewer", str(with_marks))
        check("leak traced by text match when marks are stripped",
              bool(stripped["matches"]) and stripped["matches"][0]["agent_id"] == "LexPartners:contracts-reviewer", str(stripped))

        # 9. Revocation mid-task: one agent, then the whole branch
        httpx.post(f"{GATEWAY}/api/agents/LexPartners:customer-reviewer/revoke")
        text, denied = ask(customers, "top customers")
        check("stopped agent's next call is blocked", denied and "revoked" in text, text)
        text, denied = ask(contracts, "Northwind fees")
        check("sibling keeps working after a stop", not denied, text)
        httpx.post(f"{GATEWAY}/api/agents/LexPartners:lex-lead/revoke")
        text, denied = ask(contracts, "Northwind fees")
        check("stopping the parent cascades to helpers", denied and "revoked" in text, text)
        try:
            create_root("LexPartners", "dana@lexpartners.com", "lex-lead", proxy=PROXY)
            check("stopped agent cannot re-authenticate", False, "re-auth succeeded")
        except PartyError as e:
            check("stopped agent cannot re-authenticate", "revoked" in str(e), str(e))

        # 10. The vendor's own admin stops issuing badges
        httpx.post(f"{PROXY}/idp/LexPartners/stop")
        try:
            create_root("LexPartners", "omar@lexpartners.com", "omar-agent", proxy=PROXY)
            check("vendor login stop blocks new agents", False, "agent created")
        except PartyError as e:
            check("vendor login stop blocks new agents", "stopped issuing" in str(e), str(e))
        httpx.post(f"{PROXY}/idp/LexPartners/resume")

        # 11. Onboarding a brand-new vendor
        invite = httpx.post(f"{GATEWAY}/api/vendors", json={"name": "Northbeam", "purpose": "Customer market analysis",
                                                            "contact": "maya@northbeam.co", "folders": ["Customers"]}).json()
        code = invite.get("invite_code", "")
        check("Falcon creates an invite for a new vendor", invite.get("status") == "invited" and code.startswith("VV-"), str(invite))
        state = httpx.get(f"{GATEWAY}/api/state").json()
        nb = next(p for p in state["parties"] if p["name"] == "Northbeam")
        check("invited vendor is not trusted yet", nb["status"] == "invited" and nb["issuer"] is None, str(nb))
        preview = httpx.get(f"{PROXY}/api/vendor/invite/{code}").json()
        check("vendor sees who invited it and for what work",
              preview.get("purpose") == "Customer market analysis" and preview.get("folders") == ["Customers"], str(preview))
        bad = httpx.post(f"{PROXY}/api/vendor/onboard", json={"invite_code": "VV-0000-0000", "users": ["maya@northbeam.co"]})
        check("wrong invite code is refused", bad.status_code == 404, bad.text)
        joined = httpx.post(f"{PROXY}/api/vendor/onboard", json={"invite_code": code, "users": ["maya@northbeam.co"]})
        check("vendor connects its company login", joined.status_code == 200 and joined.json()["status"] == "active", joined.text)
        again = httpx.post(f"{PROXY}/api/vendor/onboard", json={"invite_code": code, "users": ["x@evil.co"]})
        check("invite code cannot be reused", again.status_code in (404, 409), again.text)
        nb_info = create_root("Northbeam", "maya@northbeam.co", "northbeam-analyst", proxy=PROXY)
        check("new vendor's agent gets a badge scoped to its work", nb_info["granted_folders"] == ["Customers"], str(nb_info))
        analyst = McpAgent("northbeam-analyst", PROXY)
        text, denied = ask(analyst, "largest customers")
        check("new vendor's agent can ask within its scope", not denied, text)
        text, denied = ask(analyst, "change of control", "Contracts")
        check("new vendor's agent is blocked outside its scope", denied and "not shared" in text, text)

        # 12. Offboarding stops everything
        httpx.post(f"{GATEWAY}/api/vendors/Northbeam/offboard")
        text, denied = ask(analyst, "largest customers")
        check("offboarded vendor's agents are blocked", denied, text)
        try:
            create_root("Northbeam", "maya@northbeam.co", "northbeam-2", proxy=PROXY)
            check("offboarded vendor cannot get new badges", False, "agent created")
        except PartyError as e:
            check("offboarded vendor cannot get new badges", "not an onboarded vendor" in str(e), str(e))

        # 13. A compromised vendor tool splits its scraping across agents and trips the vendor-wide lock
        party = split_scrape_attack.run(PROXY, GATEWAY, pause=0)
        check("split scraping locks the whole vendor", party["locked"], str(party))
        check("split scraping is detected", "split scraping" in (party["lock_reason"] or ""), str(party))
        text, denied = ask(McpAgent("ledgerly-worker-1", PROXY), "revenue")
        check("locked vendor's agents are blocked", denied and "locked" in text, text)

        state = httpx.get(f"{GATEWAY}/api/state").json()
        check("dashboard state lists agents and events", len(state["agents"]) >= 10 and len(state["events"]) > 15,
              f"{len(state['agents'])} agents, {len(state['events'])} events")
    finally:
        for p in procs:
            p.terminate()
            p.wait()
    print(f"\n{'ALL PASSED' if not FAILED else f'{len(FAILED)} FAILED: ' + ', '.join(FAILED)}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
