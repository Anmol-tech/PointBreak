import { useState } from 'react'
import { Icon } from './components/Icon'
import { VendorPortal } from './components/VendorPortal'
import type { ActionHandler } from './types'

/** The vendor platform: a separate site from Falcon's control center, talking only to the vendor's own runtime. */
export default function VendorApp() {
  const inviteCode = new URLSearchParams(window.location.search).get('invite') ?? ''
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act: ActionHandler = async (label, action) => {
    setPending(label)
    setError(null)
    try { await action() }
    catch (e) { setError(e instanceof Error ? e.message : 'The action could not be completed. Try again.') }
    finally { setPending(null) }
  }

  return (
    <div className="vault-app vendor-platform">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Vendor portal home">
          <span className="brand-mark"><Icon name="shield" /></span><span>vendorvault</span><span className="brand-divider">/</span><span className="brand-project">Vendor portal</span>
        </a>
        <span className="app-nav" />
        <span className="vendor-header-label"><Icon name="lock" />Your company workspace</span>
      </header>
      <main className="app-main">
        {error && <div className="error-notice" role="alert"><Icon name="alert" /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" /></button></div>}
        <section className="page-heading">
          <div><div className="eyebrow">YOUR SECURE WORKSPACE</div><h1>Your work.<br /><em>Secure answers.</em></h1></div>
          <p className="heading-note"><span />Start an agent. Ask a question.<br />Get answers within your client’s boundaries.</p>
        </section>
        <VendorPortal inviteCode={inviteCode} pending={pending !== null} onAction={act} />
      </main>
      <footer className="app-footer"><span><Icon name="lock" />Vendor workspace · agent keys stay with your company</span><span>Answers shared. Original files protected.</span></footer>
    </div>
  )
}
