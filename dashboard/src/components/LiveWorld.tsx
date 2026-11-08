import { ContactShadows, Environment, Html, Lightformer, OrbitControls, QuadraticBezierLine, Sparkles, Trail } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { describe } from '../describe'
import type { Agent, Party, VaultEvent, VaultState } from '../types'
import { AgentModel, FolderModel, LoginModel, ShieldModel, VaultModel, type ModelMaterials } from './journeyModels'
import type { CheckState } from './journeyTypes'

/**
 * Event-driven 3D world. The scene mirrors the real system (one zone per vendor, one robot per agent)
 * and every gateway event plays its own animation when it happens, in order.
 */

type Vec = [number, number, number]
const C = { accent: '#9aafff', ok: '#5eead4', bad: '#ff4d6d', warn: '#f4d28b', info: '#e7edff', body: '#3b54b0', grey: '#4a5270' }
const SHIELD: Vec = [4.6, 0, 0]
const SAFE: Vec = [8.4, 0, 0]
const WALL_X = 2.6
const ZONE_DEPTH = 3.8
const FLOAT = 1.25

// ---------- layout: where everything stands, derived from real state ----------

interface Layout {
  vendors: Record<string, { z: number; login: Vec }>
  agents: Record<string, Vec>
  attacker: (party: string | null) => Vec
  outside: Vec
  minZ: number
  maxZ: number
}

function depthOf(agent: Agent, all: Agent[]): number {
  let d = 0
  let cur = agent
  while (cur.parent) {
    const parent = all.find((a) => a.id === cur.parent)
    if (!parent) break
    d++
    cur = parent
  }
  return d
}

function computeLayout(parties: Party[], agents: Agent[]): Layout {
  const n = Math.max(parties.length, 1)
  const vendors: Layout['vendors'] = {}
  const pos: Layout['agents'] = {}
  parties.forEach((p, i) => {
    const z = (i - (n - 1) / 2) * (ZONE_DEPTH + 0.5)
    vendors[p.name] = { z, login: [-8.2, 0, z] }
    const mine = agents.filter((a) => a.party === p.name)
    const roots = mine.filter((a) => !a.parent)
    roots.forEach((r, ri) => {
      const rz = z + (ri - (roots.length - 1) / 2) * 1.5
      pos[r.id] = [-5, 0, rz]
      const place = (parentId: string, parentZ: number) => {
        const kids = mine.filter((a) => a.parent === parentId)
        kids.forEach((k, ki) => {
          const d = depthOf(k, mine)
          const kz = parentZ + (ki - (kids.length - 1) / 2) * (kids.length > 3 ? 0.66 : 1.35)
          pos[k.id] = [-5 + d * 2.75, 0, Math.max(z - ZONE_DEPTH / 2 + 0.3, Math.min(z + ZONE_DEPTH / 2 - 0.3, kz))]
          place(k.id, kz)
        })
      }
      place(r.id, rz)
    })
  })
  const zs = Object.values(vendors).map((v) => v.z)
  const minZ = Math.min(...zs, 0) - ZONE_DEPTH / 2
  const maxZ = Math.max(...zs, 0) + ZONE_DEPTH / 2
  return {
    vendors,
    agents: pos,
    attacker: (party) => [0.6, 0, (party && vendors[party] ? vendors[party].z : 0) + ZONE_DEPTH / 2 + 0.9],
    outside: [-10.5, 0, maxZ + 1.2],
    minZ,
    maxZ,
  }
}

// ---------- action plans: one per real event ----------

interface Orb { from: Vec; to: Vec; color: string; label: string }
interface Step {
  dur: number
  say?: string
  orb?: Orb
  focus?: string[]
  shieldTone?: 'ok' | 'bad' | 'warn'
  checks?: CheckState[]
  folders?: string[]
  attacker?: boolean
  apply?: () => void
}
interface Plan { event: VaultEvent; steps: Step[] }

interface Display {
  shown: Set<string>
  revoked: Set<string>
  locked: Set<string>
  vendorStatus: Record<string, Party['status']>
}

const up = ([x, , z]: Vec, y = FLOAT): Vec => [x, y, z]

function descendants(id: string, agents: Agent[]): string[] {
  const out: string[] = []
  const walk = (pid: string) => agents.filter((a) => a.parent === pid).forEach((a) => { out.push(a.id); walk(a.id) })
  walk(id)
  return out
}

