"""A real AI agent team: a lead agent plans the work and hands parts of it to helper agents.

Every agent is a Claude model on Amazon Bedrock, and every agent has its own identity:
  - the lead gets its badge from an ID-JAG issued by the vendor's company login (Amazon Cognito)
  - each helper gets its own key and a narrower badge by token exchange (RFC 8693), so the chain
    reads  helper ← lead ← employee ← vendor  on every request VendorVault sees
The agents' brains run here; their keys stay in the vendor runtime (party/proxy.py), which signs
every MCP call. Falcon can stop any helper (or the lead, which stops its helpers) mid-task, and
the very next call is refused.

Without a Bedrock key (or with AGENT_LLM=off) the same team runs a fixed plan, so the demo and the
tests still work offline.

Usage: python -m party.ai_team ["task"]
"""

import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import httpx

from common.config import load
from party.client import PROXY_URL, McpAgent, PartyError, create_root, spawn

cfg = load()
LLM = cfg.get("agent_llm", {})
MODEL = os.environ.get("AGENT_MODEL", LLM.get("model", "us.anthropic.claude-sonnet-4-6"))
LABEL = LLM.get("label", MODEL)
REGION = LLM.get("region", "us-east-1")
INVISIBLE = re.compile("[​‌‍﻿]")
STOP_WORDS = ("revoked", "locked out", "offboarded", "not an onboarded vendor")

DEFAULT_TASK = (
    "Falcon Analytics is being acquired and our client needs a legal risk memo. Find which customer "
    "contracts have change-of-control clauses and what they allow, and how concentrated revenue is "
    "among the top customers. Also report the quarterly revenue trend."
)


def llm_enabled() -> bool:
    return os.environ.get("AGENT_LLM", "on") != "off" and bool(os.environ.get("AWS_BEARER_TOKEN_BEDROCK"))


