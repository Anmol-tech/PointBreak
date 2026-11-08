# VendorVault (team PointBreak)

SCU ACM **AWS x A10 Hack** · A10 track · **Prompt 1: Agentic Identity**

Companies now let outside vendors (law firms, auditors, consultants) point their own AI agents at sensitive data. Each vendor usually connects with a broad, long-lived credential, nobody can tell which vendor's agent saw what, and once a document reaches an outside agent, "read-only" means nothing: it can be copied anywhere. In 2025, stolen tokens from one vendor's AI chatbot (Salesloft Drift) were used to pull data from 700+ organizations.

**VendorVault never releases files.** Outside agents get verified, delegation-aware identities and *ask questions*. A vault agent on Falcon's side answers with short, masked, cited excerpts. Every answer is fingerprinted to the exact agent chain, coverage is limited per company across all its agents, and the owner can revoke one agent, a branch, or a whole company mid-session.

## Vendors and onboarding
**Falcon (us)** owns the data and runs VendorVault. **Vendors** are outside companies that bring AI agents to do work for us. Each vendor's access matches the work it was hired for:

| Vendor | Hired for | Its agents may ask about |
|---|---|---|
| LexPartners (law firm) | Legal review of contracts | Contracts, Customers |
| Ledgerly (audit firm) | Financial audit and payroll checks | Financials, HR |
| *New vendor, onboarded live* | Whatever you describe | Only the folders you tick |

**Onboarding a new vendor**
1. **Falcon → Vendors → Onboard a new vendor:** company name, the work their agents will do, the admin's email, and only the folders that work needs. This creates an **invite code**; the vendor is *Invited* and not trusted yet.
2. **Vendor portal → join with an invite:** the vendor enters the code, sees exactly what access Falcon is offering, and **connects its company login**. VendorVault fetches the login's public signing keys, and the vendor becomes *Active*.
3. The vendor's employees start agents. Each agent's badge is limited to the vendor's folders; helpers get the same or less.
4. **Offboard** at any time: every agent stops and the vendor's login is no longer trusted.

## Track 1: Agentic Identity, point by point
The prompt asks for IAM for AI agents built on **enterprise authentication, workload identity and secure authorization**, and a demo that **authenticates an agent → allows selected MCP tools → revokes mid-task → blocks the next request**.

| Track asks for | What VendorVault does | Where |
|---|---|---|
| **Enterprise authentication** | Real **Amazon Cognito** logins. Falcon staff use Cognito's hosted login (OIDC code flow + PKCE, `falcon-admins` group for any change). Each vendor has its own Cognito user pool for its employees. | `gateway/auth.py`, `party/idp.py`, `scripts/setup_cognito.py` |
| Federation between companies | The vendor's login turns an employee's Cognito ID token into an **ID-JAG** (IETF Identity Assertion JWT Authorization Grant) for VendorVault. VendorVault trusts only vendors Falcon onboarded (their signing keys are fetched from their issuer). | `party/idp.py`, `gateway/identity.py` |
| **Workload identity** | Every agent is a workload with its **own key pair**, generated in the vendor runtime, never shared. The ID-JAG names that key (`cnf.jkt`), so only that agent can redeem it. Its badge is bound to the same key (**DPoP**, RFC 9449), and every request is signed. There are no API keys or shared secrets. | `party/proxy.py`, `common/dpop.py` |
| Agents creating agents | A lead agent creates helpers by **token exchange** (RFC 8693). Each helper gets its own key, a badge that is the same or narrower, and an `act` chain: `contracts-reviewer ← lex-lead ← dana@lexpartners.com ← LexPartners` | `gateway/identity.py` |
| **Secure authorization** | Checked on **every MCP call**: badge signature and expiry · fresh key proof · whole chain still active · vendor not locked · **tool allowed right now** · folder shared. `tools/list` only shows the tools an agent may call. | `gateway/app.py` |
| **Allow selected MCP tools** | Falcon ticks which MCP tools each vendor's agents may call (`ask_question`, `list_folders`). Changes apply on the next call. `get_document` and `export_all` can never be granted. | Vendor card in the 3D view, `/api/parties/{name}/tools` |
| **Revoke mid-task → block next request** | Stop one agent, or a lead (which stops all its helpers), or lock or offboard a whole vendor. The very next call is refused, and a stopped agent can't sign in again. The vendor's own admin can also stop its login issuing new badges. | AI agent team scenario |
| MCP authorization spec | `/mcp` answers 401 with `WWW-Authenticate` pointing at **protected resource metadata** (RFC 9728). Authorization server metadata (RFC 8414) lists the grants and DPoP. | `/.well-known/oauth-protected-resource` |

