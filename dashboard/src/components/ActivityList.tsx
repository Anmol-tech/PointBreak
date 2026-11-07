import { describe } from '../describe'
import type { VaultEvent } from '../types'
import { Panel, timeLabel } from './ui'

const DOT = {
  allowed: 'bg-emerald-400',
  blocked: 'bg-rose-500',
  alert: 'bg-amber-400',
  info: 'bg-slate-500',
}
const WORD = { allowed: 'Allowed', blocked: 'Blocked', alert: 'Alert', info: 'Info' }
const WORD_COLOR = { allowed: 'text-emerald-300', blocked: 'text-rose-300', alert: 'text-amber-300', info: 'text-slate-400' }

export function ActivityList({ events, selectedId, onSelect }: {
  events: VaultEvent[]
  selectedId: number | undefined
  onSelect: (id: number) => void
}) {
  const list = [...events].reverse()
  const blocked = events.filter((e) => e.decision === 'denied').length
  return (
    <Panel title="Everything that happened" subtitle={`${events.length} events · ${blocked} blocked · click one to see its checks`}>
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">Waiting for agents…</p>
      ) : (
        <ul className="space-y-1">
          {list.map((e) => {
            const s = describe(e)
            const selected = e.id === selectedId
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelect(e.id)}
                  className={`flash-in flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                    selected ? 'bg-slate-800 ring-1 ring-slate-600' : 'hover:bg-slate-800/60'
                  }`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[s.outcome]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-xs text-slate-200">{s.headline}</span>
                    <span className="mt-0.5 flex gap-2 text-[10px]">
                      <span className={WORD_COLOR[s.outcome]}>{WORD[s.outcome]}</span>
                      <span className="text-slate-500">{timeLabel(e.ts)}</span>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
