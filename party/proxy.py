"""Vendor-side runtime: each vendor's company login (IdP) plus the agent key holder.

In real life every vendor runs this in its own environment; for the demo one process
simulates all of them. Agents (OpenCode, the runner) talk plain MCP to
http://localhost:9001/agents/<name>/mcp and never hold a key or token themselves.
The /api/vendor endpoints feed the vendor portal: onboarding, agents, what came back.
"""

import json
import time

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from common.cognito import load_config
from common.config import ROOT, load
from common.dpop import make_proof, new_key, public_jwk, thumbprint
from party.idp import IdPError, PartyIdP

JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"
ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"

cfg = load()
TOKEN_URL = f"{cfg['gateway_url']}/token"
MCP_URL = f"{cfg['gateway_url']}/mcp"


cognito = load_config()


def configured_idps() -> dict[str, PartyIdP]:
    return {name: PartyIdP(cfg, name, p["users"], (cognito or {}).get("vendors", {}).get(name), (cognito or {}).get("region"))
            for name, p in cfg["vendors"].items()}


idps = configured_idps()
agents: dict[str, dict] = {}
history: list[dict] = []
http = httpx.Client(timeout=30)

app = FastAPI(title="Party agent runtime + IdPs")
# Browsers may call the vendor runtime only from pages on this machine (the portal, Falcon's dev server),
# so a website open in the same browser can't start agents here.
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])


class PartyError(Exception):
    pass


def record(**entry):
    """The vendor's own log of what its agents did and received."""
    entry.setdefault("ts", time.time())
    entry["id"] = (history[-1]["id"] + 1) if history else 1
    history.append(entry)
    del history[:-300]


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
        # The agent's key thumbprint goes into the ID-JAG: the vendor vouches for this exact workload.
        assertion = idp.id_jag(id_token, a["name"], " ".join(a["scope"] or []), thumbprint(public_jwk(a["key"])))
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
    try:
        ensure_token(a)
    except PartyError as e:
        record(kind="badge", party=party, agent=name, user=user, parent=parent, decision="denied", reason=str(e))
        raise
    agents[name] = a
    record(kind="badge", party=party, agent=name, user=user, parent=parent, decision="allowed",
           folders=a["granted_folders"], scope=a["granted_scope"])
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


def _deny_body(payload, reason: str):
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
        return None
    return out if isinstance(payload, list) else out[0]


def _record_calls(name: str, party: str | None, payload, body):
    requests = payload if isinstance(payload, list) else [payload]
    replies = body if isinstance(body, list) else [body] if body else []
    by_id = {r.get("id"): r for r in replies if isinstance(r, dict)}
    for m in requests:
        if m.get("method") != "tools/call" or m.get("id") not in by_id:
            continue
        result = by_id[m["id"]].get("result") or {}
        text = "".join(c.get("text", "") for c in result.get("content", []))
        denied = bool(result.get("isError")) or "error" in by_id[m["id"]]
        params = m.get("params") or {}
        record(kind="call", party=party, agent=name, tool=params.get("name"), args=params.get("arguments") or {},
               decision="denied" if denied else "allowed", text=text,
               reason=text.replace("⛔ VendorVault denied: ", "") if denied else None)


async def _process(name: str, payload):
    """Send one MCP message (or batch) to the gateway as agent `name`."""
    oc = cfg["opencode_agent"]
    party = agents[name]["party"] if name in agents else (oc["party"] if name == oc["name"] else None)
    try:
        if name not in agents:
            if name != oc["name"]:
                raise PartyError(f"agent {name} is not registered")
            await run_in_threadpool(new_agent, oc["name"], oc["party"], oc["user"])
        a = agents[name]
        await run_in_threadpool(ensure_token, a)
    except PartyError as e:
        body = _deny_body(payload, str(e))
        _record_calls(name, party, payload, body)
        return body
    resp = await run_in_threadpool(http.post, MCP_URL, json=payload, headers={
        "Accept": "application/json, text/event-stream",
        "Authorization": f"DPoP {a['token']}",
        "DPoP": make_proof(a["key"], "POST", MCP_URL, a["token"]),
    })
    body = resp.json() if resp.content else None
    _record_calls(name, party, payload, body)
    return body


@app.post("/agents/{name}/mcp")
async def forward(name: str, request: Request):
    body = await _process(name, json.loads(await request.body() or b"{}"))
    return Response(status_code=202) if body is None else JSONResponse(body)


@app.get("/agents/{name}/mcp")
def forward_get(name: str):
    return Response(status_code=405)


@app.post("/agents/{name}/ask")
async def ask(name: str, request: Request):
    """Vendor portal: send one tool call through an agent and return what came back."""
    b = await request.json()
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": b.get("tool", "ask_question"), "arguments": b.get("arguments") or {}}}
    body = await _process(name, payload) or {}
    result = body.get("result") or {}
    text = "".join(c.get("text", "") for c in result.get("content", [])) or body.get("error", {}).get("message", "")
    return {"text": text, "denied": bool(result.get("isError")) or "error" in body}


@app.get("/agents/{name}/intercepted-id-jag")
def intercepted_id_jag(name: str):
    """Attack simulation only: an ID-JAG copied in transit. It is bound to the agent's key, not the attacker's."""
    if name not in agents or agents[name]["parent"]:
        return JSONResponse({"error": "unknown lead agent"}, status_code=404)
    a = agents[name]
    idp = idps[a["party"]]
    try:
        assertion = idp.id_jag(idp.login(a["user"]), a["name"], "", thumbprint(public_jwk(a["key"])))
    except IdPError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    return {"assertion": assertion}


