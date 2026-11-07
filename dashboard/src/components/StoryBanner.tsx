import type { DemoStatus } from '../types'

const STORIES: Record<string, { what: string; watch: string }> = {
  team: {
    what: "BuyerCo's AI team arrives. Alice's main agent gets a badge, creates a legal helper and a finance helper with less access, they ask questions, and three forbidden requests are blocked.",
    watch: 'Watch the agents appear on the left and each request’s checks in the middle.',
  },
  stolen: {
    what: "A hacker copies finance-agent's badge and tries to use it from another computer. The badge only works together with the agent's own secret key, so both tries fail.",
    watch: 'Watch the middle: step 2, the key check, fails.',
  },
  scrape: {
    what: 'RivalBid splits its copying across 5 helper agents so no single one looks suspicious. VendorVault adds up what the whole company has seen and locks it out at 70%.',
    watch: "Watch RivalBid's bar on the left turn red.",
  },
  leak: {
    what: 'An answer shows up outside the deal. Its invisible fingerprint points back to the exact agent and the person who started it.',
    watch: 'Watch the newest event: it names who leaked it.',
  },
}

export function StoryBanner({ demo }: { demo: DemoStatus }) {
  const name = demo.running ?? demo.last?.name
  if (!name) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
        <span className="font-medium text-white">How to use this screen: </span>
        you are the seller. Buyer companies send AI agents into your data room. Press the demo buttons in order
        (1 → 4) to see how agents get ID badges, what they ask, and what gets blocked.
      </div>
    )
  }
  const story = STORIES[name]
  const running = demo.running === name
  return (
    <div className={`rounded-xl border px-4 py-3 ${running ? 'border-emerald-500/40 bg-emerald-950/30' : 'border-slate-800 bg-slate-900/60'}`}>
      <p className="text-[11px] uppercase tracking-wider text-emerald-300/80">
        {running ? 'Running now' : 'Last demo'}: {demo.scenarios[name]}
      </p>
      <p className="mt-1 text-sm text-slate-100">{story.what}</p>
      <p className="mt-1 text-xs text-slate-400">{running ? story.watch : demo.last?.message}</p>
    </div>
  )
}
