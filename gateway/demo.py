"""Runs the demo scenarios from dashboard buttons, one at a time, in a background thread."""

import threading
import time

import httpx

SCENARIOS = {
    "team": "Vendor agent team",
    "onboard": "Onboard a new vendor",
    "stolen": "Stolen badge",
    "scrape": "Compromised vendor tool",
    "leak": "Leak trace",
}

NEW_VENDOR = {
    "name": "Northbeam",
    "purpose": "Customer market analysis",
    "contact": "maya@northbeam.co",
    "folders": ["Customers"],
    "scope": ["vault:ask", "vault:list"],
}


def _team():
    from party.runner import run_team
    return run_team(pause=1.2)


def _onboard():
    """Falcon invites a new vendor, the vendor connects its login, then its first agent gets a scoped badge."""
    from common.config import load
    from party.client import McpAgent, create_root
    cfg = load()
    invite = httpx.post(f"{cfg['gateway_url']}/api/vendors", json=NEW_VENDOR, timeout=10)
    if invite.status_code != 200:
        raise RuntimeError(invite.json().get("error", "invite failed"))
    code = invite.json()["invite_code"]
    time.sleep(2.5)  # let the audience see the vendor sitting in "Invited"
    joined = httpx.post(f"{cfg['party_sim_url']}/api/vendor/onboard",
                        json={"invite_code": code, "users": [NEW_VENDOR["contact"]]}, timeout=20)
    if joined.status_code != 200:
        raise RuntimeError(joined.json().get("error", "vendor could not connect"))
    time.sleep(2)
    create_root("Northbeam", NEW_VENDOR["contact"], "northbeam-analyst")
    agent = McpAgent("northbeam-analyst")
    agent.tool("ask_question", question="Which customers are the largest and how concentrated is revenue?")
    agent.tool("ask_question", question="What are the Globex change of control terms?", folder="Contracts")
    return f"Northbeam onboarded with invite {code}: its agent asked about Customers and was blocked from Contracts"


def _stolen():
    from scripts.stolen_token_attack import run
    try:
        results = run("contracts-reviewer")
    except httpx.HTTPStatusError:
        raise RuntimeError("unknown agent contracts-reviewer")
    blocked = sum(1 for _, denied in results if denied)
    return f"Attacker replayed contracts-reviewer's badge twice; {blocked} of 2 attempts blocked"


def _scrape():
    from scripts.split_scrape_attack import run
    party = run(pause=0.35)
    return f"Ledgerly's agents reached {party['coverage']:.0%} of its folders; locked={party['locked']}"


def _leak():
    from scripts.leak_demo import run
    with_marks, _ = run("contracts-reviewer")
    if not with_marks["matches"]:
        return "No matching agent found"
    return "Leak traced to " + " ← ".join(reversed(with_marks["matches"][0]["chain"]))


RUNNERS = {"team": _team, "onboard": _onboard, "stolen": _stolen, "scrape": _scrape, "leak": _leak}

HINTS = {
    "unknown agent": "Run 'Vendor agent team' first.",
    "not registered": "Run 'Vendor agent team' first.",
    "already a vendor": "Northbeam is already onboarded. Click Reset demo first.",
    "revoked": "Some agents are stopped. Click Reset demo first.",
    "locked": "That vendor is locked. Click Reset demo first.",
}


class DemoRunner:
    def __init__(self):
        self.running: str | None = None
        self.last: dict | None = None
        self.lock = threading.Lock()

    def status(self) -> dict:
        return {"running": self.running, "last": self.last, "scenarios": SCENARIOS}

    def start(self, name: str, on_change) -> bool:
        with self.lock:
            if self.running:
                return False
            self.running = name
        on_change()
        threading.Thread(target=self._run, args=(name, on_change), daemon=True).start()
        return True

    def _run(self, name: str, on_change):
        started = time.time()
        try:
            message, ok = RUNNERS[name](), True
        except (Exception, SystemExit) as e:  # leak_demo exits when the agent can't get an answer
            text = str(e) or e.__class__.__name__
            hint = next((h for key, h in HINTS.items() if key in text.lower()), "")
            message, ok = f"{text} {hint}".strip(), False
        self.last = {"name": name, "ok": ok, "message": message, "seconds": round(time.time() - started, 1)}
        self.running = None
        on_change()
