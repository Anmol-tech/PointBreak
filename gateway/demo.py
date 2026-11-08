"""Runs the demo scenarios from dashboard buttons, one at a time, in a background thread."""

import threading
import time

import httpx

SCENARIOS = {
    "ai-team": "AI agent team",
    "team": "Scripted agent team",
    "onboard": "Onboard a new vendor",
    "stolen": "Stolen badge",
    "scrape": "Compromised vendor tool",
    "leak": "Leak trace",
}

ACTIVE_AGENTS = lambda: set()  # replaced by the gateway with its live view of active agents

NEW_VENDOR = {
    "name": "Northbeam",
    "purpose": "Customer market analysis",
    "contact": "maya@northbeam.co",
    "folders": ["Customers"],
    "scope": ["vault:ask", "vault:list"],
}


def _ai_team(note):
    """LexPartners' lead agent (Claude on Bedrock) plans the work and hands it to helper agents it creates."""
    from party.ai_team import run_ai_team
    result = run_ai_team(note=note, pace=2.0)
    return f"Memo by {result['engine']}:\n{result['memo']}"


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


def pick_agent() -> str:
    """An active agent to use as the target: a helper if there is one (the AI team names its own)."""
    from common.config import load
    cfg = load()
    vendor_side = {a["name"]: a for a in httpx.get(f"{cfg['party_sim_url']}/agents", timeout=5).json()}
    active = ACTIVE_AGENTS()  # names the gateway still lets in (set by gateway/app.py)
    names = [n for n in vendor_side if n in active]
    for want_helper in (True, False):
        for name in reversed(names):
            if bool(vendor_side[name]["parent"]) == want_helper:
                return name
    raise RuntimeError("unknown agent: no agents yet")


def _stolen():
    from scripts.stolen_token_attack import run
    target = pick_agent()
    try:
        results = run(target)
    except httpx.HTTPStatusError:
        raise RuntimeError(f"unknown agent {target}")
    blocked = sum(1 for _, denied in results if denied)
    return f"Attacker replayed {target}'s stolen credentials {len(results)} ways; {blocked} of {len(results)} blocked"


def _scrape():
    from scripts.split_scrape_attack import run
    party = run(pause=0.35)
    return f"Ledgerly's agents reached {party['coverage']:.0%} of its folders; locked={party['locked']}"


def _leak():
    from scripts.leak_demo import run
    with_marks, _ = run(pick_agent())
    if not with_marks["matches"]:
        return "No matching agent found"
    return "Leak traced to " + " ← ".join(reversed(with_marks["matches"][0]["chain"]))


TAKES_NOTES = {"ai-team"}
RUNNERS = {"ai-team": _ai_team, "team": _team, "onboard": _onboard, "stolen": _stolen, "scrape": _scrape, "leak": _leak}

HINTS = {
    "unknown agent": "Run 'AI agent team' first.",
    "not registered": "Run 'AI agent team' first.",
    "already a vendor": "Northbeam is already onboarded. Click Reset demo first.",
    "revoked": "Some agents are stopped. Click Reset demo first.",
    "locked": "That vendor is locked. Click Reset demo first.",
}


class DemoRunner:
    def __init__(self):
        self.running: str | None = None
        self.last: dict | None = None
        self.notes: list[dict] = []  # live narration from scenarios that think out loud (the AI team)
        self.lock = threading.Lock()
        self.on_change = lambda: None

    def status(self) -> dict:
        return {"running": self.running, "last": self.last, "scenarios": SCENARIOS, "notes": self.notes[-40:]}

    def note(self, text: str):
        self.notes.append({"ts": time.time(), "text": text})
        self.on_change()

    def start(self, name: str, on_change) -> bool:
        with self.lock:
            if self.running:
                return False
            self.running = name
            self.notes = []
            self.on_change = on_change
        on_change()
        threading.Thread(target=self._run, args=(name, on_change), daemon=True).start()
        return True

    def _run(self, name: str, on_change):
        started = time.time()
        try:
            runner = RUNNERS[name]
            message, ok = (runner(self.note) if name in TAKES_NOTES else runner()), True
        except (Exception, SystemExit) as e:  # leak_demo exits when the agent can't get an answer
            text = str(e) or e.__class__.__name__
            hint = next((h for key, h in HINTS.items() if key in text.lower()), "")
            message, ok = f"{text} {hint}".strip(), False
        self.last = {"name": name, "ok": ok, "message": message, "seconds": round(time.time() - started, 1)}
        self.running = None
        on_change()