## What a normal gateway can't do
A normal API gateway checks one token against one route. VendorVault checks **who the agent is, who created it, and what its whole team has already seen**:

1. **Identity follows delegation.** Each helper has its own key and badge, and a helper can never get more than the agent that created it. Stopping a lead stops its whole branch on the next call.
2. **Stolen credentials are useless.** A copied badge fails without the agent's key, and so does a copied ID-JAG, because both are bound to that key. Bearer-token gateways can't tell the difference.
3. **Both companies hold a kill switch.** Falcon can stop agents or offboard the vendor. The vendor's admin can stop its own login from issuing badges.
4. **Limits apply to the whole team.** A compromised vendor tool that splits its scraping across many agents trips a vendor-wide coverage lock. A per-token rate limit never sees that.
5. **Answers instead of files.** Agents get short, masked, cited answers from a vault agent (Amazon Nova Pro). Documents never leave, and every answer carries an invisible fingerprint that traces a leak back to the exact agent chain.

## Identity model
| Question | How it's verified |
|---|---|
| Which vendor? | Falcon invites the vendor; once it connects its login, the gateway trusts only that vendor's IdP issuer (JWKS fetched from the issuer) |
| Which person? | **Amazon Cognito**: each vendor has its own user pool; employees sign in there, and the vendor's IdP verifies Cognito's ID token before vouching for an agent. Without `cognito.json`, a simulated login is used |
| Which Falcon staff? | **Amazon Cognito hosted login** (OIDC code flow + PKCE). Only the `falcon-admins` group can stop agents, lock or onboard vendors, or change tools; every action is logged with the admin's email |
| Vendor vouches for its agent | **ID-JAG**: the vendor's login applies *its* policy, then signs an assertion for VendorVault bound to the agent's key (`cnf.jkt`). The vendor's admin can stop issuing at the source |
| Which agent? | The agent's own key pair. The access token is **bound to that key** (`cnf.jkt`, DPoP RFC 9449) |
| Helpers | **Token exchange** (RFC 8693 `act` chain). A child can never get more than its parent |
| Every call | signature · expiry · fresh DPoP proof · whole chain active · vendor not locked · tool allowed now · folder shared |

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

**Enterprise login (Amazon Cognito), one-time setup.** With AWS CLI credentials that can manage Cognito:
```bash
.venv/bin/pip install boto3
```
```bash
.venv/bin/python -m scripts.setup_cognito
```
It reads AWS credentials from `.env` (or your AWS CLI profile). It creates the `vendorvault-falcon` pool (hosted login, `falcon-admins` group, admin + viewer users) and one pool per vendor with its employees, then writes `cognito.json` and the demo passwords to `.demo-users` (both git-ignored). Restart `./run.sh` and open http://localhost:8000 (the sign-in callback is registered for port 8000). The servers only call public Cognito endpoints, so they need no AWS credentials at runtime. `VV_COGNITO=off` switches back to simulated logins.

Dashboard with hot reload while editing: `npm --prefix dashboard run dev` → http://localhost:5173

