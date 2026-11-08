"""Amazon Cognito helpers: config loading and ID token verification against Cognito's public keys.

Runtime only uses public Cognito endpoints (JWKS, hosted login, InitiateAuth), so the servers
need no AWS credentials. Set VV_COGNITO=off (the tests do) to use the simulated logins instead.
"""

import json
import os
import time

import httpx
import jwt

from common.config import ROOT


class CognitoError(Exception):
    pass


def load_config() -> dict | None:
    path = ROOT / "cognito.json"
    if os.environ.get("VV_COGNITO", "on") == "off" or not path.exists():
        return None
    return json.loads(path.read_text())


_jwks: dict[str, tuple[float, jwt.PyJWKSet]] = {}


def _signing_key(issuer: str, kid: str):
    """Cognito's public keys, fetched with httpx (its own CA bundle) and cached for an hour."""
    cached = _jwks.get(issuer)
    if not cached or time.time() - cached[0] > 3600 or kid not in {k.key_id for k in cached[1].keys}:
        resp = httpx.get(f"{issuer}/.well-known/jwks.json", timeout=10)
        resp.raise_for_status()
        cached = _jwks[issuer] = (time.time(), jwt.PyJWKSet.from_dict(resp.json()))
    for key in cached[1].keys:
        if key.key_id == kid:
            return key.key
    raise CognitoError("token signed with an unknown Cognito key")


def verify_id_token(token: str, issuer: str, client_id: str) -> dict:
    """Verify a Cognito ID token's signature, issuer, audience and expiry."""
    try:
        key = _signing_key(issuer, jwt.get_unverified_header(token).get("kid", ""))
        claims = jwt.decode(token, key, algorithms=["RS256"], audience=client_id, issuer=issuer)
    except (jwt.PyJWTError, httpx.HTTPError) as e:
        raise CognitoError(f"Cognito token rejected ({e})")
    if claims.get("token_use") != "id":
        raise CognitoError("not a Cognito ID token")
    return claims


def initiate_auth(region: str, client_id: str, params: dict, flow: str) -> dict:
    """Cognito InitiateAuth (USER_PASSWORD_AUTH or REFRESH_TOKEN_AUTH). Public API, no AWS credentials."""
    resp = httpx.post(
        f"https://cognito-idp.{region}.amazonaws.com/",
        headers={"Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth"},
        json={"AuthFlow": flow, "ClientId": client_id, "AuthParameters": params},
        timeout=10,
    )
    body = resp.json()
    if resp.status_code != 200:
        raise CognitoError(body.get("message") or body.get("__type", "sign-in failed"))
    result = body.get("AuthenticationResult")
    if not result:
        raise CognitoError(f"extra sign-in step required ({body.get('ChallengeName')})")
    result["obtained_at"] = time.time()
    return result


def demo_passwords() -> dict[str, str]:
    path = ROOT / ".demo-users"
    return json.loads(path.read_text()) if path.exists() else {}
