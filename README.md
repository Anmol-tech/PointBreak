# VendorVault (team PointBreak)

SCU ACM **AWS x A10 Hack** · A10 track · **Prompt 1: Agentic Identity**

Deal data rooms (M&A, fundraising, legal) now let outside AI agents in. Datasite launched an MCP server in April 2026, and DealRoom, iDeals and Papermark have similar connectors. They pass document content to the agent under a human's permissions, and once text reaches an outside agent, "read-only" means nothing: it can be copied anywhere.

**VendorVault never releases files.** Outside agents get verified, delegation-aware identities and *ask questions*. A seller-side vault agent answers with short, masked, cited excerpts. Every answer is fingerprinted to the exact agent chain, coverage is limited per company across all its agents, and the owner can revoke one agent, a branch, or a whole company mid-session.

## Identity model
| Question | How it's verified |
|---|---|
| Which company? | The seller invites the party; the gateway trusts only that party's IdP issuer (JWKS fetched from the issuer) |
| Which person? | OIDC-style login at the party's **own** IdP (`party/idp.py`, standing in for Okta/Entra) |
| Party vouches for its agent | **ID-JAG** (IETF draft, Okta/Ping): the party IdP applies *its* policy, then signs an assertion for VendorVault. The party admin can stop issuing at the source |
| Which agent? | Agent key pair; the access token is **bound to that key** (`cnf.jkt`, DPoP RFC 9449). A stolen token is useless without the key |
| Sub-agents | **Token exchange** (RFC 8693 `act` chain): `finance-agent ← orchestrator ← alice@buyerco ← BuyerCo`. A child can never get more than its parent |
| Every call | signature · expiry · fresh DPoP proof · whole chain active · tool allowed · folder shared · company not locked |

## Run it
1. Put your Bedrock API key in `.env` (git ignores it):
   ```
   AWS_BEARER_TOKEN_BEDROCK='bedrock-api-key-...'
   ```
2. Start everything (installs dependencies the first time, builds the dashboard, starts both servers):
   ```bash
   ./run.sh
   ```
   On Windows PowerShell, use `.\run.ps1` instead. It loads `.env`, builds the
   dashboard, and starts the gateway, party runtime, and frontend dev server in
   the background. Open http://127.0.0.1:5173; server logs are in `logs/`.
3. Open http://localhost:8000.

Without `.env` it still works: the vault agent answers with local search instead of Bedrock. The dashboard header shows which one is active.

**Vault agent answers:** written by **Amazon Nova Pro on Bedrock** (`vault_llm` in `config.json`). Excerpts are masked *before* the model sees them, and any Bedrock error falls back to local search.

Dashboard with hot reload while editing: `npm --prefix dashboard run dev` → http://localhost:5173

## Agents
- **OpenCode on Bedrock:** `opencode.json` sets Claude Sonnet 4.6 on Amazon Bedrock (us-east-1) and registers `vendorvault` → `http://localhost:9001/agents/opencode/mcp` (acts as `alice@buyerco.com`). In a terminal: `set -a; source .env; set +a`, then `opencode`. The hackathon AWS account only allows certain models (Sonnet 4.6, Sonnet 5, Haiku 4.5, Nova Pro, Nova 2 Lite).
- **Claude Code (same gateway, no changes):**
  ```bash
  claude --mcp-config '{"mcpServers":{"vendorvault":{"type":"http","url":"http://localhost:9001/agents/opencode/mcp"}}}'
  ```
- **Scripted multi-agent team:** `.venv/bin/python -m party.runner`

Agents never hold a key or token: the party runtime on :9001 holds keys and signs every request.

## 2-minute demo
Every step can run from the dashboard's header buttons (1–4); the commands below do the same from a terminal.

1. **Team:** `python -m party.runner`. Alice's orchestrator gets a key-bound token from an ID-JAG and spawns legal + finance sub-agents; the dashboard tree shows the delegation chain.
2. **No document downloads:** the legal agent gets cited, masked excerpts; `get_document` is blocked with "documents never leave the vault"; Board Minutes is blocked.
3. **Stolen token:** `python -m scripts.stolen_token_attack` → rejected without the agent's key, and rejected with the attacker's own key.
4. **Split scraping:** `python -m scripts.split_scrape_attack` → RivalBid's 5 sub-agents each take a slice; company coverage hits 70% → auto-lock, flagged as split scraping.
5. **Leak trace:** `python -m scripts.leak_demo`, or paste text into the dashboard's Leak tracer → "legal-agent ← buyer-orchestrator ← alice@buyerco.com ← BuyerCo".
6. **Revoke mid-task:** click Revoke on an agent → its next call is blocked, its siblings keep working; "Revoke branch" cascades to sub-agents.

Use **Reset demo** on the dashboard between runs (it resets both the gateway and the party side).

## Tests
```bash
.venv/bin/python -m tests.e2e_test
```
27 checks on their own ports (8100/9101): forged/untrusted ID-JAGs, masking, blocked tools and folders, sub-agent narrowing, stolen-token replay, leak tracing, revoke + cascade, party IdP stop, split-scraping lock.

## Judge Q&A
- **"Datasite already has MCP."** They pass documents to the agent under a user's permissions. We never release files, bind tokens to the agent's key, attribute every answer to an agent chain, and limit coverage per company.
- **"Read-only files can still be copied."** That's why agents only get short answers and never the full documents. In production, documents would decrypt only inside a verified AWS Nitro Enclave (KMS attestation-based key release), so the agent physically can't send them anywhere.
- **"What if the agent paraphrases to dodge the fingerprint?"** The fingerprint covers verbatim leaks and deters; text matching covers stripped marks; coverage limits cap how much can be rebuilt at all.
- **"Why ID-JAG?"** Both companies stay in control: the buyer's admin can stop issuing at their IdP, and the seller can revoke at the gateway. It's still a draft, so we implement the draft flow.

## Layout
`gateway/` identity, vault agent, protection, MCP + owner API · `party/` IdPs, agent runtime, runner · `dashboard/` React owner UI · `dataroom/` fictional Project Falcon documents · `scripts/` attack scenarios · `tests/` end-to-end checks
