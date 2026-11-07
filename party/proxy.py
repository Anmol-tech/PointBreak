"""Party-side agent runtime: holds each agent's private key, gets tokens, signs DPoP proofs.

Agents (OpenCode, the runner) talk plain MCP to http://localhost:9001/agents/<name>/mcp
and never hold a key or token themselves.
"""

import json
import time

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from common.config import load
from common.dpop import make_proof, new_key
from party.idp import IdPError, PartyIdP

JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"
ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"

cfg = load()
TOKEN_URL = f"{cfg['gateway_url']}/token"
MCP_URL = f"{cfg['gateway_url']}/mcp"
idps = {name: PartyIdP(cfg, name, p["users"]) for name, p in cfg["parties"].items()}
agents: dict[str, dict] = {}
http = httpx.Client(timeout=20)

app = FastAPI(title="Party agent runtime + IdPs")


class PartyError(Exception):
    pass


def _store_token(a: dict, resp: httpx.Response):
    body = resp.json()
    if resp.status_code != 200:
        raise PartyError(body.get("error_description", body))
    a.update(token=body["access_token"], exp=time.time() + body["expires_in"], agent_id=body["agent_id"],
             granted_scope=body["scope"].split(), granted_folders=body["folders"])


def obtain_root(a: dict):
    idp = idps[a["party"]]
    try:
        id_token = idp.login(a["user"])
        assertion = idp.id_jag(id_token, a["name"], " ".join(a["scope"] or []))
    except IdPError as e:
        raise PartyError(str(e))
    proof = make_proof(a["key"], "POST", TOKEN_URL)
    _store_token(a, http.post(TOKEN_URL, data={"grant_type": JWT_BEARER, "assertion": assertion},
                              headers={"DPoP": proof}))


def obtain_child(a: dict):
    parent = agents[a["parent"]]
    ensure_token(parent)
    data = {
        "grant_type": TOKEN_EXCHANGE,
        "subject_token": parent["token"],
        "subject_token_type": ACCESS_TOKEN_TYPE,
        "actor_name": a["name"],
        "actor_proof": make_proof(a["key"], "POST", TOKEN_URL),  # child proves it holds its own key
    }
    if a["scope"]:
        data["scope"] = " ".join(a["scope"])
    if a["folders"]:
        data["folders"] = json.dumps(a["folders"])
    proof = make_proof(parent["key"], "POST", TOKEN_URL, parent["token"])  # parent proves possession
    _store_token(a, http.post(TOKEN_URL, data=data, headers={"DPoP": proof}))


def ensure_token(a: dict):
    if not a.get("token") or a["exp"] - time.time() < 30:
        obtain_child(a) if a["parent"] else obtain_root(a)


def new_agent(name, party, user, parent=None, scope=None, folders=None) -> dict:
    a = {"name": name, "party": party, "user": user, "parent": parent, "scope": scope, "folders": folders,
         "key": new_key(), "token": None, "exp": 0}
    ensure_token(a)
    agents[name] = a
    return a


def public(a: dict) -> dict:
    return {k: a.get(k) for k in ("name", "party", "user", "parent", "agent_id", "granted_scope", "granted_folders")}


@app.post("/agents")
async def create_root(request: Request):
    b = await request.json()
    if b["party"] not in idps:
        return JSONResponse({"error": f"unknown party {b['party']}"}, status_code=400)
    try:
        # Blocking calls run off the event loop: the gateway calls back here for our IdP's JWKS.
        a = await run_in_threadpool(new_agent, b["name"], b["party"], b["user"],
                                    scope=b.get("scope"), folders=b.get("folders"))
    except PartyError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    return public(a)


@app.post("/agents/{parent}/spawn")
async def spawn(parent: str, request: Request):
    if parent not in agents:
        return JSONResponse({"error": f"unknown agent {parent}"}, status_code=404)
    b = await request.json()
    p = agents[parent]
    try:
        a = await run_in_threadpool(new_agent, b["name"], p["party"], p["user"], parent=parent,
                                    scope=b.get("scope"), folders=b.get("folders"))
    except PartyError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    return public(a)


@app.get("/agents")
def list_agents():
    return [public(a) for a in agents.values()]


def _deny_batch(payload, reason: str):
    """Answer each JSON-RPC request with a visible denial when no token can be obtained."""
    batch = payload if isinstance(payload, list) else [payload]
    out = []
    for m in batch:
        if m.get("id") is None:
            continue
        if m.get("method") == "tools/call":
            out.append({"jsonrpc": "2.0", "id": m["id"], "result": {
                "content": [{"type": "text", "text": f"⛔ VendorVault denied: {reason}"}], "isError": True}})
        else:
            out.append({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32001, "message": f"VendorVault: {reason}"}})
    if not out:
        return Response(status_code=202)
    return JSONResponse(out if isinstance(payload, list) else out[0])


@app.post("/agents/{name}/mcp")
async def forward(name: str, request: Request):
    body = await request.body()
    payload = json.loads(body or b"{}")
    oc = cfg["opencode_agent"]
    try:
        if name not in agents:
            if name != oc["name"]:
                return _deny_batch(payload, f"agent {name} is not registered")
            await run_in_threadpool(new_agent, oc["name"], oc["party"], oc["user"])
        a = agents[name]
        await run_in_threadpool(ensure_token, a)
    except PartyError as e:
        return _deny_batch(payload, str(e))
    resp = await run_in_threadpool(http.post, MCP_URL, content=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"DPoP {a['token']}",
        "DPoP": make_proof(a["key"], "POST", MCP_URL, a["token"]),
    })
    return Response(content=resp.content, status_code=resp.status_code,
                    media_type=resp.headers.get("content-type", "application/json"))


@app.get("/agents/{name}/mcp")
def forward_get(name: str):
    return Response(status_code=405)


@app.get("/agents/{name}/stolen-token")
def stolen_token(name: str):
    """Attack simulation only: what malware on the agent's machine could copy (the token, not the key)."""
    if name not in agents:
        return JSONResponse({"error": "unknown agent"}, status_code=404)
    return {"access_token": agents[name]["token"]}


@app.get("/idp/{party}/jwks")
def idp_jwks(party: str):
    return idps[party].jwks()


@app.get("/idp/{party}/status")
def idp_status(party: str):
    idp = idps[party]
    return {"party": party, "issuer": idp.issuer, "issuing": idp.issuing, "id_jags_issued": idp.issued}


@app.post("/idp/{party}/stop")
def idp_stop(party: str):
    idps[party].issuing = False
    return idp_status(party)


@app.post("/idp/{party}/resume")
def idp_resume(party: str):
    idps[party].issuing = True
    return idp_status(party)


@app.post("/reset")
def reset():
    agents.clear()
    for idp in idps.values():
        idp.issuing = True
    return {"reset": True}


@app.get("/healthz")
def healthz():
    return {"ok": True}
