import { useCallback, useEffect, useState } from 'react'
import { vendorApi, type InvitePreview } from '../api'
import type { ActionHandler } from '../types'
import { Icon } from './Icon'
import { VendorWorkspace } from './VendorWorkspace'

const ABILITY: Record<string, string> = { 'vault:ask': 'ask questions', 'vault:list': 'see the folder list' }
const JOIN = '__join__'

function JoinWithInvite({ initialCode, onJoined }: { initialCode: string; onJoined: (name: string) => void }) {
  const [code, setCode] = useState(initialCode)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [users, setUsers] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const client = preview?.client ?? 'your client'

  const lookUp = useCallback(async (value: string) => {
    setBusy(true); setError(null); setPreview(null)
    try {
      const p = await vendorApi.previewInvite(value)
      setPreview(p)
      setUsers(p.contact)
    } catch (e) { setError(e instanceof Error ? e.message : 'Invite not found') }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { if (initialCode) void lookUp(initialCode) }, [initialCode, lookUp])

  async function connect() {
    if (!preview) return
    setBusy(true); setError(null); setSteps([])
    try {
      const joined = await vendorApi.onboard(code, users.split(/[\s,]+/).filter((u) => u.includes('@')))
      setSteps([
        `Created ${joined.name}'s company login (${joined.issuer})`,
        `Sent it to ${client} with your invite code`,
        `${client} fetched your login's public signing keys and verified them`,
        `${joined.name} is now an active vendor. Your agents can get badges for: ${joined.folders.join(', ')}`,
      ])
      onJoined(joined.name)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect') }
    finally { setBusy(false) }
  }

  return (
    <div className="vendor-join-flow">
      <section className="company-panel">
        <span className="eyebrow">JOIN YOUR CLIENT’S WORKSPACE</span>
        <h2 className="vendor-h3">Start with your invite.</h2>
        <label className="field-label" htmlFor="invite-code">Invite code</label>
        <div className="inline-field">
          <input id="invite-code" placeholder="VV-XXXX-XXXX" value={code} disabled={busy} onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); setError(null); setSteps([]) }} />
          <button type="button" className="button" disabled={busy || code.trim().length < 6} onClick={() => void lookUp(code)}>Look up invite</button>
        </div>
        {error && <p className="company-warning" role="alert"><Icon name="alert" />{error}</p>}
        {preview && (
          <div className="invite-preview">
            <p className="small muted">{preview.client} invited you as</p>
            <h3>{preview.name}</h3>
            <dl className="access-terms">
              <div><dt>For this work</dt><dd>{preview.purpose || 'Not described'}</dd></div>
              <div><dt>Your agents may ask about</dt><dd>{preview.folders.join(', ') || 'nothing yet'}</dd></div>
              <div><dt>They may</dt><dd>{preview.scope.map((s) => ABILITY[s] ?? s).join(' and ')}</dd></div>
              <div><dt>They can never</dt><dd>download or export documents</dd></div>
            </dl>
          </div>
        )}
      </section>

      {preview && <section className="company-panel">
        <span className="eyebrow">CONNECT YOUR COMPANY</span>
        <h2 className="vendor-h3">Who will run your agents?</h2>
        <p className="small muted vendor-copy">Connect your company login to accept {client}’s access above. This demo creates the login for you.</p>
        <label className="field-label" htmlFor="invite-users">Employees who may run agents (comma separated)</label>
        <textarea id="invite-users" rows={2} value={users} disabled={!preview} onChange={(e) => setUsers(e.target.value)} />
        <button type="button" className="button button-primary" disabled={!preview || busy || !users.includes('@')} onClick={() => void connect()}>
          {busy ? <span className="spinner" /> : <Icon name="key" />}Connect our company login
        </button>
        {steps.length > 0 && (
          <ol className="onboard-steps">
            {steps.map((s) => <li key={s}><span>✓</span>{s}</li>)}
          </ol>
        )}
      </section>}
    </div>
  )
}

export function VendorPortal({ inviteCode, pending, onAction }: { inviteCode: string; pending: boolean; onAction: ActionHandler }) {
  const [vendors, setVendors] = useState<string[]>([])
  const [selected, setSelected] = useState<string>(inviteCode ? JOIN : '')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setVendors((await vendorApi.list()).map((v) => v.name)); setError(null) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load companies. Try again.') }
  }, [])
  useEffect(() => {
    void load()
    const poll = window.setInterval(load, 3000)
    return () => window.clearInterval(poll)
  }, [load])

  const current = selected === JOIN ? JOIN : vendors.includes(selected) ? selected : vendors[0] || JOIN
  return (
    <>
      <div className="vendor-company-bar">
        <div><label className="field-label" htmlFor="vendor-company">Company</label><select id="vendor-company" value={current} disabled={pending} onChange={(event) => setSelected(event.target.value)}>{vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}<option value={JOIN}>Join a new company</option></select></div>
        <button type="button" className="button" disabled={pending} onClick={() => setSelected(current === JOIN ? vendors[0] || JOIN : JOIN)}>{current === JOIN && vendors.length > 0 ? 'Back to workspace' : 'Join with an invite'}<Icon name="arrow" /></button>
      </div>
      {error && <p className="error-notice" role="alert">{error}</p>}
      {current === JOIN ? (
        <JoinWithInvite key={inviteCode} initialCode={inviteCode} onJoined={(name) => { setVendors((current) => current.includes(name) ? current : [...current, name]); setSelected(name); void load() }} />
      ) : (
        <VendorWorkspace key={current} party={current} pending={pending} onAction={onAction} />
      )}
    </>
  )
}
