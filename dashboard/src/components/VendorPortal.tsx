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
      window.setTimeout(() => onJoined(joined.name), 2500)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect') }
    finally { setBusy(false) }
  }

  return (
    <div className="vendor-grid">
      <section className="company-panel">
        <span className="eyebrow">NEW VENDOR · STEP 1</span>
        <h3 className="vendor-h3">Enter the invite code your client sent you</h3>
        <label className="field-label" htmlFor="invite-code">Invite code</label>
        <div className="inline-field">
          <input id="invite-code" placeholder="VV-XXXX-XXXX" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null) }} />
          <button type="button" className="button" disabled={busy || code.trim().length < 6} onClick={() => void lookUp(code)}>Look up invite</button>
        </div>
        {error && <p className="company-warning"><Icon name="alert" />{error}</p>}
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

      <section className="company-panel">
        <span className="eyebrow">NEW VENDOR · STEP 2</span>
        <h3 className="vendor-h3">Connect your company login</h3>
        <p className="small muted vendor-copy">
          Your agents prove who they are through your own company login (like Okta or Microsoft Entra). Connecting it tells {client} to
          trust badges vouched for by your login, and only for the access above. In this demo, a login is created for you.
        </p>
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
      </section>
    </div>
  )
}

export function VendorPortal({ inviteCode, pending, onAction }: { inviteCode: string; pending: boolean; onAction: ActionHandler }) {
  const [vendors, setVendors] = useState<string[]>([])
  const [selected, setSelected] = useState<string>(inviteCode ? JOIN : '')

  const load = useCallback(async () => {
    try { setVendors((await vendorApi.list()).map((v) => v.name)) } catch { setVendors([]) }
  }, [])
  useEffect(() => {
    void load()
    const poll = window.setInterval(load, 3000)
    return () => window.clearInterval(poll)
  }, [load])

  const current = selected || vendors[0] || JOIN
  return (
    <>
      <div className="vendor-picker" role="group" aria-label="Which vendor company">
        <span className="toolbar-label">Signed in as company</span>
        {vendors.map((v) => <button key={v} type="button" aria-pressed={current === v} onClick={() => setSelected(v)}>{v}</button>)}
        <button type="button" className="join-button" aria-pressed={current === JOIN} onClick={() => setSelected(JOIN)}>+ Join with an invite</button>
      </div>
      <p className="small muted portal-note">This demo runs every vendor in one environment. In real life each vendor runs its own portal and login.</p>
      {current === JOIN ? (
        <JoinWithInvite key={inviteCode} initialCode={inviteCode} onJoined={(name) => { void load(); setSelected(name) }} />
      ) : (
        <VendorWorkspace key={current} party={current} pending={pending} onAction={onAction} />
      )}
    </>
  )
}