function buildPlan(e: VaultEvent, state: VaultState, L: Layout, display: Display, mutate: (fn: (d: Display) => void) => void): Plan {
  const story = describe(e)
  const agent = state.agents.find((a) => a.id === e.agent)
  const agentPos = agent ? L.agents[agent.id] : undefined
  const vendor = e.party ? L.vendors[e.party] : undefined
  const steps: Step[] = []
  const name = agent?.name ?? story.actor

  if (e.kind === 'token') {
    if (e.decision !== 'allowed' || !agent || !agentPos) {
      const from = vendor ? up(vendor.login) : up(L.outside)
      steps.push({ dur: 0.9, orb: { from, to: up(SHIELD), color: C.info, label: 'Badge request' }, focus: ['shield'] })
      steps.push({ dur: 0.7, shieldTone: 'bad', focus: ['shield'], say: story.steps.find((s) => s.state === 'fail')?.detail ?? 'Badge refused' })
      steps.push({ dur: 0.9, orb: { from: up(SHIELD), to: from, color: C.bad, label: 'Refused' } })
      return { event: e, steps }
    }
    const isNew = !display.shown.has(agent.id)
    const spawn = () => mutate((d) => { d.shown.add(agent.id) })
    if (agent.parent) {
      const parentPos = L.agents[agent.parent] ?? agentPos
      steps.push({ dur: 0.7, apply: spawn, focus: [`agent:${agent.parent}`, `agent:${agent.id}`], say: `${agent.parent.split(':')[1]} creates helper ${name} with narrower access` })
      steps.push({ dur: 0.9, orb: { from: up(parentPos), to: up(SHIELD), color: C.info, label: 'Token exchange' }, focus: ['shield'] })
      steps.push({ dur: 0.6, shieldTone: 'ok', focus: ['shield'], say: 'VendorVault checks the helper asks for less than its parent' })
      steps.push({ dur: 0.9, orb: { from: up(SHIELD), to: up(agentPos), color: C.ok, label: 'Narrower badge' }, focus: [`agent:${agent.id}`] })
    } else {
      if (isNew) steps.push({ dur: 0.6, apply: spawn, focus: [`agent:${agent.id}`], say: `${agent.user} starts ${name}` })
      steps.push({ dur: 0.9, orb: { from: up(vendor!.login), to: up(agentPos), color: C.info, label: 'Signed ID-JAG' }, focus: [`login:${agent.party}`, `agent:${agent.id}`], say: `${agent.party}'s login vouches for ${name}` })
      steps.push({ dur: 0.9, orb: { from: up(agentPos), to: up(SHIELD), color: C.info, label: 'ID-JAG + key proof' }, focus: ['shield'] })
      steps.push({ dur: 0.6, shieldTone: 'ok', focus: ['shield'], say: `VendorVault verifies ${agent.party}'s signature` })
      steps.push({ dur: 0.9, orb: { from: up(SHIELD), to: up(agentPos), color: C.ok, label: 'ID badge' }, focus: [`agent:${agent.id}`] })
    }
    return { event: e, steps }
  }

  if (e.kind === 'call') {
    const checks = story.steps.slice(0, 6)
    const failIdx = checks.findIndex((s) => s.state === 'fail')
    const impostor = e.decision !== 'allowed' && failIdx === 1
    const from = impostor ? up(L.attacker(e.party)) : agentPos ? up(agentPos) : up(L.outside)
    const label = impostor ? 'Copied badge' : e.tool === 'ask_question' ? 'Question' : e.tool === 'get_document' ? 'Download request' : e.tool === 'export_all' ? 'Export request' : 'Request'
    steps.push({ dur: 0.9, orb: { from, to: up(SHIELD), color: impostor ? C.bad : C.info, label }, attacker: impostor, focus: impostor ? ['attacker', 'shield'] : [`agent:${e.agent}`, 'shield'] })
    const states: CheckState[] = checks.map(() => 'wait')
    const last = failIdx >= 0 ? failIdx : checks.length - 1
    for (let i = 0; i <= last; i++) {
      const snapshot = [...states]
      snapshot[i] = i === failIdx ? 'fail' : 'ok'
      for (let j = 0; j < i; j++) snapshot[j] = 'ok'
      if (i === failIdx) for (let j = i + 1; j < checks.length; j++) snapshot[j] = 'skip'
      steps.push({ dur: i === failIdx ? 0.9 : 0.16, checks: snapshot, focus: ['shield'], attacker: impostor, shieldTone: i === failIdx ? 'bad' : undefined, say: i === failIdx ? `✕ ${checks[i].label}` : undefined })
    }
    const done = checks.map((_, i) => (failIdx >= 0 ? (i < failIdx ? 'ok' : i === failIdx ? 'fail' : 'skip') : 'ok')) as CheckState[]
    if (failIdx >= 0) {
      steps.push({ dur: 1.0, orb: { from: up(SHIELD), to: from, color: C.bad, label: 'Blocked' }, checks: done, shieldTone: 'bad', attacker: impostor, say: e.reason ?? 'Blocked' })
      return { event: e, steps }
    }
    if (e.tool === 'list_folders') {
      steps.push({ dur: 0.9, orb: { from: up(SHIELD), to: from, color: C.ok, label: 'Folder names only' }, checks: done })
      return { event: e, steps }
    }
    const folders = [...new Set((e.sources ?? []).map((s) => s.split('/')[0]))]
    steps.push({ dur: 0.8, orb: { from: up(SHIELD), to: up(SAFE), color: C.info, label: 'Search inside' }, checks: done, focus: ['safe'] })
    steps.push({ dur: 0.9, folders, focus: ['safe'], checks: done, say: `Found ${folders.join(', ') || 'nothing'} · masked · fingerprinted` })
    steps.push({ dur: 1.1, orb: { from: up(SAFE), to: from, color: C.ok, label: 'Masked answer' }, checks: done, folders, focus: [`agent:${e.agent}`], say: 'Only the answer leaves. The documents stay.' })
    return { event: e, steps }
  }

  if (e.kind === 'revoke' && agent && agentPos) {
    const ids = [agent.id, ...descendants(agent.id, state.agents)]
    steps.push({ dur: 0.6, shieldTone: 'warn', focus: ['shield'], say: e.reason ?? `Owner revokes ${name}` })
    steps.push({ dur: 1.0, orb: { from: up(SHIELD), to: up(agentPos), color: C.bad, label: 'Revoked' }, focus: ids.map((i) => `agent:${i}`) })
    steps.push({ dur: 0.9, apply: () => mutate((d) => ids.forEach((i) => d.revoked.add(i))), focus: ids.map((i) => `agent:${i}`), say: ids.length > 1 ? `${name} and ${ids.length - 1} helper(s) stop working` : `${name} stops working` })
    return { event: e, steps }
  }

  if (e.kind === 'lock' && e.party) {
    const locking = e.decision === 'alert'
    steps.push({ dur: 0.7, shieldTone: locking ? 'bad' : 'ok', focus: ['shield', `zone:${e.party}`], say: e.reason ?? '' })
    steps.push({ dur: 1.2, apply: () => mutate((d) => { if (locking) d.locked.add(e.party!); else d.locked.delete(e.party!) }), focus: [`zone:${e.party}`] })
    return { event: e, steps }
  }

  if (e.kind === 'alert') {
    steps.push({ dur: 1.4, shieldTone: 'warn', focus: ['shield', `zone:${e.party}`], say: e.reason ?? 'Alert' })
    return { event: e, steps }
  }

  if (e.kind === 'vendor' && e.party) {
    const status: Party['status'] = e.decision === 'alert' ? 'offboarded' : e.decision === 'allowed' ? 'active' : 'invited'
    steps.push({ dur: 1.4, apply: () => mutate((d) => { d.vendorStatus[e.party!] = status; if (status === 'offboarded') state.agents.filter((a) => a.party === e.party).forEach((a) => d.revoked.add(a.id)) }), focus: [`zone:${e.party}`, `login:${e.party}`], say: e.reason ?? '' })
    if (status === 'active' && vendor) steps.push({ dur: 0.9, orb: { from: up(vendor.login), to: up(SHIELD), color: C.ok, label: 'Login connected' }, focus: ['shield'] })
    return { event: e, steps }
  }

  if (e.kind === 'trace' && agentPos) {
    steps.push({ dur: 1.2, orb: { from: up(L.outside), to: up(agentPos), color: C.warn, label: 'Leak traced' }, focus: [`agent:${e.agent}`], say: e.reason ?? 'Leak traced' })
    steps.push({ dur: 0.8, focus: [`agent:${e.agent}`] })
    return { event: e, steps }
  }

  steps.push({ dur: 0.9, focus: ['safe'], say: e.reason ?? story.headline })
  return { event: e, steps }
}

