import { api } from '../api'
import type { Agent, VaultState } from '../types'
import { CoverageMeter } from './CoverageMeter'
import { Button, Panel, Pill } from './ui'

function AgentCard({ agent, all, depth }: { agent: Agent; all: Agent[]; depth: number }) {
  const helpers = all.filter((a) => a.parent === agent.id)
  const revoked = agent.status === 'revoked'
  return (
    <li>
      <div className={`rounded-lg border px-3 py-2 ${revoked ? 'border-rose-500/30 bg-rose-950/20' : 'border-slate-800 bg-slate-950/40'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${revoked ? 'bg-rose-500' : 'bg-emerald-400'}`} />
            <span className={`truncate font-mono text-sm ${revoked ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{agent.name}</span>
            <span className="text-[10px] text-slate-500">{depth === 0 ? 'main agent' : 'helper'}</span>
          </div>
          <Button small tone="red" disabled={revoked} onClick={() => api.revokeAgent(agent.id)}>
            {revoked ? 'Stopped' : 'Stop'}
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          {revoked ? 'Stopped by the owner' : <>Can ask about <span className="text-slate-300">{agent.folders.join(', ')}</span></>}
          {agent.calls > 0 && <span className="text-slate-500"> · {agent.calls} requests</span>}
        </p>
      </div>
      {helpers.length > 0 && (
        <ul className="ml-3 mt-1.5 space-y-1.5 border-l border-dashed border-slate-700 pl-3">
          {helpers.map((h) => <AgentCard key={h.id} agent={h} all={all} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  )
}

export function CompaniesPanel({ state }: { state: VaultState }) {
  return (
    <Panel title="Who is inside" subtitle="Buyer companies, the person behind each agent, and how much they've seen">
      <div className="space-y-3">
        {state.parties.map((p) => {
          const roots = state.agents.filter((a) => a.party === p.name && !a.parent)
          const users = [...new Set(roots.map((r) => r.user))]
          return (
            <div key={p.name} className={`rounded-xl border p-3 ${p.locked ? 'border-rose-500/40 bg-rose-950/15' : 'border-slate-800 bg-slate-900'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{p.name}</span>
                  {p.locked ? <Pill tone="red">locked out</Pill> : <Pill tone="green">allowed in</Pill>}
                  {p.split_scraping && <Pill tone="amber">copying across agents</Pill>}
                </div>
                {p.locked ? (
                  <Button small tone="green" onClick={() => api.unlockParty(p.name)}>Let back in</Button>
                ) : (
                  <Button small tone="red" onClick={() => api.lockParty(p.name)}>Lock out</Button>
                )}
              </div>
              <div className="mt-2.5 flex items-baseline justify-between text-[11px]">
                <span className="text-slate-400">Seen by all {p.name} agents together</span>
                <span className="font-mono text-slate-200">{Math.round(p.coverage * 100)}%</span>
              </div>
              <div className="mt-1">
                <CoverageMeter value={p.coverage} alert={state.thresholds.alert} lock={state.thresholds.lock} />
              </div>
              {p.lock_reason && <p className="mt-1.5 text-[11px] text-rose-300">{p.lock_reason}</p>}
              {roots.length > 0 ? (
                <div className="mt-3">
                  {users.map((u) => (
                    <div key={u} className="mb-2 last:mb-0">
                      <p className="mb-1.5 text-[11px] text-slate-400">👤 {u}</p>
                      <ul className="space-y-1.5">
                        {roots.filter((r) => r.user === u).map((r) => <AgentCard key={r.id} agent={r} all={state.agents} depth={0} />)}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-slate-500">No agents yet</p>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