def converse(system: str, messages: list, tools: list[dict]) -> dict:
    """One Bedrock Converse call. Returns the assistant message and why the model stopped."""
    url = f"https://bedrock-runtime.{REGION}.amazonaws.com/model/{quote(MODEL, safe='')}/converse"
    body = {"system": [{"text": system}], "messages": messages, "inferenceConfig": {"maxTokens": 2000}}
    if tools:
        body["toolConfig"] = {"tools": [{"toolSpec": t} for t in tools]}
    resp = httpx.post(url, json=body, timeout=90,
                      headers={"Authorization": f"Bearer {os.environ['AWS_BEARER_TOKEN_BEDROCK']}"})
    if resp.status_code != 200:
        raise RuntimeError(f"Bedrock {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return {"message": data["output"]["message"], "stop": data.get("stopReason")}


def tool_results(results: list[tuple[str, str, bool]]) -> dict:
    """All tool results for one assistant turn go back in a single user message."""
    return {"role": "user", "content": [
        {"toolResult": {"toolUseId": tid, "content": [{"text": text}], "status": "error" if err else "success"}}
        for tid, text, err in results]}


def text_of(message: dict) -> str:
    return "\n".join(b["text"] for b in message.get("content", []) if "text" in b).strip()


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")[:40] or "helper"


class Team:
    def __init__(self, party: str, user: str, lead: str, proxy: str, note, after_call, pace: float):
        self.party, self.user, self.lead, self.proxy = party, user, lead, proxy
        self.note = note or (lambda line: print(line))
        self.after_call = after_call or (lambda agent, count: None)
        self.pace = pace
        self.lock = threading.Lock()
        self.helpers: dict[str, dict] = {}

    # --- identity -----------------------------------------------------------------------
    def start_lead(self) -> McpAgent:
        info = create_root(self.party, self.user, self.lead, proxy=self.proxy)
        self.note(f"🔑 {self.user.split('@')[0]} signed in · {self.lead} got its badge")
        agent = McpAgent(self.lead, self.proxy)
        agent.initialize()
        return agent

    def start_helper(self, name: str, folders: list[str]) -> tuple[McpAgent | None, str]:
        try:
            info = spawn(self.lead, name, folders=folders or None, proxy=self.proxy)
        except PartyError as e:
            self.note(f"⛔ {name} refused: more access than {self.lead}" if "more access" in str(e) else f"⛔ {name} refused")
            return None, f"Could not create helper {name}: {e}"
        self.note(f"🔑 {name}: own key · {', '.join(info['granted_folders'])} only")
        agent = McpAgent(name, self.proxy)
        agent.initialize()
        return agent, ""

    # --- one MCP call, with the pause that lets a human press Stop mid-task --------------
    def call(self, agent: McpAgent, tool: str, args: dict, count: int) -> tuple[str, bool, bool]:
        time.sleep(self.pace)
        text, denied = agent.tool(tool, **args)
        clean = INVISIBLE.sub("", text)
        stopped = denied and any(w in clean.lower() for w in STOP_WORDS)
        if denied:
            self.note(f"🛑 {agent.name} blocked: stopped by Falcon" if stopped else f"⛔ {agent.name} blocked: {tool}")
        else:
            q = args.get("question")
            self.note(f"✅ {agent.name} asked: {q[:48] + '…' if len(q) > 48 else q}" if q else f"✅ {agent.name}: {tool}")
            self.after_call(agent.name, count)
        return text, denied, stopped


def mcp_tool_specs(agent: McpAgent) -> list[dict]:
    """The helper only sees the MCP tools VendorVault lists for its badge."""
    tools = agent.rpc("tools/list").get("result", {}).get("tools", [])
    return [{"name": t["name"], "description": t.get("description", ""), "inputSchema": {"json": t["inputSchema"]}}
            for t in tools]


# --- LLM agents ---------------------------------------------------------------------------

HELPER_PROMPT = """You are {name}, a helper AI agent at {party}, working for the lead agent {lead} on behalf of {user}.
You are connected to Falcon Analytics' data room through VendorVault. You get short, masked answers, never documents.
Your assignment: {assignment}
Use ask_question with focused questions (at most 3). Stay inside your assignment.
If a tool call is refused, do not retry the same thing. If you are told you were revoked or locked, stop immediately.
Finish with a short findings note (under 120 words) that names the sources the answers cited."""

LEAD_PROMPT = """You are {lead}, the lead AI agent at {party}, working for {user}.
Your company may only use these Falcon folders: {folders}. Each helper you create gets its own identity and may only get
folders you have (never more). Plan the work, then call delegate once per helper, in parallel, giving each helper only
the folders it needs and a one-sentence assignment. Use 2 helpers. Use lowercase-dash names like contracts-reviewer.
If something is outside your company's access, say so in the memo instead of trying to get it.
After the helpers report, write the final memo (under 200 words). Say plainly if any helper was stopped and what is missing."""


def run_helper_llm(team: Team, agent: McpAgent, assignment: str) -> str:
    system = HELPER_PROMPT.format(name=agent.name, party=team.party, lead=team.lead, user=team.user, assignment=assignment)
    tools = mcp_tool_specs(agent)
    messages = [{"role": "user", "content": [{"text": assignment}]}]
    calls = 0
    for _ in range(6):
        out = converse(system, messages, tools)
        messages.append(out["message"])
        uses = [b["toolUse"] for b in out["message"]["content"] if "toolUse" in b]
        if out["stop"] != "tool_use" or not uses:
            return text_of(out["message"]) or "(no findings)"
        results = []
        for use in uses:
            calls += 1
            text, denied, stopped = team.call(agent, use["name"], use.get("input") or {}, calls)
            if stopped:
                return f"STOPPED by Falcon before finishing: {INVISIBLE.sub('', text)}"
            results.append((use["toolUseId"], text, denied))
        messages.append(tool_results(results))
    return text_of(messages[-2]) if len(messages) > 1 else "(ran out of steps)"


def run_lead_llm(team: Team, lead: McpAgent, task: str) -> str:
    outline, _ = lead.tool("list_folders")
    folders = sorted({m.group(1) for m in re.finditer(r"^- ([^/]+?) /", INVISIBLE.sub("", outline), re.M)})
    team.note(f"🧠 {team.lead} is planning ({LABEL})")
    system = LEAD_PROMPT.format(lead=team.lead, party=team.party, user=team.user, folders=", ".join(folders))
    delegate = {"name": "delegate", "description": "Create a helper agent with its own identity and run it on one part of the task.",
                "inputSchema": {"json": {"type": "object", "properties": {
                    "helper_name": {"type": "string"},
                    "folders": {"type": "array", "items": {"type": "string"}},
                    "assignment": {"type": "string"}}, "required": ["helper_name", "folders", "assignment"]}}}
    messages = [{"role": "user", "content": [{"text": f"Task from {team.user}: {task}\n\nOutline of what you may see:\n{outline}"}]}]
    for _ in range(4):
        out = converse(system, messages, [delegate])
        messages.append(out["message"])
        uses = [b["toolUse"] for b in out["message"]["content"] if "toolUse" in b]
        if out["stop"] != "tool_use" or not uses:
            return text_of(out["message"])

        def work(use):
            args = use.get("input") or {}
            name = slug(args.get("helper_name", "helper"))
            agent, error = team.start_helper(name, list(args.get("folders") or []))
            if not agent:
                return use["toolUseId"], error, True
            findings = run_helper_llm(team, agent, args.get("assignment", ""))
            team.note(f"📝 {name} {'was cut off' if findings.startswith('STOPPED') else 'reported back'}")
            return use["toolUseId"], f"{name} reports: {findings}", findings.startswith("STOPPED")

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(work, uses))
        if any(f"parent agent {team.lead} has been revoked" in text for _, text, _ in results):
            return f"{team.lead} was stopped by Falcon mid-task, which stopped all of its helpers. No memo was written."
        messages.append(tool_results(results))
    return text_of(messages[-1]) if messages[-1]["role"] == "assistant" else "(the lead ran out of steps)"


