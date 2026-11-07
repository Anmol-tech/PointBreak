import { api } from '../api'
import type { DemoStatus } from '../types'

const ORDER = ['team', 'stolen', 'scrape', 'leak']

export function DemoControls({ demo, onRun }: { demo: DemoStatus; onRun?: () => void }) {
  const busy = demo.running !== null
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {ORDER.map((name, i) => {
          const running = demo.running === name
          return (
            <button
              key={name}
              type="button"
              disabled={busy}
              onClick={() => {
                onRun?.()
                api.runDemo(name)
              }}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed ${
                running
                  ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40'
              }`}
            >
              {running ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-emerald-300 border-t-transparent" />
              ) : (
                <span className="text-slate-500">{i + 1}</span>
              )}
              {demo.scenarios[name]}
            </button>
          )
        })}
      </div>
      {demo.last && !busy && (
        <span
          className={`max-w-xs truncate text-[11px] ${demo.last.ok ? 'text-emerald-300' : 'text-rose-300'}`}
          title={demo.last.message}
        >
          {demo.last.ok ? '✓' : '✕'} {demo.last.message}
        </span>
      )}
    </div>
  )
}