// ---------- scene pieces ----------

function useMaterials(color: string) {
  const m = useMemo<ModelMaterials & { body: THREE.MeshStandardMaterial; glow: THREE.MeshStandardMaterial }>(() => ({
    body: new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.22, emissive: new THREE.Color(C.accent), emissiveIntensity: 0.1 }),
    glow: new THREE.MeshStandardMaterial({ color: C.accent, emissive: new THREE.Color(C.accent), emissiveIntensity: 1.1, toneMapped: false }),
    metal: new THREE.MeshStandardMaterial({ color: '#c9d4f5', metalness: 0.95, roughness: 0.18 }),
  }), [color])
  useEffect(() => () => { m.body.dispose(); m.glow.dispose(); m.metal.dispose() }, [m])
  return m
}

function Animated({ pos, focus, tint, dim, scale = 1, spin = 0.3, selected, onClick, children }: {
  pos: Vec
  focus: boolean
  tint: string
  dim?: boolean
  scale?: number
  spin?: number
  selected?: boolean
  onClick?: () => void
  children: (m: ModelMaterials) => ReactNode
}) {
  const g = useRef<THREE.Group>(null)
  const [hover, setHover] = useState(false)
  focus = focus || hover || !!selected
  const m = useMaterials(dim ? C.grey : C.body)
  const born = useRef<number | null>(null)
  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    if (born.current === null) born.current = t
    const grow = Math.min(1, (t - born.current) / 0.6)
    const k = Math.min(1, delta * 6)
    if (!g.current) return
    g.current.position.y = FLOAT + Math.sin(t * 1.5 + pos[0] + pos[2]) * 0.07
    g.current.rotation.y = Math.sin(t * 0.6 + pos[2]) * spin
    const target = scale * (focus ? 1.12 : 1) * (1 - (1 - grow) ** 3)
    g.current.scale.lerp(new THREE.Vector3(target, target, target), grow < 1 ? 1 : k)
    m.body.emissive.set(tint)
    m.glow.emissive.set(dim ? C.grey : tint)
    m.glow.color.set(dim ? C.grey : tint)
    m.body.emissiveIntensity += ((dim ? 0 : focus ? 0.6 + Math.sin(t * 5) * 0.15 : 0.07) - m.body.emissiveIntensity) * k
    m.glow.emissiveIntensity += ((dim ? 0.1 : focus ? 3.2 : 1.0) - m.glow.emissiveIntensity) * k
  })
  return (
    <group
      position={pos}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      onPointerOver={onClick ? (e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' } : undefined}
      onPointerOut={onClick ? () => { setHover(false); document.body.style.cursor = '' } : undefined}
    >
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5 * scale, 0.58 * scale, 40]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={focus ? 2.5 : dim ? 0.05 : 0.4} toneMapped={!focus} />
      </mesh>
      {selected && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.72 * scale, 0.8 * scale, 48]} />
          <meshStandardMaterial color={C.ok} emissive={C.ok} emissiveIntensity={3} toneMapped={false} />
        </mesh>
      )}
      {/* invisible hit area so small robots are easy to click */}
      {onClick && (
        <mesh position={[0, FLOAT, 0]} visible={false}>
          <cylinderGeometry args={[0.7 * scale, 0.7 * scale, 1.8, 12]} />
        </mesh>
      )}
      <group ref={g} scale={0}>{children(m)}</group>
    </group>
  )
}

