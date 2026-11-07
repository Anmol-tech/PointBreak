export type Decision = 'allowed' | 'denied' | 'alert' | 'info'
export type ActionHandler = (label: string, action: () => Promise<unknown>) => Promise<void>

export interface VaultEvent {
  id: number
  ts: number
  kind: 'token' | 'call' | 'revoke' | 'lock' | 'alert' | 'trace' | 'share'
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

export interface Party {
  name: string
  issuer: string
  folders: string[]
  scope: string[]
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
}

export interface VaultState {
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

export interface TraceMatch {
  agent_id: string
  chain: string[]
  method: string
  confidence: number
}
