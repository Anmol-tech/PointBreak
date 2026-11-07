"""Writes the vault agent's answers with Amazon Bedrock (Converse API).

Uses a Bedrock API key from AWS_BEARER_TOKEN_BEDROCK (loaded from .env by run.sh).
The model only ever sees excerpts that were already masked; if Bedrock is unavailable
the gateway falls back to local search snippets.
"""

import os
from urllib.parse import quote

import httpx

SYSTEM_PROMPT = (
    "You are Falcon Analytics' data-room assistant. Outside vendors' AI agents ask questions for the work "
    "they were hired to do. Answer the question using only the numbered excerpts. Be concise: at most 120 words. Cite excerpts like [1]. Do not copy "
    "long passages word for word. Masked values such as [email masked] must stay masked; never guess them. "
    "If the excerpts do not answer the question, say so."
)


class BedrockError(Exception):
    pass


class BedrockWriter:
    def __init__(self, cfg: dict):
        llm = cfg.get("vault_llm", {})
        self.model = os.environ.get("VAULT_MODEL", llm.get("model", "us.amazon.nova-pro-v1:0"))
        self.label = llm.get("label", self.model)
        self.region = os.environ.get("AWS_REGION_BEDROCK", llm.get("region", "us-east-1"))
        self.configured = llm.get("enabled", True)

    @property
    def enabled(self) -> bool:
        return (self.configured and os.environ.get("VAULT_LLM", "on") != "off"
                and bool(os.environ.get("AWS_BEARER_TOKEN_BEDROCK")))

    def compose(self, question: str, excerpts: list[tuple[str, str]]) -> str:
        numbered = "\n\n".join(f"[{i}] ({source})\n{text}" for i, (source, text) in enumerate(excerpts, 1))
        body = {
            "system": [{"text": SYSTEM_PROMPT}],
            "messages": [{"role": "user", "content": [{"text": f"Question: {question}\n\nExcerpts:\n{numbered}"}]}],
            "inferenceConfig": {"maxTokens": 400, "temperature": 0.2},
        }
        url = f"https://bedrock-runtime.{self.region}.amazonaws.com/model/{quote(self.model, safe='')}/converse"
        try:
            resp = httpx.post(url, json=body, timeout=25,
                              headers={"Authorization": f"Bearer {os.environ['AWS_BEARER_TOKEN_BEDROCK']}"})
        except httpx.HTTPError as e:
            raise BedrockError(f"network error ({e.__class__.__name__})")
        if resp.status_code != 200:
            try:
                message = resp.json().get("message") or resp.json().get("Message") or resp.text
            except ValueError:
                message = resp.text
            raise BedrockError(f"HTTP {resp.status_code}: {message[:160]}")
        try:
            parts = resp.json()["output"]["message"]["content"]
            text = "".join(p.get("text", "") for p in parts).strip()
        except (KeyError, ValueError, TypeError):
            raise BedrockError("unexpected response shape")
        if not text:
            raise BedrockError("empty answer")
        sources = "; ".join(f"[{i}] {source}" for i, (source, _) in enumerate(excerpts, 1))
        lines = [f"Answer written by {self.label} on Amazon Bedrock. Documents are not released."]
        lines += [line for line in text.splitlines() if line.strip()]
        lines.append(f"Sources: {sources}")
        return "\n".join(lines)
