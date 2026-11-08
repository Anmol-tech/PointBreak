"""A vendor's identity service.

Employees sign in through the vendor's company login: a real Amazon Cognito user pool when
cognito.json configures one for this vendor, otherwise a simulated login. Under the vendor's
own policy, the service then issues ID-JAGs (IETF draft "Identity Assertion JWT Authorization
Grant") that vouch for the vendor's agents to VendorVault. Cognito has no native ID-JAG
support, so this service verifies Cognito's ID token and signs the ID-JAG itself.
"""

import time
import uuid

import jwt

from common.cognito import CognitoError, demo_passwords, initiate_auth, verify_id_token
from common.config import issuer_for
from common.dpop import new_key, public_jwk, thumbprint

ID_JAG_TYP = "oauth-id-jag+jwt"


class IdPError(Exception):
    pass


class PartyIdP:
    def __init__(self, cfg: dict, name: str, users: list[str], cognito: dict | None = None, region: str | None = None):
        self.cfg, self.name, self.users = cfg, name, set(users)
        self.cognito, self.region = cognito, region
        self.sessions: dict[str, dict] = {}  # employee email -> Cognito tokens
        self.issuer = issuer_for(cfg, name)
        self.key = new_key()
        self.kid = thumbprint(public_jwk(self.key))
        self.issuing = True
        self.issued = 0

    def jwks(self) -> dict:
        return {"keys": [{**public_jwk(self.key), "kid": self.kid, "use": "sig", "alg": "ES256"}]}

    @property
    def sso(self) -> str:
        return "Amazon Cognito" if self.cognito else "Simulated login"

    def employees(self) -> list[str]:
        return sorted(self.users | set(self.sessions))

    def sign_in(self, email: str, password: str) -> dict:
        """Real sign-in against the vendor's Cognito user pool."""
        if not self.cognito:
            raise IdPError(f"{self.name} uses a simulated login")
        try:
            tokens = initiate_auth(self.region, self.cognito["client_id"], {"USERNAME": email, "PASSWORD": password}, "USER_PASSWORD_AUTH")
            claims = verify_id_token(tokens["IdToken"], self.cognito["issuer"], self.cognito["client_id"])
        except CognitoError as e:
            raise IdPError(f"{self.name}'s company login refused {email}: {e}")
        self.sessions[claims["email"]] = {"id_token": tokens["IdToken"], "refresh_token": tokens.get("RefreshToken"),
                                          "exp": claims["exp"], "name": claims.get("name", claims["email"])}
        return {"email": claims["email"], "name": claims.get("name"), "provider": "Amazon Cognito"}

    def _cognito_token(self, user: str) -> str:
        session = self.sessions.get(user)
        if session and session["exp"] - time.time() > 60:
            return session["id_token"]
        if session and session.get("refresh_token"):
            try:
                tokens = initiate_auth(self.region, self.cognito["client_id"], {"REFRESH_TOKEN": session["refresh_token"]}, "REFRESH_TOKEN_AUTH")
                claims = verify_id_token(tokens["IdToken"], self.cognito["issuer"], self.cognito["client_id"])
                session.update(id_token=tokens["IdToken"], exp=claims["exp"])
                return session["id_token"]
            except CognitoError:
                pass
        password = demo_passwords().get(user)  # demo scenarios sign in as their seeded employees
        if password:
            self.sign_in(user, password)
            return self.sessions[user]["id_token"]
        raise IdPError(f"{user} must sign in with {self.name}'s company login (Amazon Cognito) first")

    def login(self, user: str) -> str:
        """Employee sign-in: a Cognito ID token when configured, otherwise a simulated one."""
        if self.cognito:
            return self._cognito_token(user)
        if user not in self.users:
            raise IdPError(f"{user} is not a {self.name} employee")
        now = int(time.time())
        claims = {"iss": self.issuer, "sub": user, "aud": f"{self.issuer}/agents", "iat": now,
                  "exp": now + 3600, "jti": uuid.uuid4().hex}
        return jwt.encode(claims, self.key, algorithm="ES256", headers={"kid": self.kid})

    def id_jag(self, id_token: str, client_id: str, scope: str = "", jkt: str | None = None) -> str:
        """Token exchange at the party IdP: user's ID token in, ID-JAG for VendorVault out.

        `jkt` is the thumbprint of the agent's own key (its workload identity). The ID-JAG carries it
        as a confirmation claim (RFC 7800 cnf), so only that agent can redeem it at VendorVault.
        """
        if not self.issuing:
            raise IdPError(f"{self.name}'s admin has stopped issuing agent credentials for this deal")
        if self.cognito:
            try:  # being a user in the vendor's own Cognito pool is what makes someone an employee
                user = verify_id_token(id_token, self.cognito["issuer"], self.cognito["client_id"])["email"]
            except CognitoError as e:
                raise IdPError(f"employee sign-in invalid ({e})")
        else:
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
        if jkt:
            claims["cnf"] = {"jkt": jkt}
        self.issued += 1
        return jwt.encode(claims, self.key, algorithm="ES256", headers={"typ": ID_JAG_TYP, "kid": self.kid})
