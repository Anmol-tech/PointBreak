import { useState } from 'react'
import { vendorApi, useVendorState } from '../api'
import type { ActionHandler, VendorAgent, VendorEntry, VendorTerms } from '../types'
import { Icon } from './Icon'
import { timeLabel } from './ui'

const clean = (text: string) => text.replace(/[​‌﻿]/g, '').replace(/^⛔ VendorVault denied: /, '')
const ABILITY: Record<string, string> = { 'vault:ask': 'ask questions', 'vault:list': 'see the folder list' }

function minutes(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function statusTag(agent: VendorAgent) {
  if (agent.status === 'stopped') return <span className="tag tag-danger">Stopped by Falcon</span>
  if (agent.status === 'locked') return <span className="tag tag-danger">Vendor locked out by Falcon</span>
  return <span className="tag">Badge valid · {minutes(agent.expires_in)} left</span>
}

function entryTitle(e: VendorEntry) {
  if (e.kind === 'onboard') return 'Connected our company login to Falcon'
  if (e.kind === 'badge') {
    if (e.decision === 'denied') return `${e.agent} could not get a badge`
    return e.parent ? `${e.parent} created helper ${e.agent}` : `${e.agent} got a badge`
  }
  if (e.tool === 'ask_question') return `${e.agent} asked “${e.args?.question ?? ''}”`
  if (e.tool === 'get_document') return `${e.agent} tried to download ${e.args?.path ?? 'a document'}`
  if (e.tool === 'export_all') return `${e.agent} tried to export everything`
  if (e.tool === 'list_folders') return `${e.agent} looked at the folder list`
  return `${e.agent} called ${e.tool}`
}

function entryBody(e: VendorEntry) {
  if (e.kind === 'onboard') return `${e.reason ?? ''}. Falcon allows our agents to ask about ${e.folders?.join(', ') || 'nothing'}.`
  if (e.kind === 'badge') {
    if (e.decision === 'denied') return e.reason ?? ''
    const abilities = (e.scope ?? []).map((s) => ABILITY[s] ?? s).join(' and ')
    return `May ${abilities || 'do nothing'} about ${e.folders?.join(', ') || 'no folders'}. Expires in 15 minutes and only works with this agent's own key.`
  }
  return clean(e.text ?? '')
}

function AgentRow({ agent, all, depth, currentName, pending, onUse, onAction }: {
  agent: VendorAgent
  all: VendorAgent[]
  depth: number
  currentName: string | undefined
  pending: boolean
  onUse: (name: string) => void
  onAction: ActionHandler
}) {
  const helpers = all.filter((a) => a.parent === agent.name)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState(`${agent.name}-helper`)
  const [folders, setFolders] = useState<string[]>([])
  const mine = agent.granted_folders ?? []
  return (
    <li>
      <div className={`vendor-agent ${agent.name === currentName ? 'is-selected' : ''}`}>
        <div className="vendor-agent-main">
          <div>
            <strong>{agent.name}</strong>
            <span>{depth === 0 ? `Main agent · works for ${agent.user}` : `Helper created by ${agent.parent}`}</span>
            <small>May ask about {mine.join(', ') || 'nothing'}</small>
          </div>
          <div className="vendor-agent-actions">
            {statusTag(agent)}
            <div className="inline-actions">
              <button type="button" className="button button-small" onClick={() => onUse(agent.name)}>Ask with this agent</button>
              <button type="button" className="text-button" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add helper'}</button>
            </div>
          </div>
        </div>
        {adding && (
          <div className="helper-form">
            <label className="field-label" htmlFor={`helper-${agent.name}`}>Helper name</label>
            <input id={`helper-${agent.name}`} value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))} />
            <span className="field-label">Give it only some of {agent.name}'s folders</span>
            <div className="chip-row">
              {mine.map((f) => (
                <label key={f} className="chip-check">
                  <input type="checkbox" checked={folders.includes(f)} onChange={() => setFolders(folders.includes(f) ? folders.filter((x) => x !== f) : [...folders, f])} />
                  {f}
                </label>
              ))}
            </div>
            <button
              type="button"
              className="button button-primary button-small"
              disabled={pending || !name.trim()}
              onClick={() => void onAction('Add helper', async () => { await vendorApi.addHelper(agent.name, name.trim(), folders); setAdding(false) })}
            >
              Create helper
            </button>
          </div>
        )}
      </div>
      {helpers.length > 0 && (
        <ul className="vendor-helpers">
          {helpers.map((h) => <AgentRow key={h.name} agent={h} all={all} depth={depth + 1} currentName={currentName} pending={pending} onUse={onUse} onAction={onAction} />)}
        </ul>
      )}
    </li>
  )
}

