import { api } from '../api'
import type { Agent, VaultState } from '../types'
import { Button, Panel, Pill } from './ui'

function AgentNode({ agent, all, depth }: { agent: Agent; all: Agent[]; depth: number }) {
  const children = all.filter((a) => a.parent === agent.id)
  const revoked = agent.status === 'revoked'
  return (
    <li>
      <div className={`group rounded-lg border px-3 py-2 transition ${revoked ? 'border-rose-500/30 bg-rose-950/20' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${revoked ? 'bg-rose-500' : 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60'}`} />
            <span className={`truncate font-mono text-sm ${revoked ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{agent.name}</span>
            {depth === 0 ? <Pill tone="blue">root</Pill> : <Pill>sub-agent</Pill>}
          </div>
          <Button small tone="red" disabled={revoked} onClick={() => api.revokeAgent(agent.id)}>
            {revoked ? 'Revoked' : children.length ? 'Revoke branch' : 'Revoke'}
          </Button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          <span>acts for <span className="text-slate-300">{agent.user}</span></span>
          <span>·</span>
          {agent.folders.map((f) => <Pill key={f}>{f}</Pill>)}
          {agent.scope.map((s) => <Pill key={s} tone="blue">{s.replace('vault:', '')}</Pill>)}
        </div>
        <div className="mt-1 flex gap-3 font-mono text-[10px] text-slate-500">
          <span>{agent.calls} calls</span>
          <span>{agent.sections_seen} sections seen</span>
          <span>key-bound token (DPoP)</span>
          <span>fp {agent.fingerprint}</span>
        </div>
        {agent.revoked_reason && <p className="mt-1 text-[11px] text-rose-300">{agent.revoked_reason}</p>}
      </div>
      {children.length > 0 && (
        <ul className="ml-4 mt-2 space-y-2 border-l border-dashed border-slate-700 pl-4">
          {children.map((c) => <AgentNode key={c.id} agent={c} all={all} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  )
}

export function AgentTree({ state }: { state: VaultState }) {
  return (
    <Panel title="Agent identities" subtitle="Who each agent is, who it acts for, and what it was delegated">
      {state.agents.length === 0 ? (
        <p className="text-sm text-slate-500">No agents yet. Start one with OpenCode or <code className="text-slate-300">python -m party.runner</code>.</p>
      ) : (
        <div className="space-y-5">
          {state.parties.map((p) => {
            const roots = state.agents.filter((a) => a.party === p.name && !a.parent)
            if (!roots.length) return null
            return (
              <div key={p.name}>
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
                  <span>{p.name}</span>
                  <span className="h-px flex-1 bg-slate-800" />
                </div>
                <ul className="space-y-2">
                  {roots.map((r) => <AgentNode key={r.id} agent={r} all={state.agents} depth={0} />)}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
