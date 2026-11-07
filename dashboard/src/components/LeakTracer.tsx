import { useState } from 'react'
import { api } from '../api'
import type { TraceMatch } from '../types'
import { Button, Panel, chainLabel } from './ui'

export function LeakTracer() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<TraceMatch[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function trace() {
    setBusy(true)
    try {
      setResult((await api.trace(text)).matches)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Leak tracer" subtitle="Paste text found outside the deal to see which agent it came from">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Paste a leaked paragraph…"
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button onClick={trace} disabled={!text.trim() || busy}>{busy ? 'Tracing…' : 'Trace leak'}</Button>
        {result && result.length === 0 && <span className="text-xs text-slate-500">No matching agent.</span>}
      </div>
      {result && result.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs">
          <p className="font-semibold text-amber-200">Traced to {chainLabel(result[0].chain)}</p>
          <p className="mt-1 text-amber-200/70">
            via {result[0].method} · {Math.round(result[0].confidence * 100)}% confidence
          </p>
        </div>
      )}
    </Panel>
  )
}
