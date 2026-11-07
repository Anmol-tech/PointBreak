import { useState } from 'react'
import { vendorApi, useVendorState } from '../api'
import type { ActionHandler, VendorAgent, VendorEntry, VendorTerms } from '../types'
import { Icon } from './Icon'
import { timeLabel } from './ui'

const clean = (text: string) => text.replace(/[\u200b\u200c\ufeff]/g, '').replace(/^⛔ VendorVault denied: /, '')
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
  if (e.kind === 'onboard') return 'Company login connected'
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
  if (e.kind === 'onboard') return `${e.reason ?? ''}. Allowed folders: ${e.folders?.join(', ') || 'none'}.`
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
              <button type="button" className="button button-small" disabled={pending || agent.status !== 'active'} onClick={() => onUse(agent.name)}>Ask with this agent</button>
              <button type="button" className="text-button" disabled={pending || agent.status !== 'active'} onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add helper'}</button>
            </div>
          </div>
        </div>
        {adding && (
          <div className="helper-form">
            <label className="field-label" htmlFor={`helper-${agent.name}`}>Helper name</label>
            <input id={`helper-${agent.name}`} value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))} />
            <span className="field-label">Choose the folders this helper needs</span>
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
              disabled={pending || !name.trim() || folders.length === 0}
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
  const [view, setView] = useState<'ask' | 'agents' | 'settings'>('ask')
  const [newUser, setNewUser] = useState('')
  const [user, setUser] = useState('')
  const [agentName, setAgentName] = useState('')
  const [askAs, setAskAs] = useState('')
  const [typed, setQuestion] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [reply, setReply] = useState<{ text: string; denied: boolean } | null>(null)
  const [asking, setAsking] = useState(false)

  if (error && !state) return <div className="error-notice" role="alert"><Icon name="alert" /><span>We couldn’t load {party}’s workspace. {error}</span></div>
  if (!state) return <div className="vendor-loading" role="status"><span className="spinner" />Loading your company workspace…</div>

  const access = state.access
  const client = state.client
  const question = typed ?? starterQuestion(access)
  const currentUser = state.users.includes(user) ? user : state.users[0] || ''
  const baseName = `${currentUser.split('@')[0] || 'vendor'}-agent`
  let defaultName = baseName
  for (let suffix = 2; state.agents.some((agent) => agent.name === defaultName); suffix++) defaultName = `${baseName}-${suffix}`
  const suggested = agentName || defaultName
  const current = state.agents.find((agent) => agent.name === askAs) ?? state.agents.find((agent) => agent.status === 'active') ?? state.agents[0]
  const history = [...state.history].reverse()
  const accessOpen = access?.status === 'active' && !access.locked
  const canAsk = accessOpen && current?.status === 'active'
  const searchFolder = current?.granted_folders?.includes(folder) ? folder : ''

  const update: ActionHandler = (label, action) => onAction(label, async () => { await action(); await refresh() })
  function chooseAgent(name: string) { setAskAs(name); setFolder(''); setReply(null); setView('ask') }
  async function send(tool: string, args: Record<string, string>) {
    if (!current || asking) return
    setAsking(true); setReply(null)
    try { setReply(await vendorApi.ask(current.name, tool, args)); await refresh() }
    catch (error) { setReply({ text: error instanceof Error ? error.message : 'Request failed. Try again.', denied: true }) }
    finally { setAsking(false) }
  }

  return <div className="vendor-workspace">
    {error && <p className="company-warning" role="status"><Icon name="alert" />Connection interrupted. Showing the last available company state.</p>}
    <section className="vendor-access-summary" aria-label="Your client access">
      <div className="vendor-access-heading"><div><span className="eyebrow">ACCESS SHARED BY {client.toUpperCase()}</span><h2>{access?.purpose || 'Your client access'}</h2></div><span className={`tag ${accessOpen ? '' : 'tag-danger'}`}>{access?.status === 'offboarded' ? 'Offboarded' : access?.locked ? 'Access locked' : accessOpen ? 'Active vendor' : 'Not connected'}</span></div>
      <div className="vendor-scope-line"><div className="vendor-folder-tags">{access?.folders.map((name) => <span key={name}><Icon name="folder" />{name}</span>)}{!access?.folders.length && <span>No folders shared</span>}</div><span className="vendor-files-note"><Icon name="lock" />Answers only. Original files stay with {client}.</span></div>
      {!accessOpen && <p className="company-warning"><Icon name="alert" />{access?.lock_reason || (access?.status === 'offboarded' ? 'Your company has been offboarded. Contact your client to restore access.' : 'Your company needs active client access before agents can ask questions.')}</p>}
    </section>

    <nav className="vendor-workspace-nav" aria-label="Vendor workspace">
      {([['ask', 'Ask questions', 'answer'], ['agents', 'Agents', 'agents'], ['settings', 'Company settings', 'key']] as const).map(([id, label, icon]) => <button type="button" key={id} aria-pressed={view === id} disabled={pending || asking} onClick={() => setView(id)}><Icon name={icon} />{label}{id === 'agents' && <span className="count">{state.agents.length}</span>}</button>)}
    </nav>

    {view === 'ask' && <div className="vendor-ask-workspace">
      <section className="company-panel vendor-question-panel">
        <div className="section-heading"><div><h2>Ask {client}’s vault</h2><p className="muted vendor-section-copy">Get a short answer from the information shared with your company.</p></div><Icon name="answer" /></div>
        {!current ? <div className="vendor-first-agent"><span className="empty-icon"><Icon name="agents" /></span><h3>Start an agent to ask your first question.</h3><p>Your agent gets a verified identity and access limited to your company’s work.</p><button type="button" className="button button-primary" onClick={() => setView('agents')}><Icon name="play" />Start your first agent</button></div> : <>
          {!canAsk && <p className="company-warning" role="status"><Icon name="alert" />{current.status === 'stopped' ? 'This agent has been stopped by your client. Choose another active agent.' : 'This agent cannot access the vault while company access is locked or inactive.'}</p>}
          <div className="vendor-ask-options"><div><label className="field-label" htmlFor="vendor-ask-as">Agent</label><select id="vendor-ask-as" disabled={asking} value={current.name} onChange={(event) => { setAskAs(event.target.value); setFolder(''); setReply(null) }}>{state.agents.map((agent) => <option key={agent.name} value={agent.name}>{agent.name}{agent.status === 'active' ? '' : ` · ${agent.status}`}</option>)}</select></div><div><label className="field-label" htmlFor="vendor-folder">Search in</label><select id="vendor-folder" disabled={asking} value={searchFolder} onChange={(event) => setFolder(event.target.value)}><option value="">All allowed folders</option>{(current.granted_folders ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select></div></div>
          <form onSubmit={(event) => { event.preventDefault(); if (canAsk && !asking && question.trim()) void send('ask_question', searchFolder ? { question, folder: searchFolder } : { question }) }}>
            <label className="field-label" htmlFor="vendor-question">Your question</label><textarea id="vendor-question" rows={4} value={question} disabled={asking} onChange={(event) => setQuestion(event.target.value)} />
            <div className="vendor-send-row"><span className="small muted"><Icon name="shield" />Limited to this agent’s allowed folders</span><button type="submit" className="button button-primary" disabled={asking || pending || !canAsk || !question.trim()}>{asking ? <span className="spinner" /> : <Icon name="answer" />}{asking ? 'Getting your answer…' : 'Send question'}</button></div>
          </form>
          {reply && <section className={`vendor-reply ${reply.denied ? 'is-denied' : ''}`} aria-live="polite"><div className="vendor-reply-heading"><span className="field-label">{reply.denied ? 'Request blocked' : 'Your answer'}</span><Icon name={reply.denied ? 'blocked' : 'check'} /></div><p className="decision-answer">{clean(reply.text)}</p></section>}
          <details className="vendor-boundary-test"><summary>Test a blocked document download</summary><p className="small muted">Agents can ask questions, but full documents are never released.</p><button type="button" className="button button-small" disabled={asking || pending || !canAsk} onClick={() => void send('get_document', { path: 'Contracts/globex-customer-agreement.md' })}><Icon name="file" />Try downloading a contract</button></details>
        </>}
      </section>
      <details className="vendor-recent-activity"><summary><span>Recent requests &amp; activity</span><span className="count">{history.length}</span></summary>{history.length === 0 ? <p className="small muted vendor-section-copy">Your agents’ requests and responses will appear here.</p> : <ol className="vendor-history">{history.map((entry) => <li key={entry.id}><details><summary><span className={`history-dot ${entry.decision === 'allowed' ? 'decision-allowed' : 'decision-denied'}`} /><span className="vendor-history-title">{entryTitle(entry)}</span><span className={`tag ${entry.decision === 'allowed' ? '' : 'tag-danger'}`}>{entry.kind === 'badge' ? entry.decision === 'allowed' ? 'Verified' : 'Refused' : entry.kind === 'onboard' ? 'Connected' : entry.decision === 'allowed' ? 'Answered' : 'Blocked'}</span><time>{timeLabel(entry.ts)}</time></summary><p className="decision-answer vendor-history-body">{entryBody(entry)}</p></details></li>)}</ol>}</details>
    </div>}

    {view === 'agents' && <div className="vendor-agents-workspace">
      <section className="company-panel vendor-start-panel"><div className="section-heading"><div><h2>Start an agent</h2><p className="muted vendor-section-copy">Choose who it works for. Your client’s access limits apply automatically.</p></div><Icon name="agents" /></div>
        {!state.issuing && <p className="company-warning"><Icon name="alert" />Your company login is paused. Resume issuing in Company settings before starting an agent.</p>}
        <form onSubmit={(event) => { event.preventDefault(); if (!pending && accessOpen && state.issuing && currentUser && suggested.trim()) void update('Start agent', async () => { await vendorApi.startAgent(party, currentUser, suggested.trim()); setAgentName(''); chooseAgent(suggested.trim()) }) }}>
          <div className="vendor-start-fields"><div><label className="field-label" htmlFor="vendor-user">Employee</label><select id="vendor-user" value={currentUser} disabled={pending} onChange={(event) => { setUser(event.target.value); setAgentName('') }}>{state.users.map((employee) => <option key={employee} value={employee}>{employee}</option>)}</select></div><div><label className="field-label" htmlFor="vendor-agent-name">Agent name</label><input id="vendor-agent-name" disabled={pending} value={suggested} onChange={(event) => setAgentName(event.target.value.replace(/\s+/g, '-'))} /></div></div><button type="submit" className="button button-primary" disabled={pending || !suggested.trim() || !currentUser || !state.issuing || !accessOpen}><Icon name="key" />{pending ? 'Starting agent…' : 'Start agent'}</button>
        </form>
      </section>
      <section className="company-panel"><div className="section-heading"><h2>Your agents</h2><span className="count">{state.agents.length}</span></div>{state.agents.length === 0 ? <p className="small muted">No agents yet. Start one using the form above.</p> : <ul className="vendor-agents">{state.agents.filter((agent) => !agent.parent).map((agent) => <AgentRow key={agent.name} agent={agent} all={state.agents} depth={0} currentName={current?.name} pending={pending} onUse={chooseAgent} onAction={update} />)}</ul>}</section>
    </div>}

    {view === 'settings' && <div className="vendor-settings-workspace">
      <section className="company-panel"><div className="section-heading"><h2>Company login</h2><span className={`tag ${state.issuing ? '' : 'tag-danger'}`}>{state.issuing ? 'Issuing enabled' : 'Paused'}</span></div><p className="muted vendor-section-copy">Your company login verifies employees and issues agent identities. Pause it to prevent new badges.</p><button type="button" className={`button ${state.issuing ? 'button-danger' : 'button-primary'}`} disabled={pending} onClick={() => void update('Update company login', () => state.issuing ? vendorApi.stopIssuing(party) : vendorApi.resumeIssuing(party))}>{state.issuing ? 'Pause issuing' : 'Resume issuing'}</button><p className="small muted vendor-settings-note">Existing badges last up to 15 minutes. Your client can stop them immediately.</p><details className="vendor-login-details"><summary>Connection details</summary><dl className="access-terms"><div><dt>Identity provider</dt><dd>{state.issuer}</dd></div><div><dt>Credentials issued</dt><dd>{state.id_jags_issued}</dd></div><div><dt>Allowed actions</dt><dd>{(access?.scope ?? []).map((scope) => ABILITY[scope] ?? scope).join(', ') || 'None'}</dd></div></dl></details></section>
      <section className="company-panel"><div className="section-heading"><h2>Employees</h2><span className="count">{state.users.length}</span></div><p className="muted vendor-section-copy">These employees may run agents for {party}.</p><ul className="vendor-employee-list">{state.users.map((employee) => <li key={employee}><span className="avatar">{employee.slice(0, 2).toUpperCase()}</span>{employee}</li>)}</ul><form onSubmit={(event) => { event.preventDefault(); if (!pending && newUser.includes('@')) void update('Add employee', async () => { await vendorApi.addUser(party, newUser.trim()); setNewUser('') }) }}><label className="field-label" htmlFor="vendor-new-user">Employee email</label><div className="inline-field"><input id="vendor-new-user" type="email" value={newUser} placeholder="person@company.com" disabled={pending} onChange={(event) => setNewUser(event.target.value)} /><button type="submit" className="button" disabled={pending || !newUser.includes('@')}>Add employee</button></div></form></section>
    </div>}
  </div>
}
