import json
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load() -> dict:
    cfg = json.loads((ROOT / "config.json").read_text())
    # Ports can be overridden so tests can run beside a live demo.
    cfg["gateway_url"] = os.environ.get("GATEWAY_URL", cfg["gateway_url"]).rstrip("/")
    cfg["party_sim_url"] = os.environ.get("PARTY_SIM_URL", cfg["party_sim_url"]).rstrip("/")
    return cfg


def issuer_for(cfg: dict, party: str) -> str:
    return f"{cfg['party_sim_url']}/idp/{party}"
