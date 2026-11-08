"""VendorVault gateway: agent identity (ID-JAG + DPoP + delegation), MCP tools, owner API."""

import asyncio
import json
import re
import secrets
from urllib.parse import parse_qs

import httpx
import jwt
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from common.cognito import CognitoError, load_config
from common.config import ROOT, issuer_for, load
from gateway.auth import COOKIE, SESSION_SECONDS, FalconSSO
from gateway.bedrock import BedrockError, BedrockWriter
import gateway.demo as demo_module
from gateway.demo import SCENARIOS, DemoRunner
from gateway.identity import AuthError, Identity
from gateway.protect import Masker, embed, extract, match_answers, roster_names
from gateway.store import MemoryStore
from gateway.vault_agent import VaultAgent

JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"

cfg = load()
store = MemoryStore()
vault = VaultAgent(ROOT / "dataroom", cfg["max_snippets"], cfg["max_snippet_chars"])
masker = Masker(roster_names(vault))
identity = Identity(cfg, store)
writer = BedrockWriter(cfg)
demo = DemoRunner()
demo_module.ACTIVE_AGENTS = lambda: {a["name"] for a in store.agents.values() if a["status"] == "active"
                                     and not store.parties.get(a["party"], {}).get("locked")}

sso = FalconSSO(load_config())

app = FastAPI(title="VendorVault gateway")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Called by vendor runtimes, not by Falcon staff: protected by the invite code / limited to one vendor's terms.
TERMS_PATH = re.compile(r"/api/vendors/[^/]+/terms")
VENDOR_FACING = ("/api/vendors/invite/", "/api/vendors/connect")


@app.middleware("http")
async def require_falcon_sign_in(request: Request, call_next):
    """With Cognito on, Falcon's owner API needs a signed-in workforce user; changes need falcon-admins."""
    path = request.url.path
    if sso.enabled and path.startswith("/api/") and not path.startswith(VENDOR_FACING) and not TERMS_PATH.fullmatch(path):
        user = sso.user(request.cookies.get(COOKIE))
        if not user:
            return JSONResponse({"error": "Sign in with Falcon SSO first", "login": "/auth/login"}, status_code=401)
        if request.method != "GET" and not user["admin"]:
            return JSONResponse({"error": f"{user['email']} is signed in but is not in falcon-admins"}, status_code=403)
        request.state.user = user
    return await call_next(request)


def by(request: Request) -> str:
    user = getattr(request.state, "user", None)
    return f" (by {user['email']})" if user else ""