## Agents
- **AI agent team (Claude on Bedrock):** `.venv/bin/python -m party.ai_team`, or the **AI agent team** button in the control center. LexPartners' lead agent (Claude Sonnet 4.6, `agent_llm` in `config.json`) reads its allowed folders, plans the task, and creates two helpers by token exchange. The helpers call VendorVault's MCP tools in parallel, and the lead writes a memo. If a helper is stopped mid-task, the memo says what is missing. Without a Bedrock key it runs a fixed plan.
- **OpenCode on Bedrock:** `opencode.json` sets Claude Sonnet 4.6 on Amazon Bedrock and registers `vendorvault` → `http://localhost:9001/agents/opencode/mcp` (acts as `dana@lexpartners.com` at LexPartners). In a terminal: `set -a; source .env; set +a`, then `opencode`.
- **Claude Code (same gateway, no changes):**
  ```bash
  claude --mcp-config '{"mcpServers":{"vendorvault":{"type":"http","url":"http://localhost:9001/agents/opencode/mcp"}}}'
  ```
- **Scripted team:** `.venv/bin/python -m party.runner`

Agents never hold a key or token: the vendor runtime on :9001 holds each agent's key and signs every request.

## 2-minute demo (the Track 1 flow)
Sign in at http://localhost:8000 as `admin@falcon.example` (Cognito). Stay on **Live flow**.

1. **Authenticate (enterprise + workload identity).** Click **AI agent team**. The team panel shows Dana's Cognito sign-in, then *lex-lead got a key-bound badge*, then each helper *got its own key and a narrower badge* with its full chain. In the 3D world, each badge passes the identity checks at the VendorVault shield.
2. **Allowed MCP tools only.** The helpers call `ask_question` and `list_folders` and get masked, cited answers. Click LexPartners → untick `list_folders` to show that a tool can be turned off for the next call.
3. **Revoke mid-task.** While the helpers work, press **Stop** next to `contracts-reviewer` in the team panel.
4. **Next request blocked.** Its next call is refused (red in the world and the log: *agent contracts-reviewer has been revoked*). The other helper keeps going. The lead's memo says the contracts review was cut off.
5. **Attacks fail.** **Stolen badge**: a copied badge with no key, the badge with the attacker's key, and an intercepted ID-JAG are all refused. **Compromised vendor tool**: split scraping across 5 agents trips the vendor-wide lock.
6. **Trace a leak.** Paste an answer into **Trace a leak** → the exact agent chain.

**Reset** between runs (it resets both Falcon's gateway and the vendor side).

## Tests
```bash
.venv/bin/python -m tests.e2e_test
```
49 checks on their own ports (8100/9101), with simulated logins and no LLM: MCP 401 + metadata, forged/untrusted ID-JAGs, an ID-JAG redeemed with another key, masking, tools/list filtering, a tool turned off live, blocked tools and folders, helper narrowing, stolen-token replay, leak tracing, revoke + cascade, vendor login stop, onboarding/offboarding, split-scraping lock, and the agent team with a helper stopped mid-task.

## Judge Q&A
- **"Datasite already has MCP."** They pass documents to the agent under a user's permissions. We never release files, bind tokens to the agent's key, attribute every answer to an agent chain, and limit coverage per company.
- **"Read-only files can still be copied."** That's why agents only get short answers and never the full documents. In production, documents would decrypt only inside a verified AWS Nitro Enclave (KMS attestation-based key release), so the agent physically can't send them anywhere.
- **"What if the agent paraphrases to dodge the fingerprint?"** The fingerprint covers verbatim leaks and deters; text matching covers stripped marks; coverage limits cap how much can be rebuilt at all.
- **"Where is workload identity?"** Each agent's key pair is its identity. The vendor vouches for that exact key in the ID-JAG (`cnf.jkt`), VendorVault binds the badge to it, and every request is signed with it. No secret ever travels.
- **"Why not just API keys per agent?"** An API key is a bearer secret: whoever copies it is the agent. Here a copied token or assertion is useless, helpers can't exceed their creator, and one click stops a whole branch.
- **"Why ID-JAG?"** Both sides stay in control: the vendor's admin can stop issuing at its own login, and Falcon can stop any agent or offboard the vendor at the gateway. It's still a draft, so we implement the draft flow.

## Layout
`gateway/` identity, vault agent, protection, MCP + owner API · `party/` IdPs, agent runtime, AI agent team (`ai_team.py`), scripted runner · `dashboard/` React owner UI · `dataroom/` fictional Project Falcon documents · `scripts/` attack scenarios · `tests/` end-to-end checks
