import { useState } from 'react'
import { api } from '../api'
import type { TraceMatch, VaultState } from '../types'
import { Button, Panel } from './ui'

function Sharing({ state }: { state: VaultState }) {
  function toggle(party: string, folder: string) {
    const p = state.parties.find((x) => x.name === party)
    if (!p) return
    api.setFolders(party, p.folders.includes(folder) ? p.folders.filter((f) => f !== folder) : [...p.folders, folder])
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-500">
          <th className="pb-2 font-medium">Folder</th>
          {state.parties.map((p) => <th key={p.name} className="pb-2 text-center font-medium">{p.name}</th>)}
        </tr>
      </thead>
      <tbody>
        {state.folders.map((f) => (
          <tr key={f.name} className="border-t border-slate-800">
            <td className="py-1.5 text-slate-300" title={f.docs.join('\n')}>{f.name}</td>
            {state.parties.map((p) => (
              <td key={p.name} className="text-center">
                <input
                  type="checkbox"
                  checked={p.folders.includes(f.name)}
                  onChange={() => toggle(p.name, f.name)}
                  className="h-3.5 w-3.5 accent-emerald-500"
                  aria-label={`Share ${f.name} with ${p.name}`}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LeakTracer() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<TraceMatch[] | null>(null)
  return (
    <div>
      <p className="mb-2 text-xs text-slate-400">Found deal text somewhere it shouldn't be? Paste it to see which agent it came from.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Paste leaked text…"
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
      />
      <div className="mt-2">
        <Button onClick={async () => setResult((await api.trace(text)).matches)} disabled={!text.trim()}>Find who leaked it</Button>
      </div>
      {result && (
        <p className={`mt-2 text-xs ${result.length ? 'text-amber-200' : 'text-slate-500'}`}>
          {result.length ? `Came from ${[...result[0].chain].reverse().join(' ← ')}` : 'No matching agent.'}
        </p>
      )}
    </div>
  )
}

export function OwnerTools({ state }: { state: VaultState }) {
  const [tab, setTab] = useState<'sharing' | 'leak'>('sharing')
  return (
    <Panel
      title="Owner tools"
      action={
        <div className="flex rounded-md border border-slate-700 p-0.5 text-[11px]">
          {(['sharing', 'leak'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 ${tab === t ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
            >
              {t === 'sharing' ? 'What each company may see' : 'Find a leak'}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'sharing' ? <Sharing state={state} /> : <LeakTracer />}
    </Panel>
  )
}
