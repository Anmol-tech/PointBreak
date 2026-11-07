import { useCallback, useEffect, useRef, useState } from 'react'
import type { TraceMatch, VaultState } from './types'

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${path} failed (${res.status})`)
  return res.json() as Promise<T>
}

export const api = {
  revokeAgent: (id: string) => post(`/api/agents/${encodeURIComponent(id)}/revoke`),
  lockParty: (name: string) => post(`/api/parties/${encodeURIComponent(name)}/lock`),
  unlockParty: (name: string) => post(`/api/parties/${encodeURIComponent(name)}/unlock`),
  setFolders: (name: string, folders: string[]) =>
    post(`/api/parties/${encodeURIComponent(name)}/folders`, { folders }),
  trace: (text: string) => post<{ matches: TraceMatch[] }>('/api/trace', { text }),
  reset: () => post('/api/reset'),
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