@app.get("/agents/{name}/stolen-token")
def stolen_token(name: str):
    """Attack simulation only: what malware on the agent's machine could copy (the token, not the key)."""
    if name not in agents:
        return JSONResponse({"error": "unknown agent"}, status_code=404)
    return {"access_token": agents[name]["token"]}


def _agent_status(name: str) -> str:
    calls = [h for h in history if h["agent"] == name and h["kind"] == "call"]
    reason = (calls[-1].get("reason") or "").lower() if calls else ""
    if "revoked" in reason:
        return "stopped"
    if "locked" in reason:
        return "locked"
    return "active"


@app.post("/api/vendor/onboard")
async def onboard(request: Request):
    """A new vendor accepts Falcon's invite: create its company login, then register it with VendorVault."""
    b = await request.json()
    code = (b.get("invite_code") or "").strip().upper()
    users = [u.strip() for u in b.get("users", []) if "@" in u]
    if not users:
        return JSONResponse({"error": "Add at least one employee email"}, status_code=400)
    # The invite, not the vendor, decides which company this is.
    invite = await run_in_threadpool(http.get, f"{cfg['gateway_url']}/api/vendors/invite/{code}")
    if invite.status_code != 200:
        return JSONResponse({"error": invite.json().get("error", "Invite not found")}, status_code=404)
    name = invite.json()["name"]
    if name in idps:
        return JSONResponse({"error": f"{name} already has a company login here"}, status_code=409)
    idp = PartyIdP(cfg, name, users)
    idps[name] = idp  # must exist before VendorVault calls back for its signing keys
    resp = await run_in_threadpool(http.post, f"{cfg['gateway_url']}/api/vendors/connect",
                                   json={"invite_code": code, "issuer": idp.issuer})
    body = resp.json()
    if resp.status_code != 200:
        del idps[name]
        return JSONResponse({"error": body.get("error", "Falcon rejected the invite")}, status_code=resp.status_code)
    record(kind="onboard", party=name, agent="", decision="allowed",
           reason=f"Connected company login {idp.issuer}", folders=body["folders"], scope=body["scope"])
    return {**body, "issuer": idp.issuer, "users": users}


@app.get("/api/vendor/invite/{code}")
async def preview_invite(code: str):
    resp = await run_in_threadpool(http.get, f"{cfg['gateway_url']}/api/vendors/invite/{code.strip().upper()}")
    return JSONResponse(resp.json(), status_code=resp.status_code)


@app.post("/api/vendor/{party}/signin")
async def employee_sign_in(party: str, request: Request):
    """An employee signs in with the vendor's company login (Amazon Cognito when configured)."""
    if party not in idps:
        return JSONResponse({"error": f"unknown vendor {party}"}, status_code=404)
    b = await request.json()
    try:
        who = await run_in_threadpool(idps[party].sign_in, (b.get("email") or "").strip(), b.get("password") or "")
    except IdPError as e:
        return JSONResponse({"error": str(e)}, status_code=401)
    record(kind="signin", party=party, agent="", user=who["email"], decision="allowed",
           reason=f"{who['email']} signed in with {party}'s company login (Amazon Cognito)")
    return who


@app.post("/api/vendor/{party}/users")
async def add_user(party: str, request: Request):
    if party not in idps:
        return JSONResponse({"error": f"unknown vendor {party}"}, status_code=404)
    user = ((await request.json()).get("user") or "").strip()
    if "@" not in user:
        return JSONResponse({"error": "Enter an employee email"}, status_code=400)
    idps[party].users.add(user)
    return {"users": idps[party].employees()}


@app.get("/api/vendors")
def vendor_list():
    return [{"name": n, "issuer": i.issuer, "issuing": i.issuing,
             "agents": sum(1 for a in agents.values() if a["party"] == n)} for n, i in idps.items()]


@app.get("/api/vendor/{party}")
def vendor_state(party: str):
    if party not in idps:
        return JSONResponse({"error": f"unknown vendor {party}"}, status_code=404)
    idp, now = idps[party], time.time()
    mine = [{**public(a), "expires_in": max(0, int(a["exp"] - now)) if a.get("token") else 0,
             "status": _agent_status(a["name"])} for a in agents.values() if a["party"] == party]
    try:  # the vendor only learns its own terms from Falcon, never Falcon's dashboard data
        terms = http.get(f"{cfg['gateway_url']}/api/vendors/{party}/terms", timeout=5)
        access = terms.json() if terms.status_code == 200 else None
    except httpx.HTTPError:
        access = None
    return {
        "client": cfg.get("client", "Falcon Analytics"),
        "access": access,
        "party": party,
        "issuer": idp.issuer,
        "issuing": idp.issuing,
        "id_jags_issued": idp.issued,
        "users": idp.employees(),
        "sso": {"provider": idp.sso, "pool_id": (idp.cognito or {}).get("pool_id"), "signed_in": sorted(idp.sessions)},
        "deal": cfg["deal"],
        "agents": mine,
        "history": [h for h in history if h["party"] == party][-150:],
    }


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
    history.clear()
    idps.clear()
    idps.update(configured_idps())  # vendors onboarded during the demo are forgotten
    return {"reset": True}


@app.get("/healthz")
def healthz():
    return {"ok": True}


# The vendor platform (a separate web app from Falcon's dashboard) is served from here.
DIST = ROOT / "dashboard" / "dist"


@app.get("/")
def vendor_portal():
    page = DIST / "vendor.html"
    if not page.exists():
        return JSONResponse({"error": "Vendor portal not built yet. Run ./run.sh or npm --prefix dashboard run build"}, status_code=503)
    return FileResponse(page)


if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
