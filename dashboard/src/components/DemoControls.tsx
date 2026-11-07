import type { DemoStatus } from '../types'
import { Icon } from './Icon'

const ORDER = [['team', 'Agent team'], ['stolen', 'Stolen token'], ['scrape', 'Split scraping'], ['leak', 'Leak trace']] as const

export function DemoControls({ demo, pending, onRun }: { demo: DemoStatus; pending: boolean; onRun: (name: string) => void }) {
  const busy = demo.running !== null || pending
  return (
    <div className="demo-controls" role="group" aria-label="Run a demo scenario">
      <span className="toolbar-label">Try a scenario</span>
        {ORDER.map(([name, label], i) => {
          const running = demo.running === name
          return (
            <button
              key={name}
              type="button"
              disabled={busy}
              aria-label={`Run ${label} demo`}
              onClick={() => onRun(name)}
              className={`scenario-button ${name === 'team' ? 'scenario-primary' : ''}`}
            >
              {running ? (
                <span className="spinner" />
              ) : name === 'team' ? <Icon name="play" /> : <span className="scenario-number">{i + 1}</span>}
              {label}
            </button>
          )
        })}
    </div>
  )
}
