import { api } from '../api'
import type { VaultState } from '../types'
import { CoverageMeter } from './CoverageMeter'
import { Button, Panel, Pill } from './ui'

export function PartiesPanel({ state }: { state: VaultState }) {
  return (
    <Panel title="Parties" subtitle="Outside companies and how much of the room their agents have seen">
      <div className="space-y-3">
        {state.parties.map((p) => {
          const agents = state.agents.filter((a) => a.party === p.name)
          const active = agents.filter((a) => a.status === 'active').length
          return (
            <div key={p.name} className={`rounded-lg border p-3 ${p.locked ? 'border-rose-500/40 bg-rose-950/20' : 'border-slate-800 bg-slate-900'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{p.name}</span>
                  {p.locked ? <Pill tone="red">locked</Pill> : <Pill tone="green">active</Pill>}
                  {p.split_scraping && <Pill tone="amber">split scraping</Pill>}
                </div>
                {p.locked ? (
                  <Button small tone="green" onClick={() => api.unlockParty(p.name)}>Unlock</Button>
                ) : (
                  <Button small tone="red" onClick={() => api.lockParty(p.name)}>Lock company</Button>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={p.issuer}>IdP {p.issuer}</p>
              <div className="mt-3 flex items-baseline justify-between text-xs">
                <span className="text-slate-400">Coverage across all {p.name} agents</span>
                <span className="font-mono text-slate-200">
                  {Math.round(p.coverage * 100)}% <span className="text-slate-500">({p.revealed}/{p.total} sections)</span>
                </span>
              </div>
              <div className="mt-1.5">
                <CoverageMeter value={p.coverage} alert={state.thresholds.alert} lock={state.thresholds.lock} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                <span>{active}/{agents.length} agents active ·</span>
                {p.folders.map((f) => <Pill key={f}>{f}</Pill>)}
              </div>
              {p.lock_reason && <p className="mt-2 text-xs text-rose-300">{p.lock_reason}</p>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
