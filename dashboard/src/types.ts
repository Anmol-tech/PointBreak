export type Decision = 'allowed' | 'denied' | 'alert' | 'info'
export type ActionHandler = (label: string, action: () => Promise<unknown>) => Promise<void>

export interface VaultEvent {
  id: number
  ts: number
  kind: 'token' | 'call' | 'revoke' | 'lock' | 'alert' | 'trace' | 'share' | 'vendor'
  decision: Decision
  party: string | null
  agent: string | null
  chain: string[]
  tool?: string | null
  question?: string | null
  answer?: string | null
  reason?: string | null
  sources?: string[]
  detail?: { scope?: string[]; folders?: string[] }
}

/** A vendor company bringing AI agents. */
export interface Party {
  name: string
  issuer: string | null
  folders: string[]
  scope: string[]
  purpose: string
  contact: string
  status: 'invited' | 'active' | 'offboarded'
  invite_code: string | null
  locked: boolean
  lock_reason: string | null
  coverage: number
  revealed: number
  total: number
  agents_contributing: number
  agent_sections: Record<string, number>
  split_scraping: boolean
}

export interface Agent {
  id: string
  name: string
  party: string
  user: string
  parent: string | null
  status: 'active' | 'revoked'
  scope: string[]
  folders: string[]
  created: number
  revoked_reason: string | null
  fingerprint: string
  jkt: string
  chain: string[]
  calls: number
  sections_seen: number
}

export interface Folder {
  name: string
  docs: string[]
  shared_with: string[]
}

export interface DemoStatus {
  running: string | null
  last: { name: string; ok: boolean; message: string; seconds: number } | null
  scenarios: Record<string, string>
  notes?: { ts: number; text: string }[]
}

export interface VaultState {
  client: string
  deal: string
  version: number
  thresholds: { alert: number; lock: number }
  parties: Party[]
  agents: Agent[]
  folders: Folder[]
  events: VaultEvent[]
  demo: DemoStatus
  answer_engine: string
}

export interface VendorAgent {
  name: string
  party: string
  user: string
  parent: string | null
  agent_id: string | null
  granted_scope: string[] | null
  granted_folders: string[] | null
  expires_in: number
  status: 'active' | 'stopped' | 'locked'
}

export interface VendorEntry {
  id: number
  ts: number
  kind: 'badge' | 'call' | 'onboard' | 'signin'
  party: string | null
  agent: string
  user?: string
  parent?: string | null
  decision: 'allowed' | 'denied'
  tool?: string
  args?: { question?: string; folder?: string; path?: string }
  text?: string
  reason?: string | null
  folders?: string[]
  scope?: string[]
}

/** What a vendor platform learns from Falcon: only its own terms. */
export interface VendorTerms {
  name: string
  client: string
  purpose: string
  folders: string[]
  scope: string[]
  status: 'invited' | 'active' | 'offboarded'
  locked: boolean
  lock_reason: string | null
}

export interface VendorState {
  client: string
  access: VendorTerms | null
  party: string
  issuer: string
  issuing: boolean
  id_jags_issued: number
  users: string[]
  deal: string
  sso?: { provider: string; pool_id: string | null; signed_in: string[] }
  agents: VendorAgent[]
  history: VendorEntry[]
}

export interface TraceMatch {
  agent_id: string
  chain: string[]
  method: string
  confidence: number
}
