import { useState } from 'react'
import { VENDOR_PORTAL_URL, api, useFalconAuth, useVaultState } from './api'
import { ActivityBoard } from './components/ActivityBoard'
import { AgentJourney } from './components/AgentJourney'
import { AccessWorkspace, LeakWorkspace } from './components/AccessWorkspace'
import { DemoControls } from './components/DemoControls'
import { Icon } from './components/Icon'
import { OnboardVendor } from './components/OnboardVendor'
import type { ActionHandler } from './types'
import type { FalconUser } from './api'

/** Falcon's control center. Vendors use a separate platform (the vendor portal on :9001). */
export default function App() {
  const auth = useFalconAuth()
  if (!auth) return <div className="vault-app"><main className="app-main"><div className="connecting-state"><span className="eyebrow">VENDORVAULT</span><h1>Checking your sign-in.</h1></div></main></div>
  if (auth.enabled && !auth.user) return <SignInScreen pool={auth.pool} />
  return <ControlCenter user={auth.user} />
}

function SignInScreen({ pool }: { pool?: string }) {
  return <div className="vault-app sign-in-page">
    <main className="sign-in-card">
      <span className="brand-mark"><Icon name="shield" /></span>
      <span className="eyebrow">FALCON ANALYTICS · VENDOR AGENT CONTROL CENTER</span>
      <h1>Sign in to continue.</h1>
      <p>Falcon staff sign in with the company login. Only members of the <strong>falcon-admins</strong> group can stop agents or change vendor access.</p>
      <a className="button button-primary" href="/auth/login"><Icon name="key" />Sign in with Falcon SSO</a>
      <p className="small muted">Amazon Cognito · OpenID Connect with PKCE{pool ? <> · pool <code>{pool}</code></> : null}</p>
    </main>
  </div>
}

function ControlCenter({ user }: { user: FalconUser | null }) {
  const { state, connected, refresh } = useVaultState()
  const [view, setView] = useState<'flow' | 'board' | 'access' | 'trace'>('flow')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [boardSession, setBoardSession] = useState(0)
  const client = state?.client ?? 'Falcon'
  const act: ActionHandler = async (label, action) => {
    setPending(label)
    setError(null)
    try { await action(); await refresh() }
    catch (error) { setError(error instanceof Error ? error.message : 'The action could not be completed. Try again.') }
    finally { setPending(null) }
  }
  const openPortal = (code?: string) => window.open(`${VENDOR_PORTAL_URL}/${code ? `?invite=${encodeURIComponent(code)}` : ''}`, '_blank', 'noopener')

  return (
    <div className="vault-app">
      <header className="app-header">
        <a className="brand" href="#" aria-label="VendorVault activity board" onClick={(event) => { event.preventDefault(); setView('board') }}>
          <span className="brand-mark"><Icon name="shield" /></span><span>vendorvault</span><span className="brand-divider">/</span><span className="brand-project">{client}</span>
        </a>
        <nav className="app-nav" aria-label="Main navigation">
          {([['flow', 'Live flow'], ['board', 'Activity board'], ['access', 'Vendors'], ['trace', 'Trace a leak']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
          <button type="button" className="portal-link" onClick={() => openPortal()} title="Opens the separate vendor platform in a new tab">Vendor portal <Icon name="arrow" /></button>
        </nav>
        <span className={`connection ${connected ? 'is-live' : ''}`}><span />{connected ? 'Live' : 'Connecting'}</span>
        {user && <span className="user-chip" title={`Signed in with Amazon Cognito${user.groups.length ? ` · groups: ${user.groups.join(', ')}` : ''}`}><span className="avatar">{user.email.slice(0, 2).toUpperCase()}</span><span className="user-chip-text"><strong>{user.email}</strong><small>{user.admin ? 'Admin' : 'View only'}</small></span><a href="/auth/logout" className="text-button">Sign out</a></span>}
      </header>
      <main className={`app-main ${view === 'flow' ? 'is-immersive' : ''}`}>
        {error && <div className="error-notice" role="alert"><Icon name="alert" /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" /></button></div>}
        {!state ? <div className="connecting-state"><span className="eyebrow">VENDORVAULT</span><h1>Connecting to your vault.</h1><p>The board will appear when the gateway is ready.</p></div> : <>
          {view === 'flow' ? (
            <AgentJourney
              state={state}
              pending={pending !== null}
              onRun={(name) => { if (name === 'onboard' || name === 'scrape') setView(name === 'onboard' ? 'access' : 'board'); void act('Run demo', () => api.runDemo(name)) }}
              onReset={() => void act('Reset demo', api.reset)}
              onAction={act}
            />
          ) : <>
          <h1 className="page-title">{view === 'board' ? 'Activity' : view === 'access' ? 'Vendors' : 'Trace a leak'}</h1>
          <div className="demo-toolbar"><DemoControls demo={state.demo} pending={pending !== null} onRun={(name) => { setView(name === 'onboard' ? 'access' : name === 'scrape' ? 'board' : 'flow'); setBoardSession((session) => session + 1); void act('Run demo', () => api.runDemo(name)) }} /><button className="text-button reset-button" type="button" disabled={pending !== null || state.demo.running !== null} onClick={() => { setBoardSession((session) => session + 1); void act('Reset demo', api.reset) }}><Icon name="reset" />Reset demo</button></div>
          {state.demo.running ? <div className="demo-notice" role="status"><span className="spinner" /><span><strong>{state.demo.scenarios[state.demo.running]}</strong> is running. The screen updates as each step happens.</span></div> : state.demo.last && <div className={`demo-notice ${state.demo.last.ok ? '' : 'has-error'}`} role="status"><Icon name={state.demo.last.ok ? 'check' : 'alert'} /><span>{state.demo.last.name === 'ai-team' && state.demo.last.ok ? 'AI agent team finished. Read the memo in Live flow.' : state.demo.last.message}</span></div>}
          {view === 'board' && <ActivityBoard key={boardSession} state={state} pending={pending !== null} onAction={act} onManage={() => setView('access')} />}
          {view === 'access' && <><OnboardVendor state={state} onOpenPortal={openPortal} /><AccessWorkspace state={state} pending={pending !== null} onAction={act} /></>}
          {view === 'trace' && <LeakWorkspace />}
          </>}
        </>}
      </main>
      <footer className={`app-footer ${view === 'flow' ? 'is-hidden' : ''}`}><span><Icon name="lock" />{client} · vendor agent control center</span><span>{state?.answer_engine ?? 'Connecting to the answer engine'}</span></footer>
    </div>
  )
}