function Label({ pos, title, sub, tone, small }: { pos: Vec; title: string; sub?: string; tone?: 'bad' | 'dim' | 'focus'; small?: boolean }) {
  return (
    <Html position={[pos[0], 0.02, pos[2] + (small ? 0.88 : 1.12)]} center distanceFactor={small ? 15 : 12} zIndexRange={[10, 0]}>
      <div className={`j3d-label ${tone === 'bad' ? 'is-bad' : tone === 'focus' ? 'is-focus' : ''} ${tone === 'dim' ? 'is-dim' : ''} ${small ? 'is-small' : ''}`}>
        <strong>{title}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </Html>
  )
}

function OrbFlight({ orb, dur, onKey }: { orb: Orb; dur: number; onKey: string }) {
  const ball = useRef<THREE.Mesh>(null)
  const tag = useRef<THREE.Group>(null)
  const start = useRef<number | null>(null)
  const curve = useMemo(() => {
    const a = new THREE.Vector3(...orb.from)
    const b = new THREE.Vector3(...orb.to)
    return new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 2 + a.distanceTo(b) * 0.12, 0)), b)
  }, [orb])
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime
    const raw = Math.min(1, (clock.elapsedTime - start.current) / Math.max(0.2, dur * 0.9))
    const t = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2
    const p = curve.getPoint(t)
    ball.current?.position.copy(p)
    tag.current?.position.set(p.x, p.y + 0.55, p.z)
  })
  return (
    <group key={onKey}>
      <Trail width={1.4} length={6} color={orb.color} attenuation={(w) => w * w} decay={1.2}>
        <mesh ref={ball} position={orb.from}>
          <sphereGeometry args={[0.16, 24, 24]} />
          <meshStandardMaterial color={orb.color} emissive={orb.color} emissiveIntensity={5} toneMapped={false} />
          <mesh><sphereGeometry args={[0.3, 20, 20]} /><meshBasicMaterial color={orb.color} transparent opacity={0.18} depthWrite={false} /></mesh>
        </mesh>
      </Trail>
      <group ref={tag} position={orb.from}>
        <Html center distanceFactor={12} zIndexRange={[20, 10]}>
          <div className={`j3d-packet ${orb.color === C.bad ? 'tone-bad' : orb.color === C.ok ? 'tone-ok' : orb.color === C.warn ? 'tone-warn' : 'tone-info'}`}>{orb.label}</div>
        </Html>
      </group>
    </group>
  )
}

