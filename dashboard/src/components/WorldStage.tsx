import { Suspense, lazy, useCallback, useState } from 'react'
import { api } from '../api'
import { describe } from '../describe'
import type { ActionHandler, Agent, Party, VaultEvent, VaultState } from '../types'
import { Icon } from './Icon'
import type { CheckState } from './journeyTypes'
import type { Selection } from './LiveWorld'

// The 3D world (Three.js) loads only when this screen opens.
const LiveWorld = lazy(() => import('./LiveWorld'))

type LogEntry = { id: number; text: string; decision: VaultEvent['decision'] }

const SCENARIOS: [string, string][] = [
  ['team', 'Vendor agent team'],
  ['onboard', 'Onboard a new vendor'],
  ['stolen', 'Stolen badge'],
  ['scrape', 'Compromised vendor tool'],
  ['leak', 'Leak trace'],
]
const CHECK_LABELS = ['Badge valid', 'Signed with own key', 'Still allowed in', 'Vendor not locked', 'Action allowed', 'Folder shared']
const ABILITY: Record<string, string> = { 'vault:ask': 'ask questions', 'vault:list': 'see the folder list' }

function vendorTone(p: Party) {
  if (p.status === 'offboarded') return 'is-off'
  if (p.locked) return 'is-bad'
  if (p.status === 'invited') return 'is-warn'
  return 'is-ok'
}

function AgentCard({ agent, state, pending, onAction, onSelect }: {
  agent: Agent
  state: VaultState
  pending: boolean
  onAction: ActionHandler
  onSelect: (s: Selection) => void
}) {
  const party = state.parties.find((p) => p.name === agent.party)
  const stopped = agent.status === 'revoked'
  const helpers = state.agents.filter((a) => a.parent === agent.id)
  const recent = state.events.filter((e) => e.agent === agent.id).slice(-5).reverse()
  return (
    <>
      <div className="fp-head">
        <div>
          <span className="eyebrow">AGENT</span>
          <h3>{agent.name}</h3>
        </div>
        <button type="button" className="fp-close" aria-label="Close" onClick={() => onSelect(null)}><Icon name="close" /></button>
      </div>
      <span className={`tag ${stopped || party?.locked ? 'tag-danger' : ''}`}>{stopped ? 'Stopped' : party?.locked ? 'Vendor locked out' : 'Active · key-bound badge'}</span>
      <dl className="fp-facts">
        <div><dt>Works for</dt><dd>{agent.user}</dd></div>
        <div><dt>Vendor</dt><dd><button type="button" className="text-button" onClick={() => onSelect({ kind: 'vendor', id: agent.party })}>{agent.party}</button></dd></div>
        <div><dt>Created by</dt><dd>{agent.parent ? <button type="button" className="text-button" onClick={() => onSelect({ kind: 'agent', id: agent.parent! })}>{agent.parent.split(':')[1]}</button> : `${agent.user} (main agent)`}</dd></div>
        <div><dt>May ask about</dt><dd>{agent.folders.join(', ') || 'nothing'}</dd></div>
        <div><dt>May</dt><dd>{agent.scope.map((s) => ABILITY[s] ?? s).join(' and ')}</dd></div>
        <div><dt>Activity</dt><dd>{agent.calls} requests · {agent.sections_seen} sections seen</dd></div>
        {helpers.length > 0 && <div><dt>Helpers</dt><dd>{helpers.map((h) => <button key={h.id} type="button" className="text-button" onClick={() => onSelect({ kind: 'agent', id: h.id })}>{h.name}</button>)}</dd></div>}
      </dl>
      {recent.length > 0 && (
        <ol className="fp-recent">
          {recent.map((e) => <li key={e.id}><span className={`history-dot decision-${e.decision}`} />{describe(e).headline}</li>)}
        </ol>
      )}
      <div className="fp-actions">
        <button type="button" className="button button-danger button-small" disabled={pending || stopped} onClick={() => void onAction('Stop agent', () => api.revokeAgent(agent.id))}>
          {stopped ? 'Stopped' : helpers.length ? 'Stop agent + helpers' : 'Stop agent'}
        </button>
        {party && party.status === 'active' && (
          <button type="button" className="button button-small" disabled={pending} onClick={() => void onAction('Update vendor access', () => (party.locked ? api.unlockParty(party.name) : api.lockParty(party.name)))}>
            {party.locked ? `Let ${party.name} back in` : `Lock ${party.name}`}
          </button>
        )}
      </div>
    </>
  )
}

