import { useMemo, useState } from 'react'
import type { VaultEvent, VaultState } from '../types'
import { Panel, Pill, chainLabel, timeLabel } from './ui'

const decisionStyle = {
  allowed: { tone: 'green' as const, bar: 'bg-emerald-500', label: 'allowed' },
  denied: { tone: 'red' as const, bar: 'bg-rose-500', label: 'blocked' },
  alert: { tone: 'amber' as const, bar: 'bg-amber-400', label: 'alert' },
  info: { tone: 'slate' as const, bar: 'bg-slate-500', label: 'info' },
}

function title(e: VaultEvent): string {
  if (e.kind === 'call') return e.tool ?? 'call'
  if (e.kind === 'token') return e.decision === 'allowed' ? 'identity issued' : 'identity refused'
  return e.kind
}

function EventRow({ e }: { e: VaultEvent }) {
  const [open, setOpen] = useState(false)
  const s = decisionStyle[e.decision]
  return (
    <li className="flash-in relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <span className={`absolute inset-y-0 left-0 w-1 ${s.bar}`} />
      <button type="button" onClick={() => setOpen(!open)} className="w-full px-3 py-2 pl-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Pill tone={s.tone}>{s.label}</Pill>
            <span className="font-mono text-xs text-slate-200">{title(e)}</span>
            {e.chain.length > 0 && (
              <span className="truncate text-[11px] text-slate-400">{chainLabel(e.chain)}</span>
            )}
          </div>
          <span className="shrink-0 font-mono text-[10px] text-slate-500">{timeLabel(e.ts)}</span>
        </div>
        {e.question && <p className="mt-1 text-xs text-slate-300">“{e.question}”</p>}
        {e.reason && <p className={`mt-0.5 text-[11px] ${e.decision === 'denied' ? 'text-rose-300' : 'text-slate-400'}`}>{e.reason}</p>}
      </button>
      {open && (e.answer || e.sources?.length || e.detail) && (
        <div className="border-t border-slate-800 bg-slate-950/50 px-4 py-2 text-[11px] text-slate-300">
          {e.answer && <pre className="whitespace-pre-wrap font-sans leading-relaxed">{e.answer}</pre>}
          {e.detail?.folders && <p className="mt-1 text-slate-400">Folders: {e.detail.folders.join(', ')} · Scope: {e.detail.scope?.join(', ')}</p>}
        </div>
      )}
    </li>
  )
}

export function QAFeed({ state }: { state: VaultState }) {
  const [filter, setFilter] = useState<'all' | 'denied'>('all')
  const events = useMemo(() => {
    const list = [...state.events].reverse()
    return filter === 'denied' ? list.filter((e) => e.decision !== 'allowed' && e.decision !== 'info') : list
  }, [state.events, filter])
  const blocked = state.events.filter((e) => e.decision === 'denied').length

  return (
    <Panel
      title="Live activity"
      subtitle={`${state.events.length} events · ${blocked} blocked · click a row for the answer that was shared`}
      action={
        <div className="flex rounded-md border border-slate-700 p-0.5 text-[11px]">
          {(['all', 'denied'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 ${filter === f ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
            >
              {f === 'all' ? 'All' : 'Blocked & alerts'}
            </button>
          ))}
        </div>
      }
    >
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">Waiting for agent activity…</p>
      ) : (
        <ul className="space-y-2">{events.map((e) => <EventRow key={e.id} e={e} />)}</ul>
      )}
    </Panel>
  )
}
