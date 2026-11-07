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
          <span className="brand-mark"><Icon name="key" /></span><span>vendor portal</span><span className="brand-divider">/</span><span className="brand-project">secure agent access</span>
        </a>
        <span className="app-nav" />
        <span className="connection is-live"><span />Your company's environment</span>
      </header>
      <main className="app-main">
        {error && <div className="error-notice" role="alert"><Icon name="alert" /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" /></button></div>}
        <section className="page-heading">
          <div><div className="eyebrow">FOR VENDORS WORKING WITH OUR CLIENTS</div><h1>Your agents.<br /><em>Your client’s rules.</em></h1></div>
          <p className="heading-note"><span />Join with an invite, connect your company login,<br />then start agents with exactly the access you were given.</p>
        </section>
        <VendorPortal inviteCode={inviteCode} pending={pending !== null} onAction={act} />
      </main>
      <footer className="app-footer"><span><Icon name="lock" />Vendor portal · your agents' keys stay in your environment</span><span>Separate from your client's control center</span></footer>
    </div>
  )
}