const CHECK_COLOR: Record<CheckState, string> = { wait: '#2b3962', run: C.accent, ok: C.ok, fail: C.bad, skip: '#1a2440' }

function CheckRing({ states }: { states: CheckState[] }) {
  const ring = useRef<THREE.Group>(null)
  useFrame((_, delta) => { if (ring.current) ring.current.rotation.y += delta * 0.6 })
  return (
    <group ref={ring} position={[SHIELD[0], FLOAT, SHIELD[2]]}>
      {states.map((s, i) => {
        const a = (i / states.length) * Math.PI * 2
        const lit = s === 'ok' || s === 'fail'
        return (
          <mesh key={i} position={[Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6]}>
            <sphereGeometry args={[0.13, 16, 16]} />
            <meshStandardMaterial color={CHECK_COLOR[s]} emissive={CHECK_COLOR[s]} emissiveIntensity={lit ? 3 : 0.2} toneMapped={!lit} transparent opacity={s === 'skip' ? 0.3 : 1} />
          </mesh>
        )
      })}
    </group>
  )
}

function Zone({ party, z, status, locked, focus }: { party: Party; z: number; status: Party['status']; locked: boolean; focus: boolean }) {
  const color = status === 'offboarded' ? '#262a36' : locked ? '#4a1624' : status === 'invited' ? '#2a2a1c' : '#3a2f14'
  const width = WALL_X + 10.2
  return (
    <group position={[-10.2 + width / 2, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, ZONE_DEPTH]} />
        <meshStandardMaterial color={color} metalness={0.2} roughness={0.85} transparent opacity={status === 'invited' ? 0.45 : 1} emissive={locked ? C.bad : focus ? C.warn : '#000000'} emissiveIntensity={locked ? 0.25 : focus ? 0.12 : 0} />
      </mesh>
      <Html position={[width / 2 - 0.3, 0.02, ZONE_DEPTH / 2 - 0.25]} distanceFactor={14} zIndexRange={[4, 0]}>
        <span className={`j3d-zone is-right ${locked ? 'is-locked' : ''} ${status !== 'active' ? 'is-muted' : ''}`}>
          {party.name}{status === 'offboarded' ? ' · offboarded' : locked ? ' · locked' : status === 'invited' ? ' · invited' : ''}
        </span>
      </Html>
    </group>
  )
}

function Wall({ minZ, maxZ, bad }: { minZ: number; maxZ: number; bad: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const depth = maxZ - minZ + 1
  useFrame(({ clock }) => { if (mat.current) mat.current.opacity = (bad ? 0.22 : 0.1) + Math.sin(clock.elapsedTime * (bad ? 6 : 1.5)) * 0.04 })
  return (
    <group position={[WALL_X, 1.6, (minZ + maxZ) / 2]}>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[depth, 3.2]} />
        <meshStandardMaterial ref={mat} color={bad ? C.bad : C.accent} emissive={bad ? C.bad : C.accent} emissiveIntensity={0.6} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[0.04, 0.04, depth]} />
        <meshStandardMaterial color={bad ? C.bad : C.accent} emissive={bad ? C.bad : C.accent} emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      <Html position={[0, 2, -depth / 2 + 0.3]} center distanceFactor={14}>
        <span className="j3d-wall">VendorVault boundary</span>
      </Html>
    </group>
  )
}

// ---------- the world ----------