function VendorCard({ party, state, pending, onAction, onSelect }: {
  party: Party
  state: VaultState
  pending: boolean
  onAction: ActionHandler
  onSelect: (s: Selection) => void
}) {
  const agents = state.agents.filter((a) => a.party === party.name)
  const pct = Math.round(party.coverage * 100)
  return (
    <>
      <div className="fp-head">
        <div>
          <span className="eyebrow">VENDOR</span>
          <h3>{party.name}</h3>
        </div>
        <button type="button" className="fp-close" aria-label="Close" onClick={() => onSelect(null)}><Icon name="close" /></button>
      </div>
      <span className={`tag ${party.locked || party.status === 'offboarded' ? 'tag-danger' : party.status === 'invited' ? 'tag-warning' : ''}`}>
        {party.status === 'offboarded' ? 'Offboarded' : party.locked ? 'Locked out' : party.status === 'invited' ? 'Invited · not trusted yet' : 'Active vendor'}
      </span>
      <dl className="fp-facts">
        <div><dt>Hired for</dt><dd>{party.purpose || 'Not described'}</dd></div>
        <div><dt>Company login</dt><dd>{party.issuer ?? 'Not connected yet'}</dd></div>
        <div><dt>May ask about</dt><dd>{party.folders.join(', ') || 'nothing'}</dd></div>
      </dl>
      <div className="fp-coverage">
        <span>Seen by all its agents together</span><strong>{pct}%</strong>
        <div className={`coverage-track ${party.coverage >= state.thresholds.lock ? 'coverage-locked' : party.coverage >= state.thresholds.alert ? 'coverage-alert' : ''}`}><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
      </div>
      {party.lock_reason && <p className="fp-warning"><Icon name="alert" />{party.lock_reason}</p>}
      <span className="eyebrow fp-sub">AGENTS · {agents.length}</span>
      {agents.length === 0 ? <p className="muted small">No agents yet.</p> : (
        <ul className="fp-agents">
          {agents.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onSelect({ kind: 'agent', id: a.id })}>
                <span className={`fp-dot ${a.status === 'revoked' ? 'is-off' : party.locked ? 'is-bad' : 'is-ok'}`} />
                {a.name}<small>{a.parent ? 'helper' : 'main agent'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {party.status === 'active' && (
        <div className="fp-actions">
          <button type="button" className="button button-small" disabled={pending} onClick={() => void onAction('Update vendor access', () => (party.locked ? api.unlockParty(party.name) : api.lockParty(party.name)))}>
            {party.locked ? 'Let back in' : 'Lock vendor'}
          </button>
          <button type="button" className="button button-danger button-small" disabled={pending} onClick={() => void onAction('Offboard vendor', () => api.offboardVendor(party.name))}>Offboard</button>
        </div>
      )}
    </>
  )
}

export function WorldStage({ state, pending, onRun, onReset, onAction, onFlat }: {
  state: VaultState
  pending: boolean
  onRun: (name: string) => void
  onReset: () => void
  onAction: ActionHandler
  onFlat: () => void
}) {
  const [speed, setSpeed] = useState(1)
  const [replay, setReplay] = useState(0)
  const [selected, setSelected] = useState<Selection>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [current, setCurrent] = useState<VaultEvent | null>(null)
  const [say, setSay] = useState('Waiting for the next action…')
  const [checks, setChecks] = useState<CheckState[] | null>(null)
  const onLog = useCallback((entries: LogEntry[], event: VaultEvent | null, line: string, live: CheckState[] | null) => {
    setLog(entries)
    setCurrent(event)
    setSay(line)
    setChecks((prev) => (live ? live : event?.kind === 'call' ? prev : null))
  }, [])

  const busy = pending || state.demo.running !== null
  const agent = selected?.kind === 'agent' ? state.agents.find((a) => a.id === selected.id) : undefined
  const vendor = selected?.kind === 'vendor' ? state.parties.find((p) => p.name === selected.id) : undefined
  const currentTone = current ? (current.decision === 'denied' ? 'is-bad' : current.decision === 'alert' ? 'is-warn' : 'is-ok') : ''

  return (
    <section className="world-stage" aria-label="Live 3D world of vendor agents">
      <Suspense fallback={<div className="j3d-canvas is-stage j3d-loading">Loading the live world…</div>}>
        <LiveWorld state={state} speed={speed} replayToken={replay} selected={selected} onSelect={setSelected} onLog={onLog} />
      </Suspense>

      <div className="stage-overlay">
      <div className="stage-col stage-left">
      <div className="float-panel fp-scenarios">
        <span className="eyebrow">TRY A SCENARIO</span>
        <div className="fp-scenario-list">
          {SCENARIOS.map(([id, label], i) => (
            <button key={id} type="button" className={`fp-scenario ${state.demo.running === id ? 'is-running' : ''}`} disabled={busy} onClick={() => { setSelected(null); onRun(id) }}>
              {state.demo.running === id ? <span className="spinner" /> : <span className="fp-num">{i + 1}</span>}
              {label}
            </button>
          ))}
        </div>
        {state.demo.last && !state.demo.running && <p className={`fp-result ${state.demo.last.ok ? '' : 'is-bad'}`} title={state.demo.last.message}>{state.demo.last.message}</p>}
        <div className="fp-tools">
          <button type="button" className="text-button" disabled={busy} onClick={() => { setSelected(null); onReset() }}><Icon name="reset" />Reset</button>
          <button type="button" className="text-button" disabled={!state.events.length} onClick={() => setReplay((r) => r + 1)}>Replay 10</button>
          <button type="button" className="text-button" onClick={() => setSpeed(speed === 1 ? 2 : 1)}>{speed}× speed</button>
          <button type="button" className="text-button" onClick={onFlat}>Flat view</button>
        </div>
      </div>

      <div className="float-panel fp-vendors">
        <span className="eyebrow">VENDORS · {state.parties.length}</span>
        <ul>
          {state.parties.map((p) => (
            <li key={p.name}>
              <button type="button" className={selected?.kind === 'vendor' && selected.id === p.name ? 'is-selected' : ''} onClick={() => setSelected({ kind: 'vendor', id: p.name })}>
                <span className={`fp-dot ${vendorTone(p)}`} />
                <span className="fp-vendor-name">{p.name}<small>{p.status === 'invited' ? 'invited' : p.purpose}</small></span>
                <span className="fp-mini-bar"><span style={{ width: `${Math.min(100, Math.round(p.coverage * 100))}%` }} className={vendorTone(p)} /></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      </div>

      <div className="stage-center">
        <p className={`fp-narration ${currentTone}`} aria-live="polite" key={say}>{say}</p>
      </div>

      <div className="stage-col stage-right">
      <div className={`float-panel fp-live ${currentTone}`}>
        <span className="eyebrow"><span className="fp-pulse" />LIVE NOW</span>
        <h3>{current ? describe(current).headline : 'Waiting for the next action'}</h3>
        {current?.chain?.length ? <p className="fp-chain">{[...current.chain].reverse().join(' ← ')}</p> : null}
        <ol className="fp-checks">
          {CHECK_LABELS.map((label, i) => {
            const st = checks?.[i] ?? 'wait'
            return <li key={label} className={`check-${st}`}><span>{st === 'ok' ? '✓' : st === 'fail' ? '✕' : st === 'skip' ? '–' : i + 1}</span>{label}</li>
          })}
        </ol>
      </div>

      <div className="float-panel fp-side">
        {agent ? <AgentCard agent={agent} state={state} pending={pending} onAction={onAction} onSelect={setSelected} />
          : vendor ? <VendorCard party={vendor} state={state} pending={pending} onAction={onAction} onSelect={setSelected} />
            : (
              <>
                <span className="eyebrow">ACTION LOG</span>
                {log.length === 0 ? <p className="muted small">Run a scenario, or start an agent in the vendor portal. Every real action plays in the world.</p> : (
                  <ol className="fp-log">
                    {log.map((entry, i) => <li key={entry.id} className={i === 0 ? 'is-current' : ''}><span className={`history-dot decision-${entry.decision}`} />{entry.text}</li>)}
                  </ol>
                )}
                <p className="fp-tip">Tip: click any robot or padlock to inspect it.</p>
              </>
            )}
      </div>
      </div>
      </div>
    </section>
  )
}