# --- the same team with a fixed plan (no Bedrock key, or AGENT_LLM=off) -------------------

SCRIPTED = [
    ("contracts-reviewer", ["Contracts"], ["Which customer contracts have change of control clauses?",
                                            "What can the customer do after a change of control?",
                                            "What are the termination and notice terms?"]),
    ("customer-reviewer", ["Customers"], ["How concentrated is revenue among top customers?",
                                           "Which customers are the largest?",
                                           "What was quarterly revenue?"]),
]


def run_scripted(team: Team, task: str) -> str:
    team.note(f"🧠 {team.lead} is planning (fixed plan)")
    team.start_helper("finance-reviewer", ["Financials"])  # shows the child ⊆ parent rule: always refused

    def work(plan):
        name, folders, questions = plan
        agent, error = team.start_helper(name, folders)
        if not agent:
            return f"{name}: {error}"
        answered = 0
        for count, q in enumerate(questions, 1):
            folder = "Financials" if "revenue" in q.lower() and "quarterly" in q.lower() else None
            _, denied, stopped = team.call(agent, "ask_question", {"question": q, **({"folder": folder} if folder else {})}, count)
            if stopped:
                return f"{name}: STOPPED by Falcon after {answered} answer(s)"
            answered += 0 if denied else 1
        return f"{name}: {answered} of {len(questions)} questions answered"

    with ThreadPoolExecutor(max_workers=2) as pool:
        lines = list(pool.map(work, SCRIPTED))
    return "Memo (fixed plan): " + "; ".join(lines)


def run_ai_team(task: str = DEFAULT_TASK, party: str = "LexPartners", user: str = "dana@lexpartners.com",
                lead: str = "lex-lead", proxy: str = PROXY_URL, note=None, after_call=None, pace: float = 1.5) -> dict:
    """Run the team. Returns {"memo", "engine", "helpers"}."""
    team = Team(party, user, lead, proxy, note, after_call, pace)
    lead_agent = team.start_lead()
    memo = None
    if llm_enabled():
        try:
            memo, engine = run_lead_llm(team, lead_agent, task), f"{LABEL} on Amazon Bedrock"
        except (RuntimeError, httpx.HTTPError) as e:  # e.g. the Bedrock key expired
            team.note(f"⚠️ Bedrock unavailable, switching to the fixed plan ({str(e)[:60]})")
    if memo is None:
        memo, engine = run_scripted(team, task), "fixed plan"
    team.note(f"📄 {team.lead} wrote the memo")
    return {"memo": memo, "engine": engine}


def main():
    task = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TASK
    result = run_ai_team(task)
    print(f"\n=== Memo ({result['engine']}) ===\n{result['memo']}")


if __name__ == "__main__":
    main()
