"""One-time setup of real enterprise logins in Amazon Cognito.

Creates (or reuses, so it's safe to re-run):
  - vendorvault-falcon: Falcon's workforce pool, hosted login page, "control-center" app client
    (authorization code + PKCE), group falcon-admins, an admin and a read-only viewer
  - vendorvault-<vendor>: one pool per configured vendor, standing in for that vendor's own
    corporate login, with an "agent-runtime" app client and the vendor's employees

Writes cognito.json (pool and client IDs, not secret) and .demo-users (generated demo
passwords; git ignores both).

Run it in your own terminal with AWS credentials that can manage Cognito (not the Bedrock key).
Passwords already in .demo-users are kept, so share that one file with your team instead of
re-running the script on each machine; pass --reset-passwords to make new ones.
It reads AWS_REGION and any AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN /
AWS_PROFILE from .env; values already set in your shell win.
  .venv/bin/pip install boto3
  .venv/bin/python -m scripts.setup_cognito
"""

import json
import os
import secrets
import sys

import boto3
from botocore.exceptions import ClientError

from common.config import ROOT, load


def load_env_file() -> None:
    """Read AWS settings from .env without overriding the shell. The Bedrock key isn't needed here."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.removeprefix("export ").strip(), value.strip().strip("'\"")
        if key.startswith("AWS_") and key != "AWS_BEARER_TOKEN_BEDROCK" and value:
            os.environ.setdefault(key, value)


load_env_file()
REGION = os.environ.get("AWS_REGION", "us-east-1")
CALLBACK = "http://localhost:8000/auth/callback"
LOGOUT = "http://localhost:8000/"
FALCON_USERS = [
    ("admin@falcon.example", "Falcon Admin", True),
    ("viewer@falcon.example", "Falcon Viewer", False),
]

cfg = load()
cip = boto3.client("cognito-idp", region_name=REGION)
account = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
passwords: dict[str, str] = {}
# Keep the passwords this team already shares in .demo-users, so re-running the script (on any machine
# with the same .demo-users) doesn't lock everyone else out. --reset-passwords makes new ones.
RESET = "--reset-passwords" in sys.argv
KNOWN: dict[str, str] = {} if RESET or not (ROOT / ".demo-users").exists() else json.loads((ROOT / ".demo-users").read_text())


def password() -> str:
    # 12+ characters with upper, lower and digits, matching the pool policy below.
    return f"Vault-{secrets.token_hex(4)}A9z"


def find_pool(name: str) -> str | None:
    for page in cip.get_paginator("list_user_pools").paginate(MaxResults=60):
        for pool in page["UserPools"]:
            if pool["Name"] == name:
                return pool["Id"]
    return None


def ensure_pool(name: str) -> str:
    pool_id = find_pool(name)
    if pool_id:
        print(f"  reusing pool {name} ({pool_id})")
        return pool_id
    pool_id = cip.create_user_pool(
        PoolName=name,
        UsernameAttributes=["email"],
        AutoVerifiedAttributes=["email"],
        MfaConfiguration="OFF",
        AdminCreateUserConfig={"AllowAdminCreateUserOnly": True},
        Policies={"PasswordPolicy": {"MinimumLength": 12, "RequireUppercase": True, "RequireLowercase": True,
                                     "RequireNumbers": True, "RequireSymbols": False}},
    )["UserPool"]["Id"]
    print(f"  created pool {name} ({pool_id})")
    return pool_id


def ensure_client(pool_id: str, name: str, **settings) -> str:
    for c in cip.list_user_pool_clients(UserPoolId=pool_id, MaxResults=60)["UserPoolClients"]:
        if c["ClientName"] == name:
            cip.update_user_pool_client(UserPoolId=pool_id, ClientId=c["ClientId"], ClientName=name, **settings)
            return c["ClientId"]
    return cip.create_user_pool_client(UserPoolId=pool_id, ClientName=name, GenerateSecret=False, **settings)["UserPoolClient"]["ClientId"]


def ensure_domain(pool_id: str) -> str:
    existing = cip.describe_user_pool(UserPoolId=pool_id)["UserPool"].get("Domain")
    if existing:
        return existing
    prefix = f"vendorvault-{account[-6:]}-{secrets.token_hex(2)}"
    try:  # classic hosted login page
        cip.create_user_pool_domain(Domain=prefix, UserPoolId=pool_id, ManagedLoginVersion=1)
    except (ClientError, TypeError) as e:
        if "ManagedLoginVersion" not in str(e):
            raise
        cip.create_user_pool_domain(Domain=prefix, UserPoolId=pool_id)
    return prefix


def ensure_user(pool_id: str, email: str, name: str, group: str | None = None):
    try:
        cip.admin_create_user(UserPoolId=pool_id, Username=email, MessageAction="SUPPRESS",
                              UserAttributes=[{"Name": "email", "Value": email}, {"Name": "email_verified", "Value": "true"},
                                              {"Name": "name", "Value": name}])
    except cip.exceptions.UsernameExistsException:
        pass
    pw = KNOWN.get(email) or password()
    cip.admin_set_user_password(UserPoolId=pool_id, Username=email, Password=pw, Permanent=True)
    passwords[email] = pw
    if group:
        cip.admin_add_user_to_group(UserPoolId=pool_id, Username=email, GroupName=group)


def issuer(pool_id: str) -> str:
    return f"https://cognito-idp.{REGION}.amazonaws.com/{pool_id}"


def main():
    print(f"AWS account {account}, region {REGION}")
    out: dict = {"region": REGION, "vendors": {}}

    print("Falcon workforce login:")
    pool = ensure_pool("vendorvault-falcon")
    client = ensure_client(
        pool, "control-center",
        AllowedOAuthFlows=["code"], AllowedOAuthScopes=["openid", "email", "profile"], AllowedOAuthFlowsUserPoolClient=True,
        CallbackURLs=[CALLBACK], LogoutURLs=[LOGOUT], SupportedIdentityProviders=["COGNITO"],
        ExplicitAuthFlows=["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"],
    )
    try:
        cip.create_group(UserPoolId=pool, GroupName="falcon-admins", Description="May stop agents and manage vendors")
    except cip.exceptions.GroupExistsException:
        pass
    domain = ensure_domain(pool)
    for email, name, admin in FALCON_USERS:
        ensure_user(pool, email, name, "falcon-admins" if admin else None)
    out["falcon"] = {"pool_id": pool, "client_id": client, "domain": domain, "issuer": issuer(pool),
                     "redirect_uri": CALLBACK, "logout_uri": LOGOUT}

    for vendor, v in cfg["vendors"].items():
        print(f"{vendor} company login:")
        vpool = ensure_pool(f"vendorvault-{vendor.lower()}")
        vclient = ensure_client(vpool, "agent-runtime", ExplicitAuthFlows=["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"])
        for email in v["users"]:
            ensure_user(vpool, email, email.split("@")[0].title())
        out["vendors"][vendor] = {"pool_id": vpool, "client_id": vclient, "issuer": issuer(vpool)}

    (ROOT / "cognito.json").write_text(json.dumps(out, indent=2))
    (ROOT / ".demo-users").write_text(json.dumps(passwords, indent=2))
    print("\nWrote cognito.json (IDs) and .demo-users (demo passwords; git ignores both).")
    print(f"Falcon login page: https://{domain}.auth.{REGION}.amazoncognito.com")
    print("\nDemo sign-ins:")
    for email, pw in passwords.items():
        print(f"  {email:28} {pw}")
    print("\nRestart ./run.sh to turn on real sign-in.")


if __name__ == "__main__":
    main()
