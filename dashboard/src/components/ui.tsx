import type { ReactNode } from 'react'

export function Panel({ title, subtitle, action, children, className = '' }: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 lg:min-h-0 ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-auto">{children}</div>
    </section>
  )
}

const tones = {
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  red: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  slate: 'bg-slate-700/40 text-slate-300 ring-slate-600/40',
  blue: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
}

export function Pill({ tone = 'slate', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Button({ children, onClick, tone = 'slate', disabled, small }: {
  children: ReactNode
  onClick?: () => void
  tone?: 'slate' | 'red' | 'green'
  disabled?: boolean
  small?: boolean
}) {
  const colors = {
    slate: 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
    red: 'border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
    green: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${colors} ${small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs'}`}
    >
      {children}
    </button>
  )
}

export function chainLabel(chain: string[]): string {
  return [...chain].reverse().join(' ← ')
}

export function timeLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
