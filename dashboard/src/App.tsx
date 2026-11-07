import { useState } from 'react'
import { api, useVaultState } from './api'
import { ActivityList } from './components/ActivityList'
import { CompaniesPanel } from './components/CompaniesPanel'
import { DemoControls } from './components/DemoControls'
import { FlowView } from './components/FlowView'
import { OwnerTools } from './components/OwnerTools'
import { StoryBanner } from './components/StoryBanner'
import { Button } from './components/ui'

export default function App() {
  const { state, connected } = useVaultState()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const events = state?.events ?? []
  const following = selectedId === null
  const shown = following ? events[events.length - 1] : events.find((e) => e.id === selectedId)

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 11V8a5 5 0 0 1 10 0v3" />
              <rect x="5" y="11" width="14" height="10" rx="2" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">VendorVault <span className="font-normal text-slate-400">· seller's control screen</span></h1>
            <p className="text-[11px] text-slate-400">
              Data room for <span className="text-slate-300">Project Falcon</span>
              {state && <> · answers by <span className="text-slate-300">{state.answer_engine}</span></>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-slate-500">Demo:</span>
          {state && <DemoControls demo={state.demo} onRun={() => setSelectedId(null)} />}
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            {connected ? 'live' : 'connecting'}
          </span>
          <Button small onClick={() => { setSelectedId(null); api.reset() }}>Reset demo</Button>
        </div>
      </header>

      {!state ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Waiting for the gateway on :8000…</div>
      ) : (
        <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-12">
          <div className="flex flex-col gap-4 lg:col-span-3 lg:min-h-0">
            <CompaniesPanel state={state} />
            <OwnerTools state={state} />
          </div>
          <div className="flex flex-col gap-4 lg:col-span-5 lg:min-h-0">
            <StoryBanner demo={state.demo} />
            <FlowView event={shown} following={following} onFollow={() => setSelectedId(null)} />
          </div>
          <div className="flex flex-col lg:col-span-4 lg:min-h-0">
            <ActivityList events={events} selectedId={shown?.id} onSelect={setSelectedId} />
          </div>
        </main>
      )}
    </div>
  )
}