/** Smoothly re-frames the camera when vendor zones are added or removed. */
function CameraRig({ minZ, maxZ, focusAt }: { minZ: number; maxZ: number; focusAt: Vec | null }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | null }
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; until: number } | null>(null)
  const fx = focusAt?.[0]
  const fz = focusAt?.[2]
  useEffect(() => {
    if (fx !== undefined && fz !== undefined) {
      goal.current = { pos: new THREE.Vector3(fx + 1.2, 4.6, fz + 6.2), target: new THREE.Vector3(fx + 0.6, 0.9, fz), until: performance.now() + 1800 }
      return
    }
    const extent = maxZ - minZ
    const cz = (minZ + maxZ) / 2
    goal.current = {
      pos: new THREE.Vector3(-0.2, 5.6 + extent * 0.5, cz + 8.4 + extent * 0.66),
      target: new THREE.Vector3(0, 0.4, cz + 0.6),
      until: performance.now() + 1800,
    }
  }, [minZ, maxZ, fx, fz])
  useFrame((_, delta) => {
    const g = goal.current
    if (!g) return
    if (performance.now() > g.until) { goal.current = null; return }
    const k = Math.min(1, delta * 3)
    camera.position.lerp(g.pos, k)
    if (controls) { controls.target.lerp(g.target, k); controls.update() }
  })
  return null
}

function PlanClock({ plan, stepIdx, pace, onAdvance }: { plan: Plan | null; stepIdx: number; pace: number; onAdvance: () => void }) {
  const started = useRef<number | null>(null)
  useEffect(() => { started.current = null }, [plan, stepIdx])
  useFrame(({ clock }) => {
    const step = plan?.steps[stepIdx]
    if (!step) return
    if (started.current === null) started.current = clock.elapsedTime
    if ((clock.elapsedTime - started.current) * pace >= step.dur) {
      started.current = clock.elapsedTime
      onAdvance()
    }
  })
  return null
}

export type Selection = { kind: 'agent' | 'vendor'; id: string } | null

