"""Agent identity: ID-JAG verification, DPoP-bound access tokens, delegation chains."""

import json
import secrets
import time
import uuid

import httpx
import jwt

from common.dpop import DPoPError, key_from_jwk, new_key, public_jwk, thumbprint, verify_proof

ID_JAG_TYP = "oauth-id-jag+jwt"


class AuthError(Exception):
    pass


def nested_act(chain_ids: list[str]) -> dict | None:
    """RFC 8693 `act` claim: current actor outermost, earlier actors nested inside."""
    act = None
    for agent_id in chain_ids:
        act = {"sub": agent_id, **({"act": act} if act else {})}
    return act


class Identity:
    def __init__(self, cfg: dict, store):
        self.cfg, self.store = cfg, store
        self.key = new_key()
        self.public = self.key.public_key()
        self.jwks_cache: dict[str, dict] = {}

    # --- party issuers (federation) -----------------------------------
    def _issuer_key(self, issuer: str, kid: str | None, refresh: bool = False):
        if refresh or issuer not in self.jwks_cache:
            resp = httpx.get(f"{issuer}/jwks", timeout=5)
            resp.raise_for_status()
            self.jwks_cache[issuer] = {k.get("kid"): k for k in resp.json()["keys"]}
        keys = self.jwks_cache[issuer]
        jwk = keys.get(kid) or next(iter(keys.values()))
        return key_from_jwk({k: jwk[k] for k in ("kty", "crv", "x", "y")})

    def verify_id_jag(self, assertion: str) -> tuple[dict, dict]:
        try:
            header = jwt.get_unverified_header(assertion)
            unverified = jwt.decode(assertion, options={"verify_signature": False})
        except jwt.PyJWTError as e:
            raise AuthError(f"malformed ID-JAG ({e})")
        if header.get("typ") != ID_JAG_TYP:
            raise AuthError("assertion is not an ID-JAG")
        party = self.store.party_by_issuer(unverified.get("iss", ""))
        if not party:
            raise AuthError(f"issuer {unverified.get('iss')} is not an onboarded vendor")
        claims = None
        for refresh in (False, True):
            try:
                key = self._issuer_key(party["issuer"], header.get("kid"), refresh)
                claims = jwt.decode(
                    assertion,
                    key,
                    algorithms=["ES256"],
                    audience=self.cfg["audience"],
                    issuer=party["issuer"],
                    options={"require": ["iss", "sub", "aud", "exp", "iat", "jti", "client_id"]},
                )
                break
            except jwt.InvalidSignatureError:
                continue  # party may have rotated keys; refetch once
            except jwt.PyJWTError as e:
                raise AuthError(f"ID-JAG rejected ({e})")
            except httpx.HTTPError as e:
                raise AuthError(f"could not reach {party['name']}'s identity provider ({e})")
        if claims is None:
            raise AuthError("ID-JAG signature does not match the party's identity provider")
        if claims.get("resource") != self.cfg["deal"]:
            raise AuthError("ID-JAG is for a different deal")
        if not self.store.use_jti(f"idjag:{claims['jti']}", ttl=self.cfg["id_jag_ttl_seconds"]):
            raise AuthError("ID-JAG has already been used")
        return party, claims

    # --- tokens --------------------------------------------------------
    def mint(self, agent: dict) -> tuple[str, int]:
        now = int(time.time())
        ttl = self.cfg["token_ttl_seconds"]
        ids = [a["id"] for a in self.lineage(agent["id"])]
        claims = {
            "iss": self.cfg["audience"],
            "aud": self.cfg["audience"],
            "sub": agent["user"],
            "agent_id": agent["id"],
            "party": agent["party"],
            "deal": self.cfg["deal"],
            "scope": " ".join(agent["scope"]),
            "folders": agent["folders"],
            "act": nested_act(ids),
            "cnf": {"jkt": agent["jkt"]},
            "iat": now,
            "exp": now + ttl,
            "jti": uuid.uuid4().hex,
        }
        return jwt.encode(claims, self.key, algorithm="ES256"), ttl

    def lineage(self, agent_id: str) -> list[dict]:
        """Root first, this agent last."""
        out, current = [], self.store.agents.get(agent_id)
        while current:
            out.append(current)
            current = self.store.agents.get(current["parent"]) if current["parent"] else None
        return list(reversed(out))

    def chain_label(self, agent_id: str) -> list[str]:
        line = self.lineage(agent_id)
        if not line:
            return []
        return [line[0]["party"], line[0]["user"]] + [a["name"] for a in line]

    def _register(self, *, party: str, user: str, name: str, parent: str | None, scope, folders, jkt: str) -> dict:
        agent_id = f"{party}:{name}"
        existing = self.store.agents.get(agent_id)
        if existing and existing["status"] != "active":
            raise AuthError(f"agent {name} was revoked and cannot get new tokens")
        if existing and existing["parent"] != parent:
            raise AuthError(f"agent name {name} is already used by another branch")
        agent = existing or {
            "id": agent_id,
            "name": name,
            "party": party,
            "user": user,
            "parent": parent,
            "status": "active",
            "revoked_reason": None,
            "created": time.time(),
            "fingerprint": secrets.token_hex(3),
        }
        agent.update(scope=sorted(scope), folders=sorted(folders), jkt=jkt, last_token=time.time())
        self.store.upsert_agent(agent)
        return agent

    def issue_root(self, assertion: str, proof: str, token_url: str) -> tuple[dict, str, int]:
        party, claims = self.verify_id_jag(assertion)
        if party["locked"]:
            raise AuthError(f"{party['name']} is locked out of this deal")
        try:
            pop = verify_proof(proof, "POST", token_url)
        except DPoPError as e:
            raise AuthError(str(e))
        requested = set(claims.get("scope", "").split()) or set(party["scope"])
        agent = self._register(
            party=party["name"],
            user=claims["sub"],
            name=claims["client_id"],
            parent=None,
            scope=requested & set(party["scope"]),
            folders=party["folders"],
            jkt=pop["jkt"],
        )
        token, ttl = self.mint(agent)
        return agent, token, ttl

    def issue_child(self, parent_token: str, parent_proof: str, actor_proof: str, token_url: str,
                    name: str, scope: list[str] | None, folders: list[str] | None) -> tuple[dict, str, int]:
        parent, parent_claims = self.verify_access(parent_token, parent_proof, "POST", token_url)
        try:
            child_pop = verify_proof(actor_proof, "POST", token_url)
        except DPoPError as e:
            raise AuthError(f"sub-agent key proof invalid: {e}")
        want_scope = set(scope) if scope else set(parent["scope"])
        want_folders = set(folders) if folders else set(parent["folders"])
        extra = (want_scope - set(parent["scope"])) | (want_folders - set(parent["folders"]))
        if extra:
            raise AuthError(f"sub-agent cannot get more access than its parent (asked for {sorted(extra)})")
        child = self._register(
            party=parent["party"],
            user=parent["user"],
            name=name,
            parent=parent["id"],
            scope=want_scope,
            folders=want_folders,
            jkt=child_pop["jkt"],
        )
        token, ttl = self.mint(child)
        return child, token, ttl

    def verify_access(self, token: str, proof: str | None, method: str, url: str) -> tuple[dict, dict]:
        try:
            claims = jwt.decode(token, self.public, algorithms=["ES256"], audience=self.cfg["audience"],
                                issuer=self.cfg["audience"])
        except jwt.ExpiredSignatureError:
            raise AuthError("access token expired")
        except jwt.PyJWTError as e:
            raise AuthError(f"access token invalid ({e})")
        if not proof:
            raise AuthError("DPoP proof required: this token only works with the agent's own key")
        try:
            pop = verify_proof(proof, method, url, access_token=token)
        except DPoPError as e:
            raise AuthError(str(e))
        if pop["jkt"] != claims["cnf"]["jkt"]:
            raise AuthError("token is bound to a different key (stolen token?)")
        if not self.store.use_jti(f"dpop:{pop['jti']}", ttl=120):
            raise AuthError("DPoP proof replayed")
        agent = self.store.agents.get(claims["agent_id"])
        if not agent:
            raise AuthError("unknown agent")
        reason = self.store.chain_status(agent["id"])
        if reason:
            raise AuthError(reason)
        party = self.store.parties.get(agent["party"])
        if not party or party["locked"]:
            raise AuthError(f"{agent['party']} is locked out of this deal"
                            + (f": {party['lock_reason']}" if party and party["lock_reason"] else ""))
        return agent, claims

    def jwks(self) -> dict:
        return {"keys": [{**public_jwk(self.key), "kid": thumbprint(public_jwk(self.key)), "use": "sig", "alg": "ES256"}]}
