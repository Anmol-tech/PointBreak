import { useState } from 'react'
import { api } from '../api'
import { describe } from '../describe'
import type { ActionHandler, Agent, VaultEvent, VaultState } from '../types'
import { Icon } from './Icon'
import { timeLabel } from './ui'

type Selection = { kind: 'agent'; id: string } | { kind: 'event'; id: number } | null

function displayName(name: string) { return name.replace(/[-_]/g, ' ') }
function cleanAnswer(text: string) { return text.replace(/[\u200b\u200c\ufeff]/g, '') }

function eventTitle(event: VaultEvent) {
  if (event.kind === 'lock') return event.decision === 'alert' ? 'Company locked out' : 'Company access updated'
  if (event.kind === 'trace') return 'Leaked answer traced'
  if (event.kind === 'revoke') return 'Agent access stopped'
  if (event.kind === 'alert') return 'Disclosure limit approaching'
  if (event.tool === 'get_document') return 'Full file requested'
  if (event.tool === 'export_all') return 'Room export requested'
  if (/dpop|different key|proof replayed/i.test(event.reason ?? '')) return 'Copied token used'
  if (event.tool === 'ask_question') return event.question ? `“${event.question}”` : 'Question requested'
  return describe(event).headline
}

function IdentityCard({ agent, selected, locked, onSelect }: { agent: Agent; selected: boolean; locked: boolean; onSelect: () => void }) {
  const stopped = agent.status === 'revoked' || locked
  return <button type="button" className={`board-card identity-card ${stopped ? 'is-stopped' : ''}`} aria-pressed={selected} onClick={onSelect}>
    <span className="card-meta"><span className="avatar">{agent.user.slice(0, 2).toUpperCase()}</span><span>{agent.party}</span><Icon name="arrow" /></span>
    <span className="card-title">{displayName(agent.name)}</span><span className="card-description">Works for {agent.user}</span>
    <span className={`tag ${stopped ? 'tag-danger' : ''}`}>{agent.status === 'revoked' ? 'Access stopped' : locked ? 'Company locked' : agent.folders.join(' + ') || 'No folders shared'}</span>
    <span className="card-footer">{agent.parent ? 'Delegated helper · key-bound identity' : 'Main agent · key-bound identity'}</span>
  </button>
}

function EventCard({ event, selected, feature, onSelect }: { event: VaultEvent; selected: boolean; feature?: boolean; onSelect: () => void }) {
  const blocked = event.decision === 'denied'
  const answerEvent = event.kind === 'call' && event.tool === 'ask_question' && event.decision === 'allowed'
  const story = describe(event)
  return <button type="button" className={`board-card event-card ${feature ? 'feature-card' : ''} ${blocked ? 'blocked-card' : ''}`} aria-pressed={selected} onClick={onSelect}>
    <span className="card-meta"><span className="avatar"><Icon name={answerEvent ? 'answer' : blocked ? 'blocked' : 'alert'} /></span><span>{displayName(story.actor)}</span><Icon name="arrow" /></span>
    <span className="card-title">{eventTitle(event)}</span>
    {answerEvent ? <><span className="card-description">{event.sources?.length ? `Answered from ${event.sources.length} cited section${event.sources.length === 1 ? '' : 's'}` : 'Answered from shared deal information'}</span><span className="answer-preview">{cleanAnswer(event.answer ?? '').split('\n').slice(1).join(' ').slice(0, 210) || 'Select this request to read the answer.'}</span><span className="card-footer">Masked · cited · fingerprinted</span></> : <><span className="card-description">{event.party ?? 'Unverified caller'} · {timeLabel(event.ts)}</span><span className={`tag ${blocked ? 'tag-danger' : 'tag-warning'}`}>{blocked ? 'Request blocked' : event.kind === 'trace' ? 'Origin identified' : event.kind === 'revoke' ? 'Access stopped' : 'Company alert'}</span></>}
  </button>
}

