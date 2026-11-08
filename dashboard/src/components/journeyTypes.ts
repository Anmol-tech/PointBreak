/** Shared by the flat journey replay and the 3D live world. */

export type NodeId = 'person' | 'login' | 'agent' | 'gate' | 'vault'
export type Tone = 'ok' | 'bad' | 'info'
export type CheckState = 'wait' | 'run' | 'ok' | 'fail' | 'skip'

export interface Phase {
  key: string
  say: string
  ms: number
  from?: NodeId
  to?: NodeId
  packet?: string
  tone?: Tone
  focus: NodeId[]
  check?: number
}