function starterQuestion(access: VendorTerms | null | undefined) {
  // Start with a question that fits the vendor's own work.
  if (access?.folders.includes('Contracts')) return 'Which customer contracts have change of control clauses?'
  if (access?.folders.includes('Financials')) return 'What were total revenue and operating income in fiscal 2025?'
  if (access?.folders.includes('Customers')) return 'Which customers are the largest and how concentrated is revenue?'
  return 'What information is available to us?'
}

export function VendorWorkspace({ party, pending, onAction }: { party: string; pending: boolean; onAction: ActionHandler }) {
  const { state, error, refresh } = useVendorState(party)
  const [newUser, setNewUser] = useState('')
  const [user, setUser] = useState('')
  const [agentName, setAgentName] = useState('')
  const [askAs, setAskAs] = useState('')
  const [typed, setQuestion] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [reply, setReply] = useState<{ text: string; denied: boolean } | null>(null)
  const [asking, setAsking] = useState(false)

  if (error && !state) return <div className="error-notice" role="alert"><Icon name="alert" /><span>{error}. Is the vendor runtime running (./run.sh)?</span></div>
  if (!state) return <div className="connecting-state"><h1>Connecting to {party}'s side…</h1></div>

  const access = state.access
  const client = state.client
  const question = typed ?? starterQuestion(access)
  const currentUser = user || state.users[0]
  const suggested = agentName || `${currentUser.split('@')[0]}-agent`
  const usable = state.agents
  const current = usable.find((a) => a.name === askAs) ?? usable[0]
  const history = [...state.history].reverse()

  async function send(tool: string, args: Record<string, string>) {
    if (!current) return
    setAsking(true)
    setReply(null)
    try {
      setReply(await vendorApi.ask(current.name, tool, args))
      await refresh()
    } catch (e) {
      setReply({ text: e instanceof Error ? e.message : 'Request failed', denied: true })
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="vendor-grid">
      <div className="vendor-column">
        <section className="company-panel access-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ACCESS {client.toUpperCase()} GAVE YOU</span>
              <h3>{access?.purpose || 'Work not described'}</h3>
            </div>
            <span className={`tag ${access?.status === 'active' && !access.locked ? '' : 'tag-danger'}`}>
              {access?.status === 'offboarded' ? 'Offboarded' : access?.locked ? 'Locked out' : access?.status === 'active' ? 'Active vendor' : 'Not connected'}
            </span>
          </div>
          <dl className="access-terms">
            <div><dt>Your agents may ask about</dt><dd>{access?.folders.join(', ') || 'nothing'}</dd></div>
            <div><dt>They may</dt><dd>{(access?.scope ?? []).map((s) => ABILITY[s] ?? s).join(' and ') || 'nothing'}</dd></div>
            <div><dt>They can never</dt><dd>download or export documents</dd></div>
          </dl>
          <p className="small muted vendor-copy">{client} set this when it onboarded you, based on the work you were hired for. Every agent and helper you start gets this much access or less.</p>
        </section>

        <section className="company-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">STEP 1 · YOUR COMPANY LOGIN</span>
              <h3>{party}'s identity provider</h3>
            </div>
            <span className={`tag ${state.issuing ? '' : 'tag-danger'}`}>{state.issuing ? 'Issuing agent badges' : 'Stopped'}</span>
          </div>
          <p className="small muted vendor-copy">
            Your own login system vouches for your agents with a signed note (an ID-JAG). {client} only trusts {party} people
            if this login vouches for them. {state.id_jags_issued} note{state.id_jags_issued === 1 ? '' : 's'} signed so far.
          </p>
          <button
            type="button"
            className={`button ${state.issuing ? 'button-danger' : 'button-primary'}`}
            disabled={pending}
            onClick={() => void onAction('Update company login', () => (state.issuing ? vendorApi.stopIssuing(party) : vendorApi.resumeIssuing(party)))}
          >
            {state.issuing ? 'Stop issuing badges for our agents' : 'Resume issuing badges'}
          </button>
          <p className="small muted vendor-copy">Stopping blocks new agents right away. Existing badges expire within 15 minutes, and {client} can stop them instantly.</p>
          <label className="field-label" htmlFor="vendor-new-user">Employees who may run agents ({state.users.length})</label>
          <div className="inline-field">
            <input id="vendor-new-user" placeholder="new.person@company.com" value={newUser} onChange={(e) => setNewUser(e.target.value)} />
            <button
              type="button"
              className="button"
              disabled={pending || !newUser.includes('@')}
              onClick={() => void onAction('Add employee', async () => { await vendorApi.addUser(party, newUser.trim()); setNewUser(''); await refresh() })}
            >
              Add employee
            </button>
          </div>
        </section>

        <section className="company-panel">
          <span className="eyebrow">STEP 2 · START AN AGENT</span>
          <h3 className="vendor-h3">Sign in and send an agent into the data room</h3>
          <label className="field-label" htmlFor="vendor-user">Employee</label>
          <select id="vendor-user" value={currentUser} onChange={(e) => { setUser(e.target.value); setAgentName('') }}>
            {state.users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <label className="field-label" htmlFor="vendor-agent-name">Agent name</label>
          <input id="vendor-agent-name" value={suggested} onChange={(e) => setAgentName(e.target.value.replace(/\s+/g, '-'))} />
          <button
            type="button"
            className="button button-primary"
            disabled={pending || !suggested.trim()}
            onClick={() => void onAction('Start agent', async () => { await vendorApi.startAgent(party, currentUser, suggested.trim()); setAskAs(suggested.trim()) })}
          >
            <Icon name="key" />Sign in &amp; get a badge
          </button>
          <p className="small muted vendor-copy">The agent creates its own secret key. Its badge is locked to that key, so a copied badge is useless.</p>
        </section>

        <section className="company-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR AGENTS</span>
              <h3>{party}'s agents in the data room</h3>
            </div>
            <span className="count">{state.agents.length}</span>
          </div>
          {state.agents.length === 0 ? (
            <p className="muted small">No agents yet. Start one in step 2, or run the demo scenario.</p>
          ) : (
            <ul className="vendor-agents">
              {state.agents.filter((a) => !a.parent).map((a) => (
                <AgentRow key={a.name} agent={a} all={state.agents} depth={0} currentName={current?.name} pending={pending} onUse={setAskAs} onAction={onAction} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="vendor-column">
        <section className="company-panel">
          <span className="eyebrow">STEP 3 · ASK FALCON'S DATA ROOM</span>
          <h3 className="vendor-h3">Your agent asks. Falcon's vault answers.</h3>
          {!current ? (
            <p className="muted small">Start an agent first.</p>
          ) : (
            <>
              <label className="field-label" htmlFor="vendor-ask-as">Ask as</label>
              <select id="vendor-ask-as" value={current.name} onChange={(e) => setAskAs(e.target.value)}>
                {usable.map((a) => <option key={a.name} value={a.name}>{a.name} ({(a.granted_folders ?? []).join(', ')})</option>)}
              </select>
              <label className="field-label" htmlFor="vendor-question">Question</label>
              <textarea id="vendor-question" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
              <label className="field-label" htmlFor="vendor-folder">Folder</label>
              <select id="vendor-folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
                <option value="">Any folder this agent may use</option>
                {(current.granted_folders ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
                <option value="Board Minutes">Board Minutes (not shared)</option>
              </select>
              <div className="trace-actions">
                <button type="button" className="button button-primary" disabled={asking || !question.trim()} onClick={() => void send('ask_question', folder ? { question, folder } : { question })}>
                  {asking ? <span className="spinner" /> : <Icon name="answer" />}Send question
                </button>
                <button type="button" className="button" disabled={asking} onClick={() => void send('get_document', { path: 'Contracts/globex-customer-agreement.md' })}>
                  <Icon name="file" />Try to download a contract
                </button>
              </div>
              {reply && (
                <div className={`vendor-reply ${reply.denied ? 'is-denied' : ''}`} aria-live="polite">
                  <span className="field-label">{reply.denied ? 'Blocked by Falcon’s vault' : 'What your agent received (this is all it gets)'}</span>
                  <p className="decision-answer">{clean(reply.text)}</p>
                </div>
              )}
            </>
          )}
        </section>

        <section className="company-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">WHAT CAME BACK</span>
              <h3>Your agents' requests and answers</h3>
            </div>
            <span className="count">{history.length}</span>
          </div>
          {history.length === 0 ? (
            <p className="muted small">Nothing yet.</p>
          ) : (
            <ol className="vendor-history">
              {history.map((e) => (
                <li key={e.id}>
                  <details>
                    <summary>
                      <span className={`history-dot ${e.decision === 'allowed' ? 'decision-allowed' : 'decision-denied'}`} />
                      <span className="vendor-history-title">{entryTitle(e)}</span>
                      <span className={`tag ${e.decision === 'allowed' ? '' : 'tag-danger'}`}>{e.kind === 'badge' ? (e.decision === 'allowed' ? 'Badge issued' : 'Badge refused') : e.decision === 'allowed' ? 'Answered' : 'Blocked'}</span>
                      <time>{timeLabel(e.ts)}</time>
                    </summary>
                    <p className="decision-answer vendor-history-body">{entryBody(e)}</p>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
