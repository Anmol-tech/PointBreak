export function CoverageMeter({ value, alert, lock }: { value: number; alert: number; lock: number }) {
  const color = value >= lock ? 'bg-rose-500' : value >= alert ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(value, 1) * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-amber-300/70" style={{ left: `${alert * 100}%` }} title="alert threshold" />
        <div className="absolute inset-y-0 w-px bg-rose-400/80" style={{ left: `${lock * 100}%` }} title="auto-lock threshold" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>0%</span>
        <span>alert {Math.round(alert * 100)}% · lock {Math.round(lock * 100)}%</span>
      </div>
    </div>
  )
}
