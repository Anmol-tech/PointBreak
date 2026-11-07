"""Key helpers and DPoP (RFC 9449) proofs shared by the gateway and the party side."""

import base64
import hashlib
import json
import time
import uuid

import jwt
from cryptography.hazmat.primitives.asymmetric import ec


class DPoPError(Exception):
    pass


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def new_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def public_jwk(key) -> dict:
    pub = key.public_key() if hasattr(key, "public_key") else key
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(pub))
    return {k: jwk[k] for k in ("kty", "crv", "x", "y")}


def key_from_jwk(jwk: dict):
    return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk))


def thumbprint(jwk: dict) -> str:
    """RFC 7638 JWK thumbprint, used as the token's cnf.jkt."""
    canon = json.dumps({k: jwk[k] for k in ("crv", "kty", "x", "y")}, separators=(",", ":"), sort_keys=True)
    return b64url(hashlib.sha256(canon.encode()).digest())


def token_hash(token: str) -> str:
    return b64url(hashlib.sha256(token.encode()).digest())


def make_proof(key, method: str, url: str, access_token: str | None = None) -> str:
    claims = {"jti": uuid.uuid4().hex, "htm": method.upper(), "htu": url, "iat": int(time.time())}
    if access_token:
        claims["ath"] = token_hash(access_token)
    return jwt.encode(claims, key, algorithm="ES256", headers={"typ": "dpop+jwt", "jwk": public_jwk(key)})


def verify_proof(proof: str, method: str, url: str, access_token: str | None = None, max_age: int = 60) -> dict:
    """Return {"jkt", "jti"} for a valid proof, or raise DPoPError."""
    try:
        header = jwt.get_unverified_header(proof)
    except jwt.PyJWTError as e:
        raise DPoPError(f"malformed DPoP proof ({e})")
    if header.get("typ") != "dpop+jwt" or header.get("alg") != "ES256" or "jwk" not in header:
        raise DPoPError("DPoP proof header is invalid")
    jwk = header["jwk"]
    try:
        claims = jwt.decode(
            proof,
            key_from_jwk(jwk),
            algorithms=["ES256"],
            options={"require": ["jti", "htm", "htu", "iat"]},
            leeway=5,
        )
    except jwt.PyJWTError as e:
        raise DPoPError(f"DPoP signature invalid ({e})")
    if claims["htm"] != method.upper() or claims["htu"] != url:
        raise DPoPError("DPoP proof was made for a different request")
    if abs(time.time() - claims["iat"]) > max_age:
        raise DPoPError("DPoP proof is too old")
    if access_token is not None and claims.get("ath") != token_hash(access_token):
        raise DPoPError("DPoP proof is not bound to this access token")
    return {"jkt": thumbprint(jwk), "jti": claims["jti"]}