function DecisionPanel({ event, agent, locked, following, pending, onAction, onFollow }: { event?: VaultEvent; agent?: Agent; locked: boolean; following: boolean; pending: boolean; onAction: ActionHandler; onFollow: () => void }) {
  const story = event ? describe(event) : null
  const status = agent ? agent.status === 'revoked' ? 'Access stopped' : locked ? 'Company locked' : 'Identity verified' : story?.outcome === 'blocked' ? 'Request blocked' : story?.outcome === 'alert' ? 'Security alert' : event?.kind === 'trace' ? 'Leak traced' : event?.kind === 'token' ? 'Identity verified' : event?.tool === 'ask_question' ? 'Answer shared' : 'Activity recorded'
  return <section className="decision-panel" aria-label="Selected decision">
    <div className="section-heading"><div><span className="eyebrow">{following ? 'LIVE · LATEST DECISION' : 'SELECTED · DECISION DETAILS'}</span><h2>{agent ? displayName(agent.name) : story?.headline ?? 'Your next decision appears here.'}</h2></div><div className="inline-actions">{(event || agent) && <span className={`tag ${story?.outcome === 'blocked' || agent?.status === 'revoked' || locked ? 'tag-danger' : ''}`}>{status}</span>}{!following && <button className="text-button" type="button" onClick={onFollow}>Follow live</button>}</div></div>
    {!event && !agent && <p className="muted">Start the agent team above. Then select an identity, an answer, or a blocked request to see what happened and why.</p>}
    {agent && <div className="identity-detail"><dl><div><dt>Works for</dt><dd>{agent.user} at {agent.party}</dd></div><div><dt>Delegation</dt><dd>{agent.chain.join(' → ')}</dd></div><div><dt>May ask about</dt><dd>{agent.folders.join(', ') || 'No folders'}</dd></div><div><dt>Agent activity</dt><dd>{agent.calls} requests · {agent.sections_seen} sections seen</dd></div></dl><div><p className="muted">The token is bound to this agent’s own key. It cannot download or export original documents.</p><button className="button button-danger" disabled={pending || agent.status === 'revoked'} onClick={() => void onAction('Stop agent', () => api.revokeAgent(agent.id))}>{agent.status === 'revoked' ? 'Access stopped' : `Stop ${agent.name}`}{agent.parent === null && <span> + helpers</span>}</button></div></div>}
    {event && story && <>
      {event.chain.length > 0 && <p className="identity-chain">{event.chain.join(' → ')}</p>}
      <div className="decision-content"><div><span className="field-label">{event.answer ? 'What the agent received' : 'Why this happened'}</span><p className="decision-answer">{event.answer ? cleanAnswer(event.answer) : event.reason ?? story.headline}</p>{event.sources && event.sources.length > 0 && <div className="source-list">{event.sources.map((source) => <span key={source}><Icon name="file" />{source}</span>)}</div>}</div>
        {story.steps.length > 0 && <details className="proof-details" key={event.id}><summary>See identity &amp; security checks</summary><ol>{story.steps.map((step, index) => <li key={index} className={`check-${step.state}`}><span>{step.state === 'ok' ? '✓' : step.state === 'fail' ? '×' : '–'}</span><div>{step.label}{step.detail && <small>{step.detail}</small>}</div></li>)}</ol></details>}
      </div>
    </>}
  </section>
}

