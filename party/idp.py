"""A vendor's own identity provider (stands in for the vendor's Okta/Entra/Cognito).

It signs employees in (OIDC-style ID token) and, under the vendor's own policy, issues
ID-JAGs (IETF draft "Identity Assertion JWT Authorization Grant") that vouch for
the vendor's agents to VendorVault.
"""

import time
import uuid

import jwt

from common.config import issuer_for
from common.dpop import new_key, public_jwk, thumbprint

ID_JAG_TYP = "oauth-id-jag+jwt"


class IdPError(Exception):
    pass


class PartyIdP:
    def __init__(self, cfg: dict, name: str, users: list[str]):
        self.cfg, self.name, self.users = cfg, name, set(users)
        self.issuer = issuer_for(cfg, name)
        self.key = new_key()
        self.kid = thumbprint(public_jwk(self.key))
        self.issuing = True
        self.issued = 0

    def jwks(self) -> dict:
        return {"keys": [{**public_jwk(self.key), "kid": self.kid, "use": "sig", "alg": "ES256"}]}

    def login(self, user: str) -> str:
        """Simulated SSO: in a real deployment this is the party's normal employee login."""
        if user not in self.users:
            raise IdPError(f"{user} is not a {self.name} employee")
        now = int(time.time())
        claims = {"iss": self.issuer, "sub": user, "aud": f"{self.issuer}/agents", "iat": now,
                  "exp": now + 3600, "jti": uuid.uuid4().hex}
        return jwt.encode(claims, self.key, algorithm="ES256", headers={"kid": self.kid})

    def id_jag(self, id_token: str, client_id: str, scope: str = "") -> str:
        """Token exchange at the party IdP: user's ID token in, ID-JAG for VendorVault out."""
        if not self.issuing:
            raise IdPError(f"{self.name}'s admin has stopped issuing agent credentials for this deal")
        try:
            user = jwt.decode(id_token, self.key.public_key(), algorithms=["ES256"],
                              audience=f"{self.issuer}/agents", issuer=self.issuer)["sub"]
        except jwt.PyJWTError as e:
            raise IdPError(f"user session invalid ({e})")
        if user not in self.users:
            raise IdPError(f"{user} may not run agents on this deal")
        now = int(time.time())
        claims = {
            "iss": self.issuer,
            "sub": user,
            "aud": self.cfg["audience"],
            "client_id": client_id,
            "resource": self.cfg["deal"],
            "iat": now,
            "exp": now + self.cfg["id_jag_ttl_seconds"],
            "jti": uuid.uuid4().hex,
        }
        if scope:
            claims["scope"] = scope
        self.issued += 1
        return jwt.encode(claims, self.key, algorithm="ES256", headers={"typ": ID_JAG_TYP, "kid": self.kid})
