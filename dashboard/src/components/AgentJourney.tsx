import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import { describe } from '../describe'
import type { ActionHandler, Agent, VaultEvent, VaultState } from '../types'
import { Icon } from './Icon'
import type { NodeId, Phase } from './journeyTypes'
import { WorldStage } from './WorldStage'

/** Animated replay of a real request: identity → badge → question → checks → answer (or block). */

const X: Record<NodeId, number> = { person: 7, login: 27, agent: 47, gate: 70, vault: 91 }

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

const clean = (text: string) => text.replace(/[\u200b\u200c\ufeff]/g, '')
const shortName = (id: string | null | undefined) => (id ? id.split(':').slice(1).join(':') || id : '')

function buildPhases(event: VaultEvent, agent: Agent | undefined): { phases: Phase[]; mintAt: number; checksAt: number; failIdx: number } {
  const story = describe(event)
  const checks = story.steps.slice(0, 6)
  const failIdx = checks.findIndex((s) => s.state === 'fail')
  const impostor = event.decision !== 'allowed' && failIdx === 1
  const vendor = event.party ?? agent?.party ?? 'The vendor'
  const user = agent?.user ?? 'an employee'
  const name = agent?.name ?? story.actor
  const phases: Phase[] = []
  let mintAt = -1

  if (!impostor && agent) {
    if (!agent.parent) {
      phases.push({ key: 'signin', from: 'person', to: 'login', packet: 'Sign in', tone: 'info', focus: ['person', 'login'], ms: 1300,
        say: `${user} signs in at ${vendor}'s own company login.` })
      phases.push({ key: 'vouch', from: 'login', to: 'agent', packet: 'Signed ID-JAG', tone: 'info', focus: ['login', 'agent'], ms: 1500,
        say: `${vendor}'s login vouches for the agent: “${name} works for ${user} on this deal.”` })
    } else {
      phases.push({ key: 'parent', focus: ['agent'], ms: 1500,
        say: `${shortName(agent.parent)} creates a helper, ${name}, and asks for only part of its own access.` })
    }
    phases.push({ key: 'present', from: 'agent', to: 'gate', packet: agent.parent ? 'Token exchange + key proof' : 'ID-JAG + key proof', tone: 'info', focus: ['agent', 'gate'], ms: 1500,
      say: `The agent sends that to VendorVault and proves it holds its own secret key.` })
    mintAt = phases.length
    phases.push({ key: 'mint', focus: ['gate'], ms: 1900,
      say: `VendorVault verifies ${vendor}'s signature and mints a 15-minute badge locked to that key.` })
    phases.push({ key: 'deliver', from: 'gate', to: 'agent', packet: 'ID badge', tone: 'ok', focus: ['gate', 'agent'], ms: 1300,
      say: `Badge delivered: who the agent is, who it works for, and what it may ask about.` })
  }

  const asked = event.question ? `“${event.question}”` : story.headline
  phases.push({ key: 'ask', from: 'agent', to: 'gate', packet: impostor ? 'Copied badge' : event.tool === 'ask_question' ? 'Question' : 'Request', tone: impostor ? 'bad' : 'info', focus: ['agent', 'gate'], ms: 1500,
    say: impostor ? `An attacker replays ${name}'s copied badge from another machine: ${asked}` : `${name} asks: ${asked}` })

  const checksAt = phases.length
  for (let i = 0; i < checks.length; i++) {
    const failed = i === failIdx
    phases.push({ key: `check-${i}`, check: i, focus: ['gate'], ms: failed ? 1600 : 600, tone: failed ? 'bad' : 'ok',
      say: failed ? `✕ ${checks[i].label}: ${checks[i].detail ?? event.reason ?? ''}` : `✓ ${checks[i].label}` })
    if (failed) {
      phases.push({ key: 'blocked', from: 'gate', to: 'agent', packet: 'Blocked', tone: 'bad', focus: ['gate', 'agent'], ms: 2200,
        say: `Blocked. Nothing from the vault was touched. ${event.reason ?? ''}` })
      return { phases, mintAt, checksAt, failIdx }
    }
  }

  if (event.tool === 'list_folders') {
    phases.push({ key: 'outline', from: 'gate', to: 'agent', packet: 'Folder names only', tone: 'ok', focus: ['gate', 'agent'], ms: 1800,
      say: 'Only folder and section names go back. No document content.' })
    return { phases, mintAt, checksAt, failIdx }
  }
  phases.push({ key: 'search', from: 'gate', to: 'vault', packet: 'Search inside', tone: 'info', focus: ['gate', 'vault'], ms: 1400,
    say: 'The vault agent reads the documents inside Falcon’s walls.' })
  phases.push({ key: 'found', focus: ['vault'], ms: 1700,
    say: `Found ${event.sources?.length ?? 0} relevant section${event.sources?.length === 1 ? '' : 's'}. Private data is masked and an invisible fingerprint is added.` })
  phases.push({ key: 'answer', from: 'vault', to: 'agent', packet: 'Masked answer', tone: 'ok', focus: ['vault', 'gate', 'agent'], ms: 1800,
    say: 'Only a short answer travels back. The documents themselves never move.' })
  phases.push({ key: 'done', focus: ['agent'], ms: 1200, say: `Done. ${name} got an answer, never the file.` })
  return { phases, mintAt, checksAt, failIdx }
}

