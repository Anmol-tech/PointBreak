"""In-memory state for the gateway. Every mutation bumps `version` so the dashboard can live-update."""

import threading
import time


class MemoryStore:
    def __init__(self):
        self.lock = threading.RLock()
        self.reset()

    def reset(self):
        with self.lock:
            self.parties: dict[str, dict] = {}
            self.agents: dict[str, dict] = {}
            self.events: list[dict] = []
            # party -> section_id -> set of agent ids that were shown it
            self.revealed: dict[str, dict[str, set]] = {}
            self.answers: list[dict] = []
            self.used_jti: dict[str, float] = {}
            self.fingerprints: dict[str, str] = {}
            self.version = 0

    def bump(self):
        self.version += 1

    # --- parties -------------------------------------------------------
    def add_party(self, name: str, issuer: str, folders: list[str], scope: list[str]):
        with self.lock:
            self.parties[name] = {
                "name": name,
                "issuer": issuer,
                "folders": list(folders),
                "scope": list(scope),
                "locked": False,
                "lock_reason": None,
                "alerted": False,
            }
            self.revealed.setdefault(name, {})
            self.bump()

    def party_by_issuer(self, issuer: str) -> dict | None:
        return next((p for p in self.parties.values() if p["issuer"] == issuer), None)

    def set_party_lock(self, name: str, locked: bool, reason: str | None):
        with self.lock:
            p = self.parties[name]
            p["locked"], p["lock_reason"] = locked, reason
            self.bump()

    # --- agents --------------------------------------------------------
    def upsert_agent(self, agent: dict):
        with self.lock:
            self.agents[agent["id"]] = agent
            self.fingerprints[agent["fingerprint"]] = agent["id"]
            self.bump()

    def chain_status(self, agent_id: str) -> str | None:
        """Return None if the agent and every ancestor are active, else the reason."""
        current = self.agents.get(agent_id)
        while current:
            if current["status"] != "active":
                if current["id"] == agent_id:
                    return f"agent {current['name']} has been revoked"
                return f"parent agent {current['name']} has been revoked"
            current = self.agents.get(current["parent"]) if current["parent"] else None
        return None

    def descendants(self, agent_id: str) -> list[str]:
        out, frontier = [], [agent_id]
        while frontier:
            parent = frontier.pop()
            kids = [a["id"] for a in self.agents.values() if a["parent"] == parent]
            out.extend(kids)
            frontier.extend(kids)
        return out

    def revoke_agent(self, agent_id: str, reason: str) -> list[str]:
        with self.lock:
            ids = [agent_id] + self.descendants(agent_id)
            for i in ids:
                self.agents[i]["status"] = "revoked"
                self.agents[i]["revoked_reason"] = reason
            self.bump()
            return ids

    # --- replay protection ----------------------------------------------
    def use_jti(self, jti: str, ttl: float = 300) -> bool:
        with self.lock:
            now = time.time()
            for k in [k for k, exp in self.used_jti.items() if exp < now]:
                del self.used_jti[k]
            if jti in self.used_jti:
                return False
            self.used_jti[jti] = now + ttl
            return True

    # --- coverage and answers ------------------------------------------
    def reveal(self, party: str, section_ids: list[str], agent_id: str):
        with self.lock:
            bucket = self.revealed.setdefault(party, {})
            for sid in section_ids:
                bucket.setdefault(sid, set()).add(agent_id)
            self.bump()

    def record_answer(self, agent_id: str, text: str):
        with self.lock:
            self.answers.append({"agent": agent_id, "text": text, "ts": time.time()})

    # --- events --------------------------------------------------------
    def log(self, **event) -> dict:
        with self.lock:
            event.setdefault("ts", time.time())
            event["id"] = len(self.events) + 1
            self.events.append(event)
            self.bump()
            return event
