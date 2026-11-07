import { useState } from 'react'
import { api } from '../api'
import type { ActionHandler, TraceMatch, VaultState } from '../types'
import { Icon } from './Icon'

export function AccessWorkspace({ state, pending, onAction }: { state: VaultState; pending: boolean; onAction: ActionHandler }) {
  return <div className="access-workspace">
    <div className="section-heading"><h2>Company access</h2><span className="muted small">Limits count all agents in a company together.</span></div>
    <div className="company-grid">{state.parties.map((party) => {
      const agents = state.agents.filter((agent) => agent.party === party.name)
      return <section className="company-panel" key={party.name}>
        <div className="section-heading"><div className="company-name"><span className="avatar">{party.name.match(/[A-Z]/g)?.join('').slice(0, 2) ?? party.name.slice(0, 2)}</span><div><h3>{party.name}</h3><span className={`tag ${party.locked ? 'tag-danger' : ''}`}>{party.locked ? 'Locked out' : 'Access open'}</span></div></div><button className={`button ${party.locked ? '' : 'button-danger'}`} aria-label={`${party.locked ? 'Restore' : 'Lock'} ${party.name} access`} disabled={pending} onClick={() => void onAction('Update company access', () => party.locked ? api.unlockParty(party.name) : api.lockParty(party.name))}>{party.locked ? 'Restore access' : 'Lock company'}</button></div>
        <div className="coverage-label"><span>Shared sections seen</span><strong>{Math.round(party.coverage * 100)}%</strong></div><div className={`coverage-track ${party.coverage >= state.thresholds.lock ? 'coverage-locked' : party.coverage >= state.thresholds.alert ? 'coverage-alert' : ''}`} role="progressbar" aria-label={`${party.name} shared sections seen`} aria-valuenow={Math.round(party.coverage * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(party.coverage, 1)) * 100}%` }} /></div><p className="small muted coverage-note">{party.revealed} of {party.total} sections · alert at {Math.round(state.thresholds.alert * 100)}% · lock at {Math.round(state.thresholds.lock * 100)}%</p>
        {party.lock_reason && <p className="company-warning"><Icon name="alert" />{party.lock_reason}</p>}
        {party.split_scraping && <span className="tag tag-warning">Split scraping detected</span>}
        <fieldset className="sharing-fields" disabled={pending}><legend>Folders this company may ask about</legend>{state.folders.map((folder) => <label key={folder.name}><input type="checkbox" checked={party.folders.includes(folder.name)} onChange={() => void onAction('Update folder sharing', () => api.setFolders(party.name, party.folders.includes(folder.name) ? party.folders.filter((name) => name !== folder.name) : [...party.folders, folder.name]))} /><Icon name="folder" /><span>{folder.name}</span><small>{folder.docs.length} {folder.docs.length === 1 ? 'document' : 'documents'}</small></label>)}</fieldset>
        <div className="company-agents"><h4>Agents <span className="count">{agents.length}</span></h4>{agents.length === 0 && <p className="muted small">No agents have joined yet.</p>}{agents.map((agent) => <div className="access-agent" key={agent.id}><div><strong>{agent.name}</strong><span>{agent.user}</span><small>{agent.parent ? `Delegated by ${agent.parent.split(':').slice(1).join(':')}` : 'Main agent'} · {agent.status === 'revoked' ? 'Stopped' : party.locked ? 'Company locked' : 'Active'}</small></div><button className="button button-small" disabled={pending || agent.status === 'revoked'} onClick={() => void onAction('Stop agent', () => api.revokeAgent(agent.id))}>{agent.status === 'revoked' ? 'Stopped' : 'Stop'}</button></div>)}</div>
      </section>
    })}</div>
  </div>
}

export function LeakWorkspace() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<TraceMatch[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function trace() {
    setBusy(true); setError(null); setResult(null)
    try { setResult((await api.trace(text)).matches) }
    catch (error) { setError(error instanceof Error ? error.message : 'Tracing failed. Try again.') }
    finally { setBusy(false) }
  }
  return <section className="leak-workspace"><div className="section-heading"><div><h2>Trace an answer</h2><p className="muted">Match leaked text against answer fingerprints and previously shared responses.</p></div><Icon name="trace" /></div><label className="field-label" htmlFor="leaked-answer">Text found outside the data room</label><textarea id="leaked-answer" rows={7} placeholder="Paste the leaked answer here…" value={text} onChange={(event) => { setText(event.target.value); setResult(null); setError(null) }} /><div className="trace-actions"><button className="button button-primary" disabled={!text.trim() || busy} onClick={() => void trace()}>{busy ? <span className="spinner" /> : <Icon name="trace" />}{busy ? 'Tracing answer…' : 'Find the source'}</button><span className="muted small">Invisible marks help identify verbatim copies.</span></div>{error && <p className="error-notice" role="alert">{error}</p>}{result && <div className="trace-results" aria-live="polite">{result.length === 0 ? <><h3>No matching answer found.</h3><p className="muted">The text may not match a served answer, or it may have been paraphrased.</p></> : result.map((match) => <article key={match.agent_id}><span className="tag">Possible source</span><h3>{match.chain.join(' → ')}</h3><p className="muted">{match.method} · {Math.round(match.confidence * 100)}% match score</p></article>)}</div>}<p className="trace-footnote muted small">A fingerprint identifies the receiving agent. Text overlap is a fallback match, and paraphrased leaks may not be traceable.</p></section>
}