export default function LiveWorld({ state, speed, replayToken, selected, onSelect, onLog }: {
  state: VaultState
  speed: number
  replayToken: number
  selected: Selection
  onSelect: (s: Selection) => void
  onLog: (entries: { id: number; text: string; decision: VaultEvent['decision'] }[], current: VaultEvent | null, say: string, checks: CheckState[] | null) => void
}) {
  const layout = useMemo(() => computeLayout(state.parties, state.agents), [state.parties, state.agents])
  const [display, setDisplay] = useState<Display>(() => ({
    shown: new Set(state.agents.map((a) => a.id)),
    revoked: new Set(state.agents.filter((a) => a.status === 'revoked').map((a) => a.id)),
    locked: new Set(state.parties.filter((p) => p.locked).map((p) => p.name)),
    vendorStatus: Object.fromEntries(state.parties.map((p) => [p.name, p.status])),
  }))
  const mutate = useCallback((fn: (d: Display) => void) => {
    setDisplay((d) => {
      const next = { shown: new Set(d.shown), revoked: new Set(d.revoked), locked: new Set(d.locked), vendorStatus: { ...d.vendorStatus } }
      fn(next)
      return next
    })
  }, [])

  // Queue only events that happen after the world opens (history is already reflected in the scene).
  const lastQueued = useRef(state.events.length ? state.events[state.events.length - 1].id : 0)
  const [queue, setQueue] = useState<VaultEvent[]>([])
  const [log, setLog] = useState<{ id: number; text: string; decision: VaultEvent['decision'] }[]>([])
  useEffect(() => {
    const newest = state.events.length ? state.events[state.events.length - 1].id : 0
    if (newest < lastQueued.current) {
      // The demo was reset: event numbers start over.
      lastQueued.current = 0
      setQueue([])
      setPlan(null)
    }
    const fresh = state.events.filter((e) => e.id > lastQueued.current)
    if (fresh.length) {
      lastQueued.current = fresh[fresh.length - 1].id
      setQueue((q) => [...q, ...fresh])
    }
  }, [state.events])

  // Replay: re-run the most recent actions (agents stay visible).
  useEffect(() => {
    if (!replayToken) return
    setQueue(state.events.slice(-10))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayToken])

  const [plan, setPlan] = useState<Plan | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (plan || !queue.length) return
    const [next, ...rest] = queue
    setQueue(rest)
    const built = buildPlan(next, stateRef.current, computeLayout(stateRef.current.parties, stateRef.current.agents), display, mutate)
    setPlan(built)
    setStepIdx(0)
    built.steps[0]?.apply?.()
    setLog((l) => [{ id: next.id, text: describe(next).headline, decision: next.decision }, ...l].slice(0, 7))
  }, [plan, queue, display, mutate])

  const step = plan?.steps[stepIdx]
  const pace = speed * (queue.length > 6 ? 3 : queue.length > 2 ? 1.8 : 1)

  useEffect(() => {
    onLog(log, plan?.event ?? null, step?.say ?? (plan ? describe(plan.event).headline : 'Waiting for the next action…'), step?.checks ?? null)
  }, [log, plan, step, onLog])

  const advance = useCallback(() => {
    if (!plan) return
    if (stepIdx + 1 < plan.steps.length) {
      plan.steps[stepIdx + 1].apply?.()
      setStepIdx(stepIdx + 1)
    } else {
      setPlan(null)
    }
  }, [plan, stepIdx])

  const focus = new Set(step?.focus ?? [])
  const shieldTone = step?.shieldTone
  const checks: CheckState[] = step?.checks ?? ['wait', 'wait', 'wait', 'wait', 'wait', 'wait']
  const lit = new Set(step?.folders ?? [])
  const parties = state.parties.filter((p) => p.name in display.vendorStatus)
  const zoneZs = parties.map((p) => layout.vendors[p.name]?.z ?? 0)
  const visibleMinZ = Math.min(...zoneZs, 0) - ZONE_DEPTH / 2
  const visibleMaxZ = Math.max(...zoneZs, 0) + ZONE_DEPTH / 2
  const focusAt: Vec | null = selected?.kind === 'agent' ? layout.agents[selected.id] ?? null
    : selected?.kind === 'vendor' && layout.vendors[selected.id] ? [-7, 0, layout.vendors[selected.id].z] : null

  return (
    <div className="j3d-canvas is-stage">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [-0.6, 8.2, 11.8], fov: 44 }} gl={{ antialias: true }} onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={['#0d1529']} />
        <fog attach="fog" args={['#0d1529', 22, 42]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 12, 8]} intensity={1.1} castShadow />
        <pointLight position={[SHIELD[0], 4, 2]} intensity={20} color={shieldTone === 'bad' ? C.bad : C.accent} distance={13} />
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.2} position={[0, 6, -10]} scale={[18, 3, 1]} color="#9aafff" />
          <Lightformer form="rect" intensity={1.2} position={[-10, 3, 4]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color="#f4d28b" />
          <Lightformer form="ring" intensity={1.5} position={[9, 4, 6]} scale={3} color="#ffffff" />
        </Environment>
        <PlanClock plan={plan} stepIdx={stepIdx} pace={pace} onAdvance={advance} />
        <CameraRig minZ={visibleMinZ} maxZ={visibleMaxZ} focusAt={focusAt} />

        {parties.map((p) => (
          <Zone key={p.name} party={p} z={layout.vendors[p.name]?.z ?? 0} status={display.vendorStatus[p.name]} locked={display.locked.has(p.name)} focus={focus.has(`zone:${p.name}`)} />
        ))}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(WALL_X + 10.8) / 2, 0, (layout.minZ + layout.maxZ) / 2]} receiveShadow>
          <planeGeometry args={[10.8 - WALL_X, layout.maxZ - layout.minZ + 1]} />
          <meshStandardMaterial color="#13234d" metalness={0.2} roughness={0.85} />
        </mesh>
        <gridHelper args={[24, 48, '#3b4a78', '#26314f']} position={[0.3, 0.01, 0]} />
        <Wall minZ={layout.minZ} maxZ={layout.maxZ} bad={shieldTone === 'bad' && !!step?.attacker} />

        {parties.filter((p) => display.vendorStatus[p.name] !== 'invited').map((p) => {
          const v = layout.vendors[p.name]
          if (!v) return null
          const dim = display.vendorStatus[p.name] === 'offboarded'
          return (
            <group key={`login-${p.name}`}>
              <Animated pos={v.login} focus={focus.has(`login:${p.name}`)} tint={display.locked.has(p.name) ? C.bad : C.accent} dim={dim} scale={1.05} spin={0.5} selected={selected?.kind === 'vendor' && selected.id === p.name} onClick={() => onSelect({ kind: 'vendor', id: p.name })}>
                {(m) => <LoginModel m={m} />}
              </Animated>
              <Label pos={v.login} title={`${p.name} login`} tone={dim ? 'dim' : focus.has(`login:${p.name}`) ? 'focus' : undefined} />
            </group>
          )
        })}

        {state.agents.filter((a) => display.shown.has(a.id) && layout.agents[a.id]).map((a) => {
          const pos = layout.agents[a.id]
          const parentPos = a.parent ? layout.agents[a.parent] : undefined
          const dead = display.revoked.has(a.id)
          const locked = display.locked.has(a.party)
          return (
            <group key={a.id}>
              {parentPos && display.shown.has(a.parent!) && (
                <QuadraticBezierLine start={up(parentPos, 0.3)} end={up(pos, 0.3)} mid={[(parentPos[0] + pos[0]) / 2, 0.6, (parentPos[2] + pos[2]) / 2]} color={dead ? '#3a3f55' : '#6575b0'} lineWidth={1.2} dashed dashSize={0.15} gapSize={0.12} />
              )}
              <Animated pos={pos} focus={focus.has(`agent:${a.id}`)} tint={dead || locked ? C.bad : C.accent} dim={dead} scale={a.parent ? 0.72 : 0.9} spin={0.35} selected={selected?.kind === 'agent' && selected.id === a.id} onClick={() => onSelect({ kind: 'agent', id: a.id })}>
                {(m) => <AgentModel m={m} />}
              </Animated>
              <Label pos={pos} title={a.name} sub={dead ? 'stopped' : undefined} tone={dead ? 'dim' : locked ? 'bad' : focus.has(`agent:${a.id}`) || (selected?.kind === 'agent' && selected.id === a.id) ? 'focus' : undefined} small />
            </group>
          )
        })}

        {step?.attacker && (
          <group>
            <Animated pos={layout.attacker(plan!.event.party)} focus tint={C.bad} scale={0.8}>
              {(m) => <AgentModel m={m} />}
            </Animated>
            <Label pos={layout.attacker(plan!.event.party)} title="Attacker" tone="bad" small />
          </group>
        )}

        <Animated pos={SHIELD} focus={focus.has('shield')} tint={shieldTone === 'bad' ? C.bad : shieldTone === 'warn' ? C.warn : C.accent} scale={1.3} spin={0.45}>
          {(m) => <ShieldModel m={m} />}
        </Animated>
        <Label pos={SHIELD} title="VendorVault" tone={shieldTone === 'bad' ? 'bad' : focus.has('shield') ? 'focus' : undefined} />
        <CheckRing states={checks} />
        <Sparkles count={36} scale={[3.4, 2.4, 3.4]} position={[SHIELD[0], 1.6, 0]} size={2.2} speed={0.35} color={shieldTone === 'bad' ? C.bad : C.accent} />

        <Animated pos={SAFE} focus={focus.has('safe')} tint={C.accent} scale={1.25} spin={0.3}>
          {(m) => <VaultModel m={m} />}
        </Animated>
        <Label pos={SAFE} title="Vault agent" tone={focus.has('safe') ? 'focus' : undefined} />
        <group position={[SAFE[0] - 0.4, 3.2, 0]}>
          {state.folders.map((f, i) => {
            const perRow = Math.ceil(state.folders.length / 2)
            const x = ((i % perRow) - (perRow - 1) / 2) * 1.25
            const y = Math.floor(i / perRow) * -0.62
            const on = lit.has(f.name)
            const color = on ? C.ok : C.accent
            return (
              <group key={f.name} position={[x, y, 0]}>
                <FolderModel color={color} intensity={on ? 3 : 0.3} opacity={on ? 1 : 0.6} />
                <Html position={[0, -0.32, 0]} center distanceFactor={15} zIndexRange={[5, 0]}>
                  <span className={`j3d-folder ${on ? 'is-lit' : ''}`}>{f.name}</span>
                </Html>
              </group>
            )
          })}
        </group>
        <Sparkles count={20} scale={[2.6, 2.2, 2.6]} position={[SAFE[0], 1.8, 0]} size={1.8} speed={0.25} color={C.ok} />

        {step?.orb && <OrbFlight key={`${plan?.event.id}-${stepIdx}`} orb={step.orb} dur={step.dur / pace} onKey={`${plan?.event.id}-${stepIdx}`} />}

        <ContactShadows position={[0, 0.02, 0]} opacity={0.5} scale={30} blur={2.4} far={4} resolution={512} color="#000000" />
        <OrbitControls makeDefault target={[-0.4, 0.6, 0]} enablePan={false} minDistance={7} maxDistance={28} minPolarAngle={0.45} maxPolarAngle={1.3} />
        <EffectComposer>
          <Bloom intensity={0.7} luminanceThreshold={0.6} luminanceSmoothing={0.3} mipmapBlur />
        </EffectComposer>
      </Canvas>
      <span className="j3d-hint">Click to inspect · drag to rotate</span>
    </div>
  )
}
