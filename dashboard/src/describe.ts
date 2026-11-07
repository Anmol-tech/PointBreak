import type { VaultEvent } from './types'

/** Turns raw gateway events into plain-language stories for the UI. */

export type StepState = 'ok' | 'fail' | 'skip'

export interface Step {
  label: string
  detail?: string
  state: StepState
}

export interface Badge {
  agent: string
  actsFor: string
  company: string
  folders: string[]
  abilities: string[]
}

export interface Story {
  kind: 'badge' | 'request' | 'owner'
  outcome: 'allowed' | 'blocked' | 'alert' | 'info'
  actor: string
  headline: string
  steps: Step[]
  badge?: Badge
  question?: string
  answer?: string
}

const ABILITY: Record<string, string> = {
  'vault:ask': 'ask questions',
  'vault:list': 'see the folder list',
}

function agentName(e: VaultEvent): string {
  if (e.chain.length) return e.chain[e.chain.length - 1]
  if (e.agent) return e.agent.split(':').pop() ?? e.agent
  return 'unknown agent'
}

function failAt(reason: string, groups: string[][], fallback: number): number {
  const r = reason.toLowerCase()
  const i = groups.findIndex((keys) => keys.some((k) => r.includes(k)))
  return i === -1 ? fallback : i
}

function mark(labels: { label: string; detail?: string }[], failIndex: number | null): Step[] {
  return labels.map((s, i) => ({
    ...s,
    state: failIndex === null || i < failIndex ? 'ok' : i === failIndex ? 'fail' : 'skip',
  }))
}

const CALL_CHECKS = [
  { label: 'Badge is real and not expired', keys: ['no agent identity', 'access token', 'expired', 'unknown agent'] },
  { label: "Request is signed with the agent's own secret key", keys: ['dpop', 'different key', 'replayed'] },
  { label: 'Agent, and whoever created it, is still allowed in', keys: ['revoked'] },
  { label: 'Company is not locked out', keys: ['locked'] },
  { label: 'This action is allowed for this agent', keys: ['never leave', 'bulk export', 'not allowed for this agent', 'unknown tool'] },
  { label: 'Folder is shared with this agent', keys: ['folder'] },
]

function actionText(e: VaultEvent): string {
  switch (e.tool) {
    case 'ask_question':
      return e.question ? `asked: “${e.question}”` : 'asked a question'
    case 'get_document':
      return 'tried to download a full document'
    case 'export_all':
      return 'tried to export every document'
    case 'list_folders':
      return 'looked at the list of folders'
    default:
      return `called ${e.tool ?? 'a tool'}`
  }
}

function requestStory(e: VaultEvent): Story {
  const actor = agentName(e)
  const reason = e.reason ?? ''
  const allowed = e.decision === 'allowed'
  const checks = CALL_CHECKS.map(({ label }) => ({ label }))
  let steps: Step[]
  if (allowed) {
    const engine = /by (.+?);/.exec(reason)?.[1]
    const last =
      e.tool === 'list_folders'
        ? { label: 'Showed folder and section names only', detail: 'No document content is shared' }
        : {
            label: 'Vault agent answered from inside the vault',
            detail: `${engine ? `Written by ${engine}. ` : ''}Private data hidden, invisible fingerprint added. The document itself never leaves.`,
          }
    steps = [...mark(checks, null), { ...last, state: 'ok' }]
  } else {
    const idx = failAt(reason, CALL_CHECKS.map((c) => c.keys), 4)
    steps = mark(checks, idx)
    steps[idx].detail = reason
    steps.push({ label: 'Vault agent answers', state: 'skip' })
  }
  // A key-check failure means someone other than the agent is holding its badge.
  const impostor = !allowed && failAt(reason, [CALL_CHECKS[1].keys], -1) === 0
  return {
    kind: 'request',
    outcome: allowed ? 'allowed' : 'blocked',
    actor,
    headline: impostor ? `Someone using ${actor}'s copied badge ${actionText(e)}` : `${actor} ${actionText(e)}`,
    steps,
    question: e.question ?? undefined,
    answer: e.answer ?? undefined,
  }
}

function badgeStory(e: VaultEvent): Story {
  const reason = e.reason ?? ''
  if (e.decision !== 'allowed') {
    const labels = [
      { label: "The agent's company login vouched for it" },
      { label: 'VendorVault checked the company signature and the deal' },
      { label: 'Agent proved it holds its own secret key' },
      { label: 'Requested access is within its limits' },
      { label: 'Badge issued' },
    ]
    const idx = failAt(reason, [
      ['stopped issuing', 'not a ', 'may not run'],
      ['issuer', 'signature', 'id-jag', 'deal', 'already been used', 'reach'],
      ['dpop', 'key proof'],
      ['more access', 'revoked', 'locked', 'already used by another'],
    ], 1)
    const steps = mark(labels, idx)
    steps[idx].detail = reason.replace(/^Token refused: /, '')
    return { kind: 'badge', outcome: 'blocked', actor: e.agent ?? 'agent', headline: 'Badge refused', steps }
  }

  const [company, user] = e.chain
  const actor = agentName(e)
  const isHelper = e.chain.length > 3
  const parent = e.chain[e.chain.length - 2]
  const folders = e.detail?.folders ?? []
  const abilities = (e.detail?.scope ?? []).map((s) => ABILITY[s] ?? s)
  const labels = isHelper
    ? [
        { label: `${parent} proved who it is`, detail: 'Its own badge, signed with its own key' },
        { label: `${actor} proved it holds its own secret key`, detail: 'Each helper gets a separate key' },
        { label: `Requested access is within ${parent}'s access`, detail: 'A helper can never get more than its parent' },
        { label: '15-minute badge issued, locked to that key' },
      ]
    : [
        { label: `${user} signed in at ${company}`, detail: `${company}'s own company login` },
        { label: `${company}'s login vouched for the agent`, detail: `Signed note: “this agent works for ${user} on this deal” (ID-JAG)` },
        { label: `VendorVault checked ${company}'s signature and the deal`, detail: `Only ${company}'s login can vouch for ${company} people` },
        { label: 'Agent proved it holds its own secret key', detail: 'So a copied badge is useless on its own' },
        { label: '15-minute badge issued, locked to that key' },
      ]
  return {
    kind: 'badge',
    outcome: 'allowed',
    actor,
    headline: isHelper ? `${parent} created helper ${actor} with less access` : `${actor} got a badge to enter the data room`,
    steps: mark(labels, null),
    badge: { agent: actor, actsFor: user, company, folders, abilities },
  }
}

export function describe(e: VaultEvent): Story {
  if (e.kind === 'call') return requestStory(e)
  if (e.kind === 'token') return badgeStory(e)
  return {
    kind: 'owner',
    outcome: e.decision === 'alert' ? 'alert' : 'info',
    actor: e.party ?? 'VendorVault',
    headline: e.reason ?? e.kind,
    steps: [],
  }
}