function Packet({ phase }: { phase: Phase }) {
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMoving(true)))
    return () => cancelAnimationFrame(raf)
  }, [])
  if (!phase.from || !phase.to) return null
  const left = moving ? X[phase.to] : X[phase.from]
  return (
    <div className={`journey-packet tone-${phase.tone ?? 'info'}`} style={{ left: `${left}%` }}>
      <span className="journey-packet-dot" />
      {phase.packet}
    </div>
  )
}

function Node({ id, icon, title, sub, focus, children, shake }: {
  id: NodeId
  icon: Parameters<typeof Icon>[0]['name']
  title: string
  sub: string
  focus: boolean
  children?: ReactNode
  shake?: boolean
}) {
  return (
    <div className={`journey-node node-${id} ${focus ? 'is-focus' : ''} ${shake ? 'is-shaking' : ''}`} style={{ left: `${X[id]}%` }}>
      <span className="journey-node-icon"><Icon name={icon} /></span>
      <strong>{title}</strong>
      <small>{sub}</small>
      {children}
    </div>
  )
}

export function AgentJourney({ state, pending, onRun, onReset, onAction }: {
  state: VaultState
  pending: boolean
  onRun: (name: string) => void
  onReset: () => void
  onAction: ActionHandler
}) {
  const calls = useMemo(() => state.events.filter((e) => e.kind === 'call'), [state.events])
  const newest = calls[calls.length - 1]
  const [following, setFollowing] = useState(true)
  const [eventId, setEventId] = useState<number | null>(null)
  const [p, setP] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [view3d, setView3d] = useState(webglAvailable)

  const event = calls.find((e) => e.id === eventId)
  const agent = state.agents.find((a) => a.id === event?.agent)
  const { phases, mintAt, checksAt, failIdx } = useMemo(
    () => (event ? buildPhases(event, agent) : { phases: [] as Phase[], mintAt: -1, checksAt: 0, failIdx: -1 }),
    // agent changes (call counts) must not restart the animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event?.id],
  )
  const phase = phases[p]

  function play(id: number) {
    setEventId(id)
    setP(0)
    setPlaying(true)
  }

  // Follow live: when idle, animate the newest request.
  useEffect(() => {
    if (following && !playing && newest && newest.id !== eventId) play(newest.id)
  }, [following, playing, newest, eventId])

  useEffect(() => {
    if (!playing || !phase) return
    if (p >= phases.length - 1) {
      const t = window.setTimeout(() => setPlaying(false), phase.ms / speed)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => setP(p + 1), phase.ms / speed)
    return () => window.clearTimeout(t)
  }, [playing, p, phase, phases.length, speed])

  if (view3d) return <WorldStage state={state} pending={pending} onRun={onRun} onReset={onReset} onAction={onAction} onFlat={() => setView3d(false)} />

  if (!newest) {
    return (
      <section className="journey journey-empty">
        <span className="empty-icon"><Icon name="agents" /></span>
        <h2>Watch an agent prove who it is.</h2>
        <p className="muted">Start the vendor agent team. Each agent gets its ID badge, asks for information, and every check plays out here.</p>
        <button type="button" className="button button-primary" disabled={state.demo.running !== null} onClick={() => void api.runDemo('team')}>
          <Icon name="play" />Start the vendor agent team
        </button>
      </section>
    )
  }

  const focus = new Set(phase?.focus ?? [])
  // A copied badge is on screen from the start: the attacker never went through sign-in.
  const showBadge = mintAt >= 0 ? p >= mintAt : failIdx === 1
  const showChecks = p >= checksAt
  const failed = phase?.key === 'blocked' || (failIdx >= 0 && p > checksAt + failIdx)
  const searching = ['search', 'found', 'answer', 'done'].includes(phase?.key ?? '')
  const answered = ['answer', 'done'].includes(phase?.key ?? '') && !!event?.answer
  const sourceFolders = new Set((event?.sources ?? []).map((s) => s.split('/')[0]))
  const checks = event ? describe(event).steps.slice(0, 6) : []
  const progress = phases.length ? Math.round(((p + (playing ? 0 : 1)) / phases.length) * 100) : 0

  return (
    <section className="journey" aria-label="Animated agent journey">
      <div className="journey-toolbar">
        <div>
          <span className="eyebrow">{following ? 'LIVE · FOLLOWING NEW REQUESTS' : 'REPLAY'}</span>
          <h2>{event ? describe(event).headline : 'Waiting for the next request'}</h2>
        </div>
        <div className="inline-actions">
          <select aria-label="Choose a request to replay" value={event?.id ?? ''} onChange={(e) => { setFollowing(false); play(Number(e.target.value)) }}>
            {[...calls].reverse().slice(0, 30).map((c) => <option key={c.id} value={c.id}>{c.decision === 'allowed' ? '✓' : '✕'} {describe(c).headline.slice(0, 70)}</option>)}
          </select>
          <button type="button" className="button button-small" onClick={() => event && play(event.id)}><Icon name="reset" />Replay</button>
          <button type="button" className="button button-small" onClick={() => setSpeed(speed === 1 ? 2 : 1)}>{speed}× speed</button>
          {webglAvailable() && <button type="button" className="button button-small" onClick={() => setView3d(true)}>3D live world</button>}
          {!following && <button type="button" className="text-button" onClick={() => setFollowing(true)}>Follow live</button>}
        </div>
      </div>

      <div className="journey-progress"><span style={{ width: `${progress}%` }} /></div>

      <div className="journey-scroll">
        <div className="journey-stage">
          <div className="journey-zone zone-vendor"><span>{event?.party ?? 'Vendor'}’s environment</span></div>
          <div className="journey-zone zone-client"><span>{state.client}’s environment</span></div>
          <div className="journey-divider" />
          <div className="journey-track" />

          <Node id="person" icon="agents" title={agent?.user?.split('@')[0] ?? 'Employee'} sub="Employee" focus={focus.has('person')} />
          <Node id="login" icon="key" title={`${event?.party ?? 'Vendor'} login`} sub="Company identity provider" focus={focus.has('login')} />
          <Node id="agent" icon="answer" title={agent?.name ?? shortName(event?.agent) ?? 'Agent'} sub={agent?.parent ? `Helper of ${shortName(agent.parent)}` : 'AI agent'} focus={focus.has('agent')}>
            {showBadge && <span className="journey-mini-badge"><Icon name="shield" />Badge</span>}
          </Node>
          <Node id="gate" icon="shield" title="VendorVault" sub="Identity + access checks" focus={focus.has('gate')} shake={phase?.tone === 'bad' && (phase.check !== undefined || phase.key === 'blocked')} />
          <Node id="vault" icon="lock" title="Vault agent" sub={state.answer_engine} focus={focus.has('vault')}>
            <span className="journey-folders">
              {state.folders.map((f) => {
                const allowed = agent?.folders.includes(f.name)
                const lit = searching && sourceFolders.has(f.name)
                return <span key={f.name} className={`journey-folder ${allowed ? 'is-allowed' : 'is-locked'} ${lit ? 'is-lit' : ''}`}><Icon name={allowed ? 'folder' : 'lock'} />{f.name}</span>
              })}
            </span>
            {searching && <span className="journey-stay">Documents stay here</span>}
          </Node>

          {phase?.packet && <Packet key={`${event?.id}-${p}`} phase={phase} />}
        </div>
      </div>

      <p className={`journey-say ${phase?.tone === 'bad' ? 'is-bad' : ''}`} aria-live="polite" key={`${event?.id}-${p}-say`}>{phase?.say}</p>

      <div className="journey-details">
        <div className={`journey-badge ${showBadge ? 'is-shown' : ''} ${failed && failIdx === 1 ? 'is-copied' : ''}`}>
          <span className="eyebrow">ID BADGE</span>
          <strong>{agent?.name ?? '—'}</strong>
          <dl>
            <div><dt>Works for</dt><dd>{agent ? `${agent.user} · ${agent.party}` : '—'}</dd></div>
            <div><dt>May ask about</dt><dd>{agent?.folders.join(', ') || '—'}</dd></div>
            <div><dt>Locked to</dt><dd>this agent’s own secret key</dd></div>
            <div><dt>Expires</dt><dd>15 minutes</dd></div>
          </dl>
          {failed && failIdx === 1 && <span className="journey-stamp">COPY REJECTED</span>}
        </div>

        <div className={`journey-checks ${showChecks ? 'is-shown' : ''}`}>
          <span className="eyebrow">SECURITY CHECKS</span>
          <ol>
            {checks.map((c, i) => {
              const at = checksAt + i
              const st = p > at || (!playing && p >= at) ? (i === failIdx ? 'fail' : 'ok') : p === at ? (i === failIdx ? 'fail' : 'run') : 'wait'
              const skipped = failIdx >= 0 && i > failIdx && p > checksAt + failIdx
              return <li key={c.label} className={`check-${skipped ? 'skip' : st}`}><span>{skipped ? '–' : st === 'fail' ? '✕' : st === 'ok' ? '✓' : st === 'run' ? '…' : i + 1}</span>{c.label}</li>
            })}
          </ol>
        </div>

        <div className={`journey-answer ${answered || failed ? 'is-shown' : ''} ${failed ? 'is-blocked' : ''}`}>
          <span className="eyebrow">{failed ? 'BLOCKED' : 'WHAT THE AGENT RECEIVED'}</span>
          {failed ? <p>{event?.reason}</p> : <p>{clean(event?.answer ?? '').split('\n').slice(1).join(' ').slice(0, 360) || '…'}</p>}
          {!failed && event?.sources && event.sources.length > 0 && <small>{event.sources.join(' · ')}</small>}
        </div>
      </div>
    </section>
  )
}
