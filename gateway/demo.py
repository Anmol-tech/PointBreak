"""Runs the demo scenarios from dashboard buttons, one at a time, in a background thread."""

import threading
import time

SCENARIOS = {
    "team": "BuyerCo agent team",
    "stolen": "Stolen token attack",
    "scrape": "Split scraping attack",
    "leak": "Leak trace",
}


def _team():
    from party.runner import run_team
    return run_team(pause=1.2)


def _stolen():
    from scripts.stolen_token_attack import run
    results = run("finance-agent")
    blocked = sum(1 for _, denied in results if denied)
    return f"Attacker replayed finance-agent's token twice; {blocked} of 2 attempts blocked"


def _scrape():
    from scripts.split_scrape_attack import run
    party = run(pause=0.35)
    return f"RivalBid reached {party['coverage']:.0%} coverage; locked={party['locked']}"


def _leak():
    from scripts.leak_demo import run
    with_marks, _ = run("legal-agent")
    if not with_marks["matches"]:
        return "No matching agent found"
    return "Leak traced to " + " ← ".join(reversed(with_marks["matches"][0]["chain"]))


RUNNERS = {"team": _team, "stolen": _stolen, "scrape": _scrape, "leak": _leak}

HINTS = {
    "unknown agent": "Run 'BuyerCo agent team' first.",
    "not registered": "Run 'BuyerCo agent team' first.",
    "revoked": "Some agents are revoked. Click Reset demo first.",
    "locked": "That company is locked. Click Reset demo first.",
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
