import { useCallback, useEffect, useRef, useState } from 'react'
import type { VendorState, TraceMatch, VaultState } from './types'

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `${path} failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export interface FalconUser { email: string; name: string; groups: string[]; admin: boolean }
export interface FalconAuth { enabled: boolean; provider?: string; pool?: string; user: FalconUser | null }

/** Falcon workforce sign-in (Amazon Cognito). When disabled, the control center is open locally. */
export function useFalconAuth() {
  const [auth, setAuth] = useState<FalconAuth | null>(null)
  useEffect(() => {
    fetch('/auth/me').then((res) => res.json() as Promise<FalconAuth>).then(setAuth).catch(() => setAuth({ enabled: false, user: null }))
  }, [])
  return auth
}

export const api = {
  revokeAgent: (id: string) => post(`/api/agents/${encodeURIComponent(id)}/revoke`),
  lockParty: (name: string) => post(`/api/parties/${encodeURIComponent(name)}/lock`),
  unlockParty: (name: string) => post(`/api/parties/${encodeURIComponent(name)}/unlock`),
  setFolders: (name: string, folders: string[]) =>
    post(`/api/parties/${encodeURIComponent(name)}/folders`, { folders }),
  trace: (text: string) => post<{ matches: TraceMatch[] }>('/api/trace', { text }),
  reset: () => post('/api/reset'),
  runDemo: (name: string) => post(`/api/demo/${name}`),
  inviteVendor: (vendor: { name: string; purpose: string; contact: string; folders: string[]; scope: string[] }) =>
    post<{ name: string; invite_code: string }>('/api/vendors', vendor),
  offboardVendor: (name: string) => post(`/api/vendors/${encodeURIComponent(name)}/offboard`),
  setTools: (name: string, tools: string[]) => post(`/api/parties/${encodeURIComponent(name)}/tools`, { tools }),
}

/** Live gateway state: refetches whenever the server-sent event stream reports a new version. */
export function useVaultState() {
  const [state, setState] = useState<VaultState | null>(null)
  const [connected, setConnected] = useState(false)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch('/api/state')
      if (res.ok) setState((await res.json()) as VaultState)
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    refresh()
    const source = new EventSource('/api/events/stream')
    source.onopen = () => setConnected(true)
    source.onmessage = () => refresh()
    source.onerror = () => setConnected(false)
    // Fallback in case a proxy buffers the event stream.
    const poll = window.setInterval(refresh, 3000)
    return () => {
      source.close()
      window.clearInterval(poll)
    }
  }, [refresh])

  return { state, connected, refresh }
}

// The vendor portal talks to the vendor's own runtime (port 9001), not to Falcon's gateway.
export const VENDOR_PORTAL_URL =
  (import.meta.env.VITE_PARTY_URL as string | undefined) ?? `${window.location.protocol}//${window.location.hostname}:9001`
// Served from the vendor runtime itself, the portal calls its own origin.
const PARTY_URL = window.location.port === '9001' ? '' : VENDOR_PORTAL_URL

async function partyCall<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${PARTY_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `${path} failed (${res.status})`)
  return data as T
}

export interface InvitePreview {
  name: string
  client: string
  purpose: string
  folders: string[]
  scope: string[]
  contact: string
}

export const vendorApi = {
  list: () => partyCall<{ name: string; issuer: string; issuing: boolean; agents: number }[]>('/api/vendors'),
  previewInvite: (code: string) => partyCall<InvitePreview>(`/api/vendor/invite/${encodeURIComponent(code.trim())}`),
  onboard: (code: string, users: string[]) =>
    partyCall<{ name: string; issuer: string; folders: string[] }>('/api/vendor/onboard', 'POST', { invite_code: code, users }),
  addUser: (party: string, user: string) => partyCall(`/api/vendor/${encodeURIComponent(party)}/users`, 'POST', { user }),
  state: (party: string) => partyCall<VendorState>(`/api/vendor/${encodeURIComponent(party)}`),
  startAgent: (party: string, user: string, name: string) => partyCall('/agents', 'POST', { party, user, name }),
  addHelper: (parent: string, name: string, folders: string[]) =>
    partyCall(`/agents/${encodeURIComponent(parent)}/spawn`, 'POST', { name, folders }),
  ask: (agent: string, tool: string, args: Record<string, string>) =>
    partyCall<{ text: string; denied: boolean }>(`/agents/${encodeURIComponent(agent)}/ask`, 'POST', { tool, arguments: args }),
  stopIssuing: (party: string) => partyCall(`/idp/${encodeURIComponent(party)}/stop`, 'POST'),
  resumeIssuing: (party: string) => partyCall(`/idp/${encodeURIComponent(party)}/resume`, 'POST'),
  signIn: (party: string, email: string, password: string) =>
    partyCall<{ email: string; name?: string; provider: string }>(`/api/vendor/${encodeURIComponent(party)}/signin`, 'POST', { email, password }),
}

/** One vendor's own view, refreshed every 2 seconds. */
export function useVendorState(party: string) {
  const [state, setState] = useState<VendorState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await vendorApi.state(party))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the vendor runtime on port 9001')
    }
  }, [party])

  useEffect(() => {
    refresh()
    const poll = window.setInterval(refresh, 2000)
    return () => window.clearInterval(poll)
  }, [refresh])

  return { state, error, refresh }
}
