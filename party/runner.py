"""Multi-agent demo: BuyerCo's orchestrator spawns legal and finance sub-agents.

Usage: python -m party.runner [--pause SECONDS]
"""

import argparse
import time

from party.client import PROXY_URL, McpAgent, create_root, say, spawn


def run_team(pause: float = 1.5, proxy: str = PROXY_URL) -> str:
    def step(title):
        print(f"\n— {title}")
        time.sleep(pause)

    step("alice@buyerco.com starts BuyerCo's orchestrator (ID-JAG from BuyerCo's IdP → DPoP-bound token)")
    create_root("BuyerCo", "alice@buyerco.com", "buyer-orchestrator", proxy=proxy)

    step("orchestrator spawns specialist sub-agents with narrower access (token exchange)")
    spawn("buyer-orchestrator", "legal-agent", folders=["Contracts", "Customers"], proxy=proxy)
    spawn("buyer-orchestrator", "finance-agent", folders=["Financials"], proxy=proxy)
    say("legal-agent", "identity: legal-agent ← buyer-orchestrator ← alice@buyerco.com ← BuyerCo (Contracts, Customers)")
    say("finance-agent", "identity: finance-agent ← buyer-orchestrator ← alice@buyerco.com ← BuyerCo (Financials)")

    legal, finance = McpAgent("legal-agent", proxy), McpAgent("finance-agent", proxy)
    legal.initialize()
    finance.initialize()

    step("legal agent asks about change-of-control risk")
    say("legal-agent", *legal.tool("ask_question", question="Which customer contracts have change of control clauses?"))

    step("finance agent asks about revenue")
    say("finance-agent", *finance.tool("ask_question", question="What was quarterly revenue and operating income?"))

    step("finance agent tries to download the raw income statement")
    say("finance-agent", *finance.tool("get_document", path="Financials/income-statement-fy2025.md"))

    step("finance agent tries the unshared Board Minutes folder")
    say("finance-agent", *finance.tool("ask_question", question="What is the minimum acceptable price?", folder="Board Minutes"))

    step("finance agent tries Contracts, which only the legal agent was given")
    say("finance-agent", *finance.tool("ask_question", question="Change of control terms", folder="Contracts"))
    return "BuyerCo team created: orchestrator, legal-agent and finance-agent asked questions; 3 requests blocked"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pause", type=float, default=1.5, help="seconds between steps (for live demos)")
    args = ap.parse_args()
    from party.client import PartyError
    try:
        print("\n" + run_team(args.pause))
    except PartyError as e:
        say("buyer-orchestrator", str(e), denied=True)
        return
    print("Revoke an agent on the dashboard, then re-run a call to see it blocked.")


if __name__ == "__main__":
    main()
