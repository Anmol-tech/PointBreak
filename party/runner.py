"""Multi-agent demo: LexPartners' lead agent spawns two narrower reviewer helpers.

Usage: python -m party.runner [--pause SECONDS]
"""

import argparse
import time

from party.client import PROXY_URL, McpAgent, create_root, say, spawn


def run_team(pause: float = 1.5, proxy: str = PROXY_URL) -> str:
    def step(title):
        print(f"\n— {title}")
        time.sleep(pause)

    step("dana@lexpartners.com starts LexPartners' lead agent (ID-JAG from LexPartners' login → key-bound badge)")
    create_root("LexPartners", "dana@lexpartners.com", "lex-lead", proxy=proxy)

    step("lead agent creates helpers with narrower access (token exchange)")
    spawn("lex-lead", "contracts-reviewer", folders=["Contracts"], proxy=proxy)
    spawn("lex-lead", "customer-reviewer", folders=["Customers"], proxy=proxy)
    say("contracts-reviewer", "identity: contracts-reviewer ← lex-lead ← dana@lexpartners.com ← LexPartners (Contracts)")
    say("customer-reviewer", "identity: customer-reviewer ← lex-lead ← dana@lexpartners.com ← LexPartners (Customers)")

    contracts, customers = McpAgent("contracts-reviewer", proxy), McpAgent("customer-reviewer", proxy)
    contracts.initialize()
    customers.initialize()

    step("contracts reviewer asks about change-of-control risk")
    say("contracts-reviewer", *contracts.tool("ask_question", question="Which customer contracts have change of control clauses?"))

    step("customer reviewer asks about customer concentration")
    say("customer-reviewer", *customers.tool("ask_question", question="How concentrated is revenue among top customers?"))

    step("contracts reviewer tries to download a full contract")
    say("contracts-reviewer", *contracts.tool("get_document", path="Contracts/globex-customer-agreement.md"))

    step("contracts reviewer asks about Financials, which LexPartners' legal work does not include")
    say("contracts-reviewer", *contracts.tool("ask_question", question="What was quarterly revenue?", folder="Financials"))

    step("customer reviewer tries Contracts, which only its sibling was given")
    say("customer-reviewer", *customers.tool("ask_question", question="Change of control terms", folder="Contracts"))
    return "LexPartners team created: lead agent and two reviewers asked questions; 3 requests blocked"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pause", type=float, default=1.5, help="seconds between steps (for live demos)")
    args = ap.parse_args()
    from party.client import PartyError
    try:
        print("\n" + run_team(args.pause))
    except PartyError as e:
        say("lex-lead", str(e), denied=True)
        return
    print("Stop an agent on the dashboard, then re-run a call to see it blocked.")


if __name__ == "__main__":
    main()
