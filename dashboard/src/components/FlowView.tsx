import { describe, type Step } from '../describe'
import type { VaultEvent } from '../types'
import { Panel, Pill, timeLabel } from './ui'

function StepRow({ step, index }: { step: Step; index: number }) {
  const icon = step.state === 'ok' ? '✓' : step.state === 'fail' ? '✕' : '–'
  const ring =
    step.state === 'ok'
      ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/50'
      : step.state === 'fail'
        ? 'bg-rose-500/25 text-rose-200 ring-rose-500/60'
        : 'bg-slate-800 text-slate-600 ring-slate-700'
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-slate-700 last:hidden" />
      <span className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ${ring}`}>
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={`text-sm ${step.state === 'skip' ? 'text-slate-600' : 'text-slate-100'}`}>
          <span className="mr-1.5 text-slate-500">{index + 1}.</span>
          {step.label}
        </p>
        {step.detail && (
          <p className={`mt-0.5 text-xs ${step.state === 'fail' ? 'text-rose-300' : 'text-slate-400'}`}>{step.detail}</p>
        )}
      </div>
    </li>
  )
}

export function FlowView({ event, following, onFollow }: {
  event: VaultEvent | undefined
  following: boolean
  onFollow: () => void
}) {
  const action = !following && (
    <button type="button" onClick={onFollow} className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800">
      Follow live
    </button>
  )

  if (!event) {
    return (
      <Panel title="How the last request was handled" subtitle="Click a demo button above to start" action={action}>
        <p className="text-sm text-slate-500">Nothing yet. When an agent asks for a badge or sends a request, every check it goes through appears here.</p>
      </Panel>
    )
  }

  const story = describe(event)
  const tone = story.outcome === 'allowed' ? 'green' : story.outcome === 'blocked' ? 'red' : story.outcome === 'alert' ? 'amber' : 'slate'
  const label = { allowed: 'Allowed', blocked: 'Blocked', alert: 'Alert', info: 'Info' }[story.outcome]
  const subtitle =
    story.kind === 'badge'
      ? 'How an agent gets its ID badge'
      : story.kind === 'request'
        ? 'Every check a request passes before anything is answered'
        : 'Action by the data-room owner or the system'

  return (
    <Panel title={following ? 'Live: latest request' : 'Selected request'} subtitle={subtitle} action={action}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-medium leading-snug text-white">{story.headline}</p>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] text-slate-500">{timeLabel(event.ts)}</span>
          <Pill tone={tone}>{label}</Pill>
        </div>
      </div>
      {event.chain.length > 0 && (
        <p className="mt-1 text-xs text-slate-400">
          Identity chain: {[...event.chain].reverse().join(' ← ')}
        </p>
      )}

      {story.steps.length > 0 && (
        <ol className="mt-5">
          {story.steps.map((s, i) => <StepRow key={i} step={s} index={i} />)}
        </ol>
      )}

      {story.badge && (
        <div className="mt-5 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-slate-900 p-4">
          <p className="text-[11px] uppercase tracking-wider text-emerald-300/80">Badge given</p>
          <p className="mt-1 font-mono text-lg text-white">{story.badge.agent}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-400">Works for</dt>
            <dd className="text-slate-200">{story.badge.actsFor} at {story.badge.company}</dd>
            <dt className="text-slate-400">May look at</dt>
            <dd className="text-slate-200">{story.badge.folders.join(', ') || 'nothing'}</dd>
            <dt className="text-slate-400">May</dt>
            <dd className="text-slate-200">{story.badge.abilities.join(' and ') || 'nothing'}</dd>
            <dt className="text-slate-400">Never</dt>
            <dd className="text-slate-200">download or export documents</dd>
            <dt className="text-slate-400">Expires</dt>
            <dd className="text-slate-200">in 15 minutes, and only works with this agent's own key</dd>
          </dl>
        </div>
      )}

      {story.answer && (
        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">What the agent received (all it ever gets)</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-200">{story.answer}</pre>
        </div>
      )}
    </Panel>
  )
}
