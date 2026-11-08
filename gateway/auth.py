"""Falcon workforce sign-in with Amazon Cognito (OIDC authorization code + PKCE).

The gateway does the code exchange server-side and keeps the session on the server;
the browser only gets an HttpOnly cookie. Only members of the falcon-admins group may
change anything (stop agents, lock or onboard vendors, run demos).
"""

import hashlib
import secrets
import time
from urllib.parse import urlencode

import httpx

from common.cognito import CognitoError, verify_id_token
from common.dpop import b64url

ADMIN_GROUP = "falcon-admins"
COOKIE = "vv_session"
SESSION_SECONDS = 8 * 3600  # a demo day; the Cognito ID token itself only lives 1 hour


class FalconSSO:
    def __init__(self, conf: dict | None):
        self.conf = conf["falcon"] if conf else None
        self.region = conf["region"] if conf else None
        self.pending: dict[str, tuple[str, float]] = {}
        self.sessions: dict[str, dict] = {}

    @property
    def enabled(self) -> bool:
        return self.conf is not None

    def _base(self) -> str:
        return f"https://{self.conf['domain']}.auth.{self.region}.amazoncognito.com"

    def login_url(self) -> str:
        state = secrets.token_urlsafe(16)
        verifier = secrets.token_urlsafe(48)
        self.pending[state] = (verifier, time.time())
        challenge = b64url(hashlib.sha256(verifier.encode()).digest())
        query = urlencode({
            "response_type": "code",
            "client_id": self.conf["client_id"],
            "redirect_uri": self.conf["redirect_uri"],
            "scope": "openid email profile",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })
        return f"{self._base()}/oauth2/authorize?{query}"

    def finish(self, code: str, state: str) -> str:
        verifier, started = self.pending.pop(state, (None, 0))
        if not verifier or time.time() - started > 600:
            raise CognitoError("sign-in expired or was not started here; try again")
        resp = httpx.post(f"{self._base()}/oauth2/token", timeout=10, data={
            "grant_type": "authorization_code",
            "client_id": self.conf["client_id"],
            "code": code,
            "redirect_uri": self.conf["redirect_uri"],
            "code_verifier": verifier,
        })
        if resp.status_code != 200:
            raise CognitoError(f"Cognito refused the sign-in code ({resp.text[:160]})")
        claims = verify_id_token(resp.json()["id_token"], self.conf["issuer"], self.conf["client_id"])
        sid = secrets.token_urlsafe(32)
        self.sessions[sid] = {
            "email": claims.get("email"),
            "name": claims.get("name") or claims.get("email"),
            "groups": claims.get("cognito:groups", []),
            "exp": time.time() + SESSION_SECONDS,
            "issuer": claims["iss"],
        }
        return sid

    def user(self, sid: str | None) -> dict | None:
        session = self.sessions.get(sid or "")
        if session and session["exp"] > time.time():
            return {**session, "admin": ADMIN_GROUP in session["groups"]}
        return None

    def logout_url(self, sid: str | None) -> str:
        self.sessions.pop(sid or "", None)
        return f"{self._base()}/logout?" + urlencode({"client_id": self.conf["client_id"], "logout_uri": self.conf["logout_uri"]})