export function ActivityBoard({ state, pending, onAction, onManage }: { state: VaultState; pending: boolean; onAction: ActionHandler; onManage: () => void }) {
  const [selection, setSelection] = useState<Selection>(null)
  const [showAllAnswers, setShowAllAnswers] = useState(false)
  const [showAllBlocked, setShowAllBlocked] = useState(false)
  const recent = [...state.events].reverse()
  const answers = recent.filter((event) => event.kind === 'call' && event.tool === 'ask_question' && event.decision === 'allowed' && event.answer)
  const blocked = recent.filter((event) => event.decision === 'denied' || event.decision === 'alert' || event.kind === 'trace')
  const chosenAgent = selection?.kind === 'agent' ? state.agents.find((agent) => agent.id === selection.id) : undefined
  const chosenEvent = selection?.kind === 'event' ? state.events.find((event) => event.id === selection.id) : undefined
  const following = !chosenAgent && !chosenEvent
  const event = chosenAgent ? undefined : chosenEvent ?? recent[0]
  const identities = [...state.agents].sort((a, b) => Number(a.status === 'revoked') - Number(b.status === 'revoked') || b.created - a.created)
  return <>
    <div className="section-heading board-heading"><h2>The activity board</h2><span className="muted small">Select an event to see the decision</span></div>
    <div className="activity-board">
      <section className="board-lane" aria-label="Verified agents"><div className="lane-heading"><span><Icon name="agents" />Verified agents</span><span className="count">{identities.length}</span></div><div className="lane-cards">
        {identities.slice(0, 4).map((agent) => <IdentityCard key={agent.id} agent={agent} selected={chosenAgent?.id === agent.id} locked={state.parties.some((party) => party.name === agent.party && party.locked)} onSelect={() => setSelection({ kind: 'agent', id: agent.id })} />)}
        {identities.length === 0 && <div className="lane-empty"><span className="empty-icon"><Icon name="agents" /></span><h3>Know who is asking.</h3><p>Agents appear here after their company and identity are verified.</p><button className="text-button" disabled={pending || state.demo.running !== null} onClick={() => void onAction('Run demo', () => api.runDemo('team'))}>Start the agent team <Icon name="arrow" /></button></div>}
      </div>{identities.length > 0 && <button className="lane-more text-button" onClick={onManage}>Manage all {identities.length} agents <Icon name="arrow" /></button>}</section>
      <section className="board-lane" aria-label="Answers shared"><div className="lane-heading"><span><Icon name="answer" />Answers shared</span><span className="count">{answers.length}</span></div><div className="lane-cards">{(showAllAnswers ? answers : answers.slice(0, 3)).map((answer, index) => <EventCard key={answer.id} event={answer} feature={index === 0} selected={event?.id === answer.id} onSelect={() => setSelection({ kind: 'event', id: answer.id })} />)}{answers.length === 0 && <div className="lane-empty answer-empty"><span className="empty-icon"><Icon name="answer" /></span><h3>Answers leave.<br />Documents stay.</h3><p>Short, masked answers from shared sections appear here, with their sources.</p><span className="tag">Waiting for the first question</span></div>}</div>{answers.length > 3 && <button className="lane-more text-button" onClick={() => setShowAllAnswers(!showAllAnswers)}>{showAllAnswers ? 'Show fewer answers' : `View all ${answers.length} answers`}</button>}</section>
      <section className="board-lane" aria-label="Blocked requests and alerts"><div className="lane-heading"><span><Icon name="blocked" />Blocked &amp; alerts</span><span className="count">{blocked.length}</span></div><div className="lane-cards">{(showAllBlocked ? blocked : blocked.slice(0, 4)).map((item) => <EventCard key={item.id} event={item} selected={event?.id === item.id} onSelect={() => setSelection({ kind: 'event', id: item.id })} />)}{blocked.length === 0 && <div className="lane-empty"><span className="empty-icon"><Icon name="blocked" /></span><h3>Your boundaries, enforced.</h3><p>Blocked downloads, copied tokens, and company alerts appear here.</p><span className="tag">No blocked requests yet</span></div>}</div>{blocked.length > 4 && <button className="lane-more text-button" onClick={() => setShowAllBlocked(!showAllBlocked)}>{showAllBlocked ? 'Show fewer events' : `View all ${blocked.length} events`}</button>}</section>
    </div>
    <DecisionPanel event={event} agent={chosenAgent} locked={state.parties.some((party) => party.name === chosenAgent?.party && party.locked)} following={following} pending={pending} onAction={onAction} onFollow={() => setSelection(null)} />
    <details className="activity-history"><summary>All activity <span>{state.events.length} recent events</span></summary><p className="muted small">The gateway keeps the most recent 200 events on this screen.</p><ol>{recent.map((item) => <li key={item.id}><button type="button" onClick={() => setSelection({ kind: 'event', id: item.id })}><span className={`history-dot decision-${item.decision}`} /><span>{describe(item).headline}</span><time dateTime={new Date(item.ts * 1000).toISOString()}>{timeLabel(item.ts)}</time></button></li>)}</ol>{recent.length === 0 && <p className="muted">No activity yet.</p>}</details>
  </>
}
