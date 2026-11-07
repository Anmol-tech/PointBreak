import { useState } from 'react'
import { api, useVaultState } from './api'
import { ActivityBoard } from './components/ActivityBoard'
import { AccessWorkspace, LeakWorkspace } from './components/AccessWorkspace'
import { DemoControls } from './components/DemoControls'
import { Icon } from './components/Icon'
import type { ActionHandler } from './types'

export default function App() {
  const { state, connected, refresh } = useVaultState()
  const [view, setView] = useState<'board' | 'access' | 'trace'>('board')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [boardSession, setBoardSession] = useState(0)
  const act: ActionHandler = async (label, action) => {
    setPending(label)
    setError(null)
    try { await action(); await refresh() }
    catch (error) { setError(error instanceof Error ? error.message : 'The action could not be completed. Try again.') }
    finally { setPending(null) }
  }

  return (
    <div className="vault-app">
      <header className="app-header">
        <a className="brand" href="#" aria-label="VendorVault activity board" onClick={(event) => { event.preventDefault(); setView('board') }}>
          <span className="brand-mark"><Icon name="shield" /></span><span>vendorvault</span><span className="brand-divider">/</span><span className="brand-project">Falcon</span>
        </a>
        <nav className="app-nav" aria-label="Main navigation">
          {([['board', 'Activity board'], ['access', 'Manage access'], ['trace', 'Trace a leak']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
        </nav>
        <span className={`connection ${connected ? 'is-live' : ''}`}><span />{connected ? 'Live' : 'Connecting'}</span>
      </header>
      <main className="app-main">
        {error && <div className="error-notice" role="alert"><Icon name="alert" /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" /></button></div>}
        {!state ? <div className="connecting-state"><span className="eyebrow">PROJECT FALCON</span><h1>Connecting to your vault.</h1><p>The board will appear when the gateway is ready.</p></div> : <>
          <section className="page-heading">
            <div><div className="eyebrow">{view === 'board' ? 'YOUR DEAL, UNDER CONTROL' : view === 'access' ? 'ACCESS, ON YOUR TERMS' : 'EVERY ANSWER HAS AN ORIGIN'}</div><h1>{view === 'board' ? <>Who asked.<br />What left. <em>What didn’t.</em></> : view === 'access' ? <>Their agents.<br /><em>Your boundaries.</em></> : <>An answer leaked.<br /><em>Find its trail.</em></>}</h1></div>
            <p className="heading-note"><span />{view === 'board' ? <>Outside agents get answers.<br />Your documents stay here.</> : view === 'access' ? <>Changes apply to the next request.<br />Stop one agent or a whole company.</> : <>Paste text found outside the deal.<br />See which agent received it.</>}</p>
          </section>
          <div className="demo-toolbar"><DemoControls demo={state.demo} pending={pending !== null} onRun={(name) => { setView('board'); setBoardSession((session) => session + 1); void act('Run demo', () => api.runDemo(name)) }} /><button className="text-button reset-button" type="button" disabled={pending !== null || state.demo.running !== null} onClick={() => { setBoardSession((session) => session + 1); void act('Reset demo', api.reset) }}><Icon name="reset" />Reset demo</button></div>
          {state.demo.running ? <div className="demo-notice" role="status"><span className="spinner" /><span><strong>{state.demo.scenarios[state.demo.running]}</strong> is running. The board updates as each request arrives.</span></div> : state.demo.last && <div className={`demo-notice ${state.demo.last.ok ? '' : 'has-error'}`} role="status"><Icon name={state.demo.last.ok ? 'check' : 'alert'} /><span>{state.demo.last.message}</span></div>}
          {view === 'board' && <ActivityBoard key={boardSession} state={state} pending={pending !== null} onAction={act} onManage={() => setView('access')} />}
          {view === 'access' && <AccessWorkspace state={state} pending={pending !== null} onAction={act} />}
          {view === 'trace' && <LeakWorkspace />}
        </>}
      </main>
      <footer className="app-footer"><span><Icon name="lock" />Seller control center · Project Falcon</span><span>{state?.answer_engine ?? 'Connecting to the answer engine'}</span></footer>
    </div>
  )
}