TOOLS = [
    {
        "name": "list_folders",
        "description": "List the data-room folders and document outlines shared with you (titles and section headings only).",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "ask_question",
        "description": "Ask a due-diligence question. The seller's vault agent answers with short cited excerpts; documents are never released.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Your question about the deal documents"},
                "folder": {"type": "string", "description": "Optional folder to search, e.g. Contracts"},
            },
            "required": ["question"],
        },
    },
    {
        "name": "get_document",
        "description": "Download a full document from the data room.",
        "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
    },
    {
        "name": "export_all",
        "description": "Export every document in the data room.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]
TOOL_SCOPE = {"list_folders": "vault:list", "ask_question": "vault:ask",
              "get_document": "vault:read-raw", "export_all": "vault:export"}
SELECTABLE_TOOLS = ("list_folders", "ask_question")  # get_document / export_all can never be granted


def allowed_scope(agent: dict) -> set[str]:
    """Scopes on the agent's badge that Falcon still allows for its vendor right now."""
    party = store.parties.get(agent["party"]) or {}
    return set(agent["scope"]) & set(party.get("scope", []))


def visible_tools(agent: dict) -> list[dict]:
    """MCP tools/list only shows tools this agent may call."""
    scope = allowed_scope(agent)
    return [t for t in TOOLS if TOOL_SCOPE[t["name"]] in scope]


def invite_parties():
    """Vendors from config.json start already onboarded; new ones are added through /api/vendors."""
    for name, p in cfg["vendors"].items():
        store.add_party(name, issuer_for(cfg, name), p["folders"], p["scope"],
                        purpose=p.get("purpose", ""), contact=p.get("contact", ""))


invite_parties()


def endpoint_url(request: Request) -> str:
    # DPoP proofs are checked against the gateway's canonical URL, not the Host header.
    return f"{cfg['gateway_url']}{request.url.path}"


# --- coverage ---------------------------------------------------------------

def coverage(party_name: str) -> dict:
    party = store.parties[party_name]
    total = {s.id for s in vault.sections_in(party["folders"])}
    revealed = store.revealed.get(party_name, {})
    seen = set(revealed) & total
    per_agent: dict[str, set] = {}
    for sid in seen:
        for agent_id in revealed[sid]:
            per_agent.setdefault(agent_id, set()).add(sid)
    # Many agents each seeing a small slice looks like a scrape split up to dodge per-agent limits.
    biggest_share = max((len(s) for s in per_agent.values()), default=0) / len(seen) if seen else 0
    split = len(per_agent) >= 3 and len(seen) >= 5 and biggest_share <= 0.5
    return {
        "coverage": round(len(seen) / len(total), 3) if total else 0.0,
        "revealed": len(seen),
        "total": len(total),
        "agents_contributing": len(per_agent),
        "agent_sections": {a: len(s) for a, s in per_agent.items()},
        "split_scraping": split,
    }


def check_coverage(party_name: str):
    party = store.parties[party_name]
    cov = coverage(party_name)
    pct = cov["coverage"]
    split_note = f"; split scraping across {cov['agents_contributing']} agents" if cov["split_scraping"] else ""
    if pct >= cfg["coverage_lock"] and not party["locked"]:
        reason = f"coverage {pct:.0%} reached the {cfg['coverage_lock']:.0%} limit{split_note}"
        store.set_party_lock(party_name, True, reason)
        store.log(kind="lock", decision="alert", party=party_name, agent=None, chain=[party_name],
                  reason=f"Auto-locked {party_name}: {reason}")
    elif pct >= cfg["coverage_alert"] and not party["alerted"]:
        party["alerted"] = True
        store.log(kind="alert", decision="alert", party=party_name, agent=None, chain=[party_name],
                  reason=f"{party_name} has seen {pct:.0%} of its shared sections{split_note}")


# --- OAuth token endpoint -----------------------------------------------------

@app.post("/token")
async def token(request: Request):
    form = {k: v[0] for k, v in parse_qs((await request.body()).decode()).items()}
    proof = request.headers.get("dpop", "")
    url = endpoint_url(request)
    grant = form.get("grant_type")
    try:
        if grant == JWT_BEARER:
            # May fetch the party IdP's JWKS over the network, so keep it off the event loop.
            agent, tok, ttl = await run_in_threadpool(identity.issue_root, form.get("assertion", ""), proof, url)
            how = "agent badge issued from the vendor's ID-JAG"
        elif grant == TOKEN_EXCHANGE:
            scope = form["scope"].split() if form.get("scope") else None
            folders = json.loads(form["folders"]) if form.get("folders") else None
            agent, tok, ttl = identity.issue_child(form.get("subject_token", ""), proof, form.get("actor_proof", ""),
                                                   url, form.get("actor_name", ""), scope, folders)
            how = "sub-agent identity issued by token exchange"
        else:
            raise AuthError(f"unsupported grant_type {grant}")
    except AuthError as e:
        store.log(kind="token", decision="denied", party=None, agent=form.get("actor_name"), chain=[],
                  reason=f"Token refused: {e}")
        return JSONResponse({"error": "invalid_grant", "error_description": str(e)}, status_code=400)
    store.log(kind="token", decision="allowed", party=agent["party"], agent=agent["id"],
              chain=identity.chain_label(agent["id"]), reason=how,
              detail={"scope": agent["scope"], "folders": agent["folders"]})
    return {"access_token": tok, "token_type": "DPoP", "expires_in": ttl,
            "agent_id": agent["id"], "scope": " ".join(agent["scope"]), "folders": agent["folders"]}


@app.get("/.well-known/jwks.json")
def jwks():
    return identity.jwks()


@app.get("/.well-known/oauth-protected-resource")
def protected_resource():
    """RFC 9728 metadata, as the MCP authorization spec expects from an MCP server."""
    return {"resource": f"{cfg['gateway_url']}/mcp", "authorization_servers": [cfg["gateway_url"]],
            "scopes_supported": sorted(set(TOOL_SCOPE[t] for t in SELECTABLE_TOOLS)),
            "bearer_methods_supported": ["header"], "dpop_signing_alg_values_supported": ["ES256"],
            "dpop_bound_access_tokens_required": True, "resource_name": f"{cfg.get('client', 'Falcon')} vault"}


@app.get("/.well-known/oauth-authorization-server")
def authorization_server():
    """RFC 8414 metadata: agents get badges with an ID-JAG (JWT bearer) or by token exchange (sub-agents)."""
    return {"issuer": cfg["audience"], "token_endpoint": f"{cfg['gateway_url']}/token",
            "jwks_uri": f"{cfg['gateway_url']}/.well-known/jwks.json",
            "grant_types_supported": [JWT_BEARER, TOKEN_EXCHANGE],
            "token_endpoint_auth_methods_supported": ["none"],
            "dpop_signing_alg_values_supported": ["ES256"],
            "scopes_supported": sorted(set(TOOL_SCOPE[t] for t in SELECTABLE_TOOLS))}


# --- MCP endpoint -------------------------------------------------------------

def rpc_result(msg_id, result):
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def rpc_error(msg_id, code, message):
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def tool_text(text: str, is_error: bool = False) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def unverified_agent(token: str) -> str | None:
    try:
        return jwt.decode(token, options={"verify_signature": False}).get("agent_id")
    except jwt.PyJWTError:
        return None


def deny(agent_id, party, tool, reason, question=None):
    store.log(kind="call", decision="denied", party=party, agent=agent_id,
              chain=identity.chain_label(agent_id) if agent_id in store.agents else [],
              tool=tool, question=question, reason=reason)
    return tool_text(f"⛔ VendorVault denied: {reason}", is_error=True)


def call_tool(agent: dict, name: str, args: dict) -> dict:
    agent_id, party_name = agent["id"], agent["party"]
    question = args.get("question")
    if name not in TOOL_SCOPE:
        return deny(agent_id, party_name, name, f"unknown tool {name}")
    if name == "get_document":
        return deny(agent_id, party_name, name, "documents never leave the vault. Use ask_question instead")
    if name == "export_all":
        return deny(agent_id, party_name, name, "bulk export is never allowed")
    if TOOL_SCOPE[name] not in agent["scope"]:
        return deny(agent_id, party_name, name, f"tool {name} is not on this agent's badge")
    if TOOL_SCOPE[name] not in allowed_scope(agent):
        return deny(agent_id, party_name, name, f"Falcon has turned off {name} for {party_name}")

    party = store.parties[party_name]
    folders = [f for f in agent["folders"] if f in party["folders"]]

    if name == "list_folders":
        lines = [f"Folders shared with {agent['name']} ({party_name}). Outlines only; documents are not released."]
        for d in vault.index(folders):
            lines.append(f"- {d['folder']} / {d['title']}: " + "; ".join(d["headings"]))
        store.log(kind="call", decision="allowed", party=party_name, agent=agent_id,
                  chain=identity.chain_label(agent_id), tool=name, reason="outline only")
        return tool_text("\n".join(lines))

    question = (question or "").strip()
    if not question:
        return deny(agent_id, party_name, name, "question is empty")
    if args.get("folder"):
        wanted = {f.lower(): f for f in vault.folders()}.get(args["folder"].strip().lower(), args["folder"])
        if wanted not in folders:
            return deny(agent_id, party_name, name, f"folder '{wanted}' is not shared with this agent", question)
        folders = [wanted]

    result = vault.answer(question, folders)
    text = masker.mask(result["answer"])
    engine = "local search"
    if result["citations"] and writer.enabled:
        try:
            # Excerpts are masked before the model sees them, so it can't leak personal data.
            excerpts = [(c["source"], masker.mask(vault.context(c["section_id"]))) for c in result["citations"]]
            text = masker.mask(writer.compose(question, excerpts))
            engine = f"{writer.label} on Bedrock"
        except BedrockError as e:
            engine = f"local search (Bedrock unavailable: {e})"
    section_ids = [c["section_id"] for c in result["citations"]]
    if section_ids:
        store.reveal(party_name, section_ids, agent_id)
    store.record_answer(agent_id, text)
    store.log(kind="call", decision="allowed", party=party_name, agent=agent_id,
              chain=identity.chain_label(agent_id), tool=name, question=question, answer=text,
              sources=[c["source"] for c in result["citations"]],
              reason=f"answered from {len(section_ids)} masked excerpt(s) by {engine}; fingerprint {agent['fingerprint']}")
    check_coverage(party_name)
    return tool_text(embed(text, agent["fingerprint"]))


@app.post("/mcp")
async def mcp(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(rpc_error(None, -32700, "parse error"))
    batch = payload if isinstance(payload, list) else [payload]

    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    proof = request.headers.get("dpop")
    if not token:  # MCP authorization: tell the client where to get a token
        return JSONResponse(rpc_error(None, -32001, "VendorVault: no agent identity presented"), status_code=401,
                            headers={"WWW-Authenticate": f'DPoP algs="ES256", resource_metadata="{cfg["gateway_url"]}/.well-known/oauth-protected-resource"'})
    if scheme.lower() != "dpop":
        return JSONResponse(rpc_error(None, -32001, "VendorVault: use the DPoP token scheme"), status_code=401,
                            headers={"WWW-Authenticate": 'DPoP algs="ES256", error="invalid_token"'})
    auth: dict = {}

    def authenticate():
        if not auth:
            try:
                if not token:
                    raise AuthError("no agent identity presented")
                agent, _ = identity.verify_access(token, proof, "POST", endpoint_url(request))
                auth["agent"] = agent
            except AuthError as e:
                auth["error"] = str(e)
        return auth

    responses = []
    for msg in batch:
        method, msg_id = msg.get("method"), msg.get("id")
        if msg_id is None:  # notifications need no reply
            continue
        if method == "ping":
            responses.append(rpc_result(msg_id, {}))
            continue
        a = authenticate()
        if method == "tools/call":
            params = msg.get("params") or {}
            if "error" in a:
                agent_id = unverified_agent(token) if token else None
                party = store.agents[agent_id]["party"] if agent_id in store.agents else None
                responses.append(rpc_result(msg_id, deny(agent_id, party, params.get("name"), a["error"],
                                                         (params.get("arguments") or {}).get("question"))))
            else:
                result = await run_in_threadpool(call_tool, a["agent"], params.get("name"), params.get("arguments") or {})
                responses.append(rpc_result(msg_id, result))
            continue
        if "error" in a:
            responses.append(rpc_error(msg_id, -32001, f"VendorVault: {a['error']}"))
        elif method == "initialize":
            requested = (msg.get("params") or {}).get("protocolVersion") or "2025-06-18"
            responses.append(rpc_result(msg_id, {
                "protocolVersion": requested,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "vendorvault", "version": "0.1.0"},
                "instructions": "Deal data room. Ask questions with ask_question; documents are never released.",
            }))
        elif method == "tools/list":
            responses.append(rpc_result(msg_id, {"tools": visible_tools(a["agent"])}))
        else:
            responses.append(rpc_error(msg_id, -32601, f"method {method} not found"))

    if not responses:
        return Response(status_code=202)
    return JSONResponse(responses if isinstance(payload, list) else responses[0])


@app.get("/mcp")
def mcp_get():
    return Response(status_code=405)


# --- owner (seller) API -------------------------------------------------------

def agent_view(a: dict) -> dict:
    calls = sum(1 for e in store.events if e.get("agent") == a["id"] and e.get("kind") == "call")
    seen = sum(1 for agents in store.revealed.get(a["party"], {}).values() if a["id"] in agents)
    return {k: a[k] for k in ("id", "name", "party", "user", "parent", "status", "scope", "folders",
                              "created", "revoked_reason", "fingerprint", "jkt")} | {
        "chain": identity.chain_label(a["id"]), "calls": calls, "sections_seen": seen}


@app.get("/api/state")
def state():
    with store.lock:
        parties = [{**p, **coverage(p["name"])} for p in store.parties.values()]
        folders = []
        for f in vault.folders():
            folders.append({
                "name": f,
                "docs": [d["title"] for d in vault.docs.values() if d["folder"] == f],
                "shared_with": [p["name"] for p in store.parties.values() if f in p["folders"]],
            })
        return {
            "client": cfg.get("client", "Falcon Analytics"),
            "deal": cfg["deal"],
            "version": store.version,
            "thresholds": {"alert": cfg["coverage_alert"], "lock": cfg["coverage_lock"]},
            "parties": parties,
            "agents": [agent_view(a) for a in store.agents.values()],
            "folders": folders,
            "events": store.events[-200:],
            "demo": demo.status(),
            "answer_engine": f"{writer.label} on Bedrock" if writer.enabled else "local search",
        }


def _bump():
    with store.lock:
        store.bump()


@app.post("/api/demo/{name}")
def run_demo(name: str):
    if name not in SCENARIOS:
        return JSONResponse({"error": f"unknown scenario {name}"}, status_code=404)
    if not demo.start(name, _bump):
        return JSONResponse({"error": f"{demo.running} is still running"}, status_code=409)
    return JSONResponse({"started": name}, status_code=202)


@app.post("/api/vendors")
async def invite_vendor(request: Request):
    """Falcon onboards a new vendor: what work it does decides which folders and actions its agents get."""
    b = await request.json()
    name = (b.get("name") or "").strip()
    if not name or not name.replace("-", "").replace(" ", "").isalnum():
        return JSONResponse({"error": "Vendor name must be letters, numbers, spaces or dashes"}, status_code=400)
    name = name.replace(" ", "")
    if name in store.parties and store.parties[name]["status"] != "offboarded":
        return JSONResponse({"error": f"{name} is already a vendor"}, status_code=409)
    folders = [f for f in b.get("folders", []) if f in vault.folders()]
    scope = [s for s in b.get("scope", ["vault:ask", "vault:list"]) if s in ("vault:ask", "vault:list")]
    code = "VV-" + secrets.token_hex(2).upper() + "-" + secrets.token_hex(2).upper()
    store.add_party(name, None, folders, scope, purpose=(b.get("purpose") or "").strip(),
                    contact=(b.get("contact") or "").strip(), status="invited", invite_code=code)
    store.log(kind="vendor", decision="info", party=name, agent=None, chain=[name],
              reason=f"Invited {name} for “{store.parties[name]['purpose'] or 'unspecified work'}”. "
                     f"Its agents may ask about {', '.join(folders) or 'nothing yet'}. Invite code {code}{by(request)}")
    return {"name": name, "invite_code": code, "status": "invited"}


@app.get("/api/vendors/invite/{code}")
def lookup_invite(code: str):
    """What the invited vendor sees before accepting: who invited it, for what work, with what access."""
    party = store.party_by_invite(code.strip().upper())
    if not party:
        return JSONResponse({"error": "Invite code not found or already used"}, status_code=404)
    return {"name": party["name"], "client": cfg.get("client", "Falcon Analytics"), "purpose": party["purpose"],
            "folders": party["folders"], "scope": party["scope"], "contact": party["contact"]}


@app.get("/api/vendors/{name}/terms")
def vendor_terms(name: str):
    """The narrow view a vendor platform gets: only its own access terms, nothing about other vendors."""
    party = store.parties.get(name)
    if not party:
        return JSONResponse({"error": "unknown vendor"}, status_code=404)
    return {"name": name, "client": cfg.get("client", "Falcon Analytics"), "purpose": party["purpose"],
            "folders": party["folders"], "scope": party["scope"], "status": party["status"],
            "locked": party["locked"], "lock_reason": party["lock_reason"]}


@app.post("/api/vendors/connect")
async def connect_vendor(request: Request):
    """The vendor accepts the invite by registering its own company login (identity provider)."""
    b = await request.json()
    party = store.party_by_invite((b.get("invite_code") or "").strip().upper())
    if not party:
        return JSONResponse({"error": "Invite code not found or already used"}, status_code=404)
    issuer = (b.get("issuer") or "").rstrip("/")
    try:
        # Prove the vendor's login is reachable and publishes signing keys before trusting it.
        resp = await run_in_threadpool(httpx.get, f"{issuer}/jwks", timeout=5)
        resp.raise_for_status()
        if not resp.json().get("keys"):
            raise ValueError("no signing keys")
    except (httpx.HTTPError, ValueError) as e:
        return JSONResponse({"error": f"Could not verify the vendor's login at {issuer} ({e})"}, status_code=400)
    with store.lock:
        party.update(issuer=issuer, status="active", invite_code=None)
        store.bump()
    identity.jwks_cache.pop(issuer, None)
    store.log(kind="vendor", decision="allowed", party=party["name"], agent=None, chain=[party["name"]],
              reason=f"{party['name']} connected its company login ({issuer}). Its agents can now get badges.")
    return {"name": party["name"], "status": "active", "folders": party["folders"], "scope": party["scope"],
            "purpose": party["purpose"]}


@app.post("/api/vendors/{name}/offboard")
def offboard_vendor(name: str, request: Request):
    if name not in store.parties:
        return JSONResponse({"error": "unknown vendor"}, status_code=404)
    roots = [a["id"] for a in store.agents.values() if a["party"] == name and not a["parent"]]
    for agent_id in roots:
        store.revoke_agent(agent_id, f"{name} was offboarded")
    with store.lock:
        store.parties[name].update(status="offboarded", locked=True, lock_reason="vendor offboarded", invite_code=None)
        store.bump()
    store.log(kind="vendor", decision="alert", party=name, agent=None, chain=[name],
              reason=f"Offboarded {name}: its login is no longer trusted and all its agents were stopped{by(request)}")
    return {"offboarded": name}


@app.post("/api/agents/{agent_id}/revoke")
def revoke(agent_id: str, request: Request):
    if agent_id not in store.agents:
        return JSONResponse({"error": "unknown agent"}, status_code=404)
    ids = store.revoke_agent(agent_id, "revoked by data-room owner")
    a = store.agents[agent_id]
    extra = f" and {len(ids) - 1} sub-agent(s)" if len(ids) > 1 else ""
    store.log(kind="revoke", decision="alert", party=a["party"], agent=agent_id,
              chain=identity.chain_label(agent_id), reason=f"Owner revoked {a['name']}{extra}{by(request)}")
    return {"revoked": ids}


@app.post("/api/parties/{name}/lock")
def lock_party(name: str, request: Request):
    store.set_party_lock(name, True, "locked by data-room owner")
    store.log(kind="lock", decision="alert", party=name, agent=None, chain=[name],
              reason=f"Owner locked every {name} agent out of the deal{by(request)}")
    return {"locked": name}


@app.post("/api/parties/{name}/unlock")
def unlock_party(name: str, request: Request):
    store.set_party_lock(name, False, None)
    store.log(kind="lock", decision="info", party=name, agent=None, chain=[name], reason=f"Owner unlocked {name}{by(request)}")
    return {"unlocked": name}


@app.post("/api/parties/{name}/folders")
async def set_folders(name: str, request: Request):
    body = await request.json()
    folders = [f for f in body.get("folders", []) if f in vault.folders()]
    with store.lock:
        store.parties[name]["folders"] = folders
        store.bump()
    store.log(kind="share", decision="info", party=name, agent=None, chain=[name],
              reason=f"Shared folders for {name}: {', '.join(folders) or 'none'}")
    return {"folders": folders}


@app.post("/api/parties/{name}/tools")
async def set_tools(name: str, request: Request):
    if name not in store.parties:
        return JSONResponse({"error": f"unknown vendor {name}"}, status_code=404)
    tools = [t for t in (await request.json()).get("tools", []) if t in SELECTABLE_TOOLS]
    with store.lock:
        store.parties[name]["scope"] = sorted(TOOL_SCOPE[t] for t in tools)
        store.bump()
    store.log(kind="share", decision="info", party=name, agent=None, chain=[name],
              reason=f"MCP tools allowed for {name}: {', '.join(tools) or 'none'}{by(request)}")
    return {"tools": tools}


@app.post("/api/trace")
async def trace(request: Request):
    text = (await request.json()).get("text", "")
    matches = []
    for fp in extract(text):
        agent_id = store.fingerprints.get(fp)
        if agent_id:
            matches.append({"agent_id": agent_id, "chain": identity.chain_label(agent_id),
                            "method": "invisible fingerprint", "confidence": 1.0})
    if not matches:
        for agent_id, score in sorted(match_answers(text, store.answers).items(), key=lambda x: -x[1]):
            matches.append({"agent_id": agent_id, "chain": identity.chain_label(agent_id),
                            "method": "text match with served answers", "confidence": score})
    if matches:
        top = matches[0]
        store.log(kind="trace", decision="alert", party=store.agents[top["agent_id"]]["party"],
                  agent=top["agent_id"], chain=top["chain"],
                  reason=f"Leaked text traced to {' ← '.join(reversed(top['chain']))} ({top['method']})")
    else:
        store.log(kind="trace", decision="info", party=None, agent=None, chain=[],
                  reason="Leak trace: no matching agent")
    return {"matches": matches}


@app.post("/api/reset")
def reset():
    store.reset()
    identity.jwks_cache.clear()
    invite_parties()
    demo.last = None
    demo.notes = []
    try:  # also forget the party side's agents and re-enable its IdPs
        httpx.post(f"{cfg['party_sim_url']}/reset", timeout=3)
    except httpx.HTTPError:
        pass
    return {"reset": True}


@app.get("/api/events/stream")
async def stream(request: Request):
    async def gen():
        last, idle = -1, 0
        while not await request.is_disconnected():
            if store.version != last:
                last, idle = store.version, 0
                yield f"data: {json.dumps({'version': last})}\n\n"
            else:
                idle += 1
                if idle % 40 == 0:
                    yield ": keep-alive\n\n"
            await asyncio.sleep(0.25)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/auth/me")
def auth_me(request: Request):
    if not sso.enabled:
        return {"enabled": False, "user": None}
    user = sso.user(request.cookies.get(COOKIE))
    return {"enabled": True, "provider": "Amazon Cognito", "pool": sso.conf["pool_id"], "user": user}


@app.get("/auth/login")
def auth_login():
    if not sso.enabled:
        return RedirectResponse("/")
    return RedirectResponse(sso.login_url())


@app.get("/auth/callback")
async def auth_callback(code: str = "", state: str = "", error: str = ""):
    if error or not code:
        return RedirectResponse(f"/?login_error={error or 'missing_code'}")
    try:
        sid = await run_in_threadpool(sso.finish, code, state)
    except CognitoError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    user = sso.user(sid)
    store.log(kind="share", decision="info", party=None, agent=None, chain=[],
              reason=f"{user['email']} signed in to the control center with Falcon SSO (Amazon Cognito)")
    resp = RedirectResponse("/")
    resp.set_cookie(COOKIE, sid, httponly=True, samesite="lax", max_age=SESSION_SECONDS)
    return resp


@app.get("/auth/logout")
def auth_logout(request: Request):
    if not sso.enabled:
        return RedirectResponse("/")
    resp = RedirectResponse(sso.logout_url(request.cookies.get(COOKIE)))
    resp.delete_cookie(COOKIE)
    return resp


@app.get("/healthz")
def healthz():
    return {"ok": True}


dist = ROOT / "dashboard" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="dashboard")
