"""Small helpers for scripts: create agents on the party runtime and call MCP tools."""

import os

import httpx

from common.config import load

PROXY_URL = load()["party_sim_url"]
GATEWAY_URL = load()["gateway_url"]


class PartyError(Exception):
    pass


def create_root(party: str, user: str, name: str, scope=None, folders=None, proxy: str = PROXY_URL) -> dict:
    r = httpx.post(f"{proxy}/agents", json={"party": party, "user": user, "name": name,
                                             "scope": scope, "folders": folders}, timeout=20)
    if r.status_code != 200:
        raise PartyError(r.json().get("error"))
    return r.json()


def spawn(parent: str, name: str, scope=None, folders=None, proxy: str = PROXY_URL) -> dict:
    r = httpx.post(f"{proxy}/agents/{parent}/spawn", json={"name": name, "scope": scope, "folders": folders},
                   timeout=20)
    if r.status_code != 200:
        raise PartyError(r.json().get("error"))
    return r.json()


class McpAgent:
    def __init__(self, name: str, proxy: str = PROXY_URL):
        self.name, self.url, self.n = name, f"{proxy}/agents/{name}/mcp", 0

    def rpc(self, method: str, params: dict | None = None) -> dict:
        self.n += 1
        r = httpx.post(self.url, json={"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}},
                       timeout=20)
        return r.json()

    def initialize(self) -> dict:
        return self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                       "clientInfo": {"name": "pointbreak-runner", "version": "0.1"}})

    def tool(self, name: str, **args) -> tuple[str, bool]:
        res = self.rpc("tools/call", {"name": name, "arguments": args})
        if "error" in res:
            return res["error"]["message"], True
        result = res["result"]
        return result["content"][0]["text"], bool(result.get("isError"))


def say(who: str, text: str, denied: bool = False):
    mark = "⛔" if denied else "✅"
    color = "\033[31m" if denied else "\033[32m"
    plain = os.environ.get("NO_COLOR")
    first = text.splitlines()[0] if text else ""
    print(f"{mark} {who}: " + (first if plain else f"{color}{first}\033[0m"))
    for line in text.splitlines()[1:]:
        print(f"     {line}")
