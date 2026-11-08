import { useState } from 'react'
import { api } from '../api'
import type { VaultState } from '../types'
import { Icon } from './Icon'

export function OnboardVendor({ state, onOpenPortal }: { state: VaultState; onOpenPortal: (code: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [contact, setContact] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [canList, setCanList] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ name: string; invite_code: string } | null>(null)

  async function create() {
    setBusy(true); setError(null)
    try {
      setInvite(await api.inviteVendor({ name, purpose, contact, folders, scope: canList ? ['vault:ask', 'vault:list'] : ['vault:ask'] }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the invite') }
    finally { setBusy(false) }
  }

  function startOver() {
    setInvite(null); setName(''); setPurpose(''); setContact(''); setFolders([]); setCanList(true)
  }

  if (!open) {
    return (
      <section className="onboard-banner">
        <div>
          <h2>Bring in a new vendor</h2>
        </div>
        <button type="button" className="button button-primary" onClick={() => setOpen(true)}><Icon name="agents" />Onboard a new vendor</button>
      </section>
    )
  }

  if (invite) {
    return (
      <section className="company-panel onboard-panel">
        <span className="eyebrow">INVITE CREATED</span>
        <h2 className="vendor-h3">{invite.name} is invited</h2>
        <div className="invite-code">{invite.invite_code}</div>
        <ol className="onboard-steps">
          <li><span>1</span>Send this code to {contact || `${invite.name}'s admin`}.</li>
          <li><span>2</span>They enter it in the vendor portal and connect their login.</li>
          <li><span>3</span>Its agents can then get badges for {folders.join(', ') || 'nothing'}.</li>
        </ol>
        <div className="trace-actions">
          <button type="button" className="button button-primary" onClick={() => onOpenPortal(invite.invite_code)}>Open vendor portal as {invite.name} <Icon name="arrow" /></button>
          <button type="button" className="text-button" onClick={startOver}>Invite another vendor</button>
          <button type="button" className="text-button" onClick={() => { startOver(); setOpen(false) }}>Done</button>
        </div>
      </section>
    )
  }

  return (
    <section className="company-panel onboard-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ONBOARD A NEW VENDOR</span>
          <h2>New vendor</h2>
        </div>
        <button type="button" className="text-button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <div className="onboard-form">
        <div>
          <label className="field-label" htmlFor="ov-name">Vendor company</label>
          <input id="ov-name" placeholder="e.g. Northbeam" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="field-label" htmlFor="ov-purpose">Work</label>
          <input id="ov-purpose" placeholder="e.g. Customer market analysis" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          <label className="field-label" htmlFor="ov-contact">Their admin's email</label>
          <input id="ov-contact" placeholder="admin@vendor.com" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <fieldset className="sharing-fields onboard-fields">
          <legend>Folders this work needs</legend>
          {state.folders.map((f) => (
            <label key={f.name}>
              <input type="checkbox" checked={folders.includes(f.name)} onChange={() => setFolders(folders.includes(f.name) ? folders.filter((x) => x !== f.name) : [...folders, f.name])} />
              <Icon name="folder" /><span>{f.name}</span><small>{f.docs.length} {f.docs.length === 1 ? 'document' : 'documents'}</small>
            </label>
          ))}
          <label>
            <input type="checkbox" checked={canList} onChange={() => setCanList(!canList)} />
            <Icon name="file" /><span>Allow list_folders</span>
          </label>
        </fieldset>
      </div>
      {error && <p className="company-warning"><Icon name="alert" />{error}</p>}
      <button type="button" className="button button-primary" disabled={busy || !name.trim() || folders.length === 0} onClick={() => void create()}>
        {busy ? <span className="spinner" /> : <Icon name="key" />}Create invite
      </button>
    </section>
  )
}
