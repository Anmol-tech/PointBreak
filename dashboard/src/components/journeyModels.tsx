import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * Procedural models for the 3D journey, built from primitives so nothing is downloaded.
 * Each model gets shared materials: `body` (main surface, its glow animates with focus),
 * `glow` (lights, eyes, emblems) and `metal` (trim).
 */

export interface ModelMaterials {
  body: THREE.Material
  glow: THREE.Material
  metal: THREE.Material
}

export function PersonModel({ m }: { m: ModelMaterials }) {
  return (
    <group position={[0, -0.25, 0]}>
      <mesh material={m.body} position={[0, 0.78, 0]} castShadow>
        <sphereGeometry args={[0.24, 32, 32]} />
      </mesh>
      <mesh material={m.body} position={[0, 0.25, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.32, 10, 24]} />
      </mesh>
      <mesh material={m.metal} position={[0, 0.52, 0]}>
        <cylinderGeometry args={[0.09, 0.11, 0.1, 20]} />
      </mesh>
      {/* employee badge clipped to the chest */}
      <RoundedBox args={[0.18, 0.13, 0.03]} radius={0.02} position={[0.11, 0.33, 0.29]} material={m.glow} />
    </group>
  )
}

function Key({ m }: { m: ModelMaterials }) {
  return (
    <group scale={0.55}>
      <mesh material={m.glow} position={[-0.38, 0, 0]}>
        <torusGeometry args={[0.16, 0.06, 12, 32]} />
      </mesh>
      <mesh material={m.glow} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.045, 0.045, 0.55, 12]} />
      </mesh>
      <mesh material={m.glow} position={[0.17, -0.08, 0]}><boxGeometry args={[0.05, 0.13, 0.05]} /></mesh>
      <mesh material={m.glow} position={[0.26, -0.06, 0]}><boxGeometry args={[0.05, 0.09, 0.05]} /></mesh>
    </group>
  )
}

export function LoginModel({ m }: { m: ModelMaterials }) {
  const orbit = useRef<THREE.Group>(null)
  useFrame((_, delta) => { if (orbit.current) orbit.current.rotation.y += delta * 1.2 })
  return (
    <group>
      <mesh material={m.metal} position={[0, 0.3, 0]} castShadow>
        <torusGeometry args={[0.23, 0.065, 16, 40, Math.PI]} />
      </mesh>
      <mesh material={m.metal} position={[-0.23, 0.18, 0]}><cylinderGeometry args={[0.065, 0.065, 0.24, 16]} /></mesh>
      <mesh material={m.metal} position={[0.23, 0.18, 0]}><cylinderGeometry args={[0.065, 0.065, 0.24, 16]} /></mesh>
      <RoundedBox args={[0.78, 0.6, 0.34]} radius={0.09} smoothness={4} position={[0, -0.2, 0]} material={m.body} castShadow />
      <mesh material={m.glow} position={[0, -0.14, 0.18]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.03, 20]} />
      </mesh>
      <mesh material={m.glow} position={[0, -0.27, 0.18]}><boxGeometry args={[0.05, 0.16, 0.03]} /></mesh>
      <group ref={orbit}>
        <group position={[0.75, 0.05, 0]}><Key m={m} /></group>
      </group>
    </group>
  )
}

export function AgentModel({ m }: { m: ModelMaterials }) {
  const eyes = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    // occasional blink
    if (eyes.current) eyes.current.scale.y = Math.sin(clock.elapsedTime * 1.3) > 0.97 ? 0.15 : 1
  })
  return (
    <group>
      <mesh material={m.glow} position={[0, 0.62, 0]}><sphereGeometry args={[0.07, 16, 16]} /></mesh>
      <mesh material={m.metal} position={[0, 0.47, 0]}><cylinderGeometry args={[0.025, 0.025, 0.22, 10]} /></mesh>
      <RoundedBox args={[0.78, 0.6, 0.6]} radius={0.14} smoothness={5} position={[0, 0.05, 0]} material={m.body} castShadow />
      <RoundedBox args={[0.62, 0.24, 0.05]} radius={0.08} position={[0, 0.08, 0.3]}>
        <meshStandardMaterial color="#0b1022" metalness={0.3} roughness={0.15} />
      </RoundedBox>
      <group ref={eyes} position={[0, 0.08, 0.34]}>
        <mesh material={m.glow} position={[-0.14, 0, 0]}><sphereGeometry args={[0.06, 16, 16]} /></mesh>
        <mesh material={m.glow} position={[0.14, 0, 0]}><sphereGeometry args={[0.06, 16, 16]} /></mesh>
      </group>
      <mesh material={m.metal} position={[-0.42, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.09, 0.09, 0.08, 20]} /></mesh>
      <mesh material={m.metal} position={[0.42, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.09, 0.09, 0.08, 20]} /></mesh>
      <mesh material={m.metal} position={[0, -0.32, 0]}><cylinderGeometry args={[0.13, 0.17, 0.16, 20]} /></mesh>
    </group>
  )
}

export function ShieldModel({ m }: { m: ModelMaterials }) {
  const geometry = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, 0.75)
    s.bezierCurveTo(0.25, 0.62, 0.48, 0.6, 0.62, 0.58)
    s.bezierCurveTo(0.62, 0.05, 0.45, -0.5, 0, -0.78)
    s.bezierCurveTo(-0.45, -0.5, -0.62, 0.05, -0.62, 0.58)
    s.bezierCurveTo(-0.48, 0.6, -0.25, 0.62, 0, 0.75)
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4, curveSegments: 32 })
    g.center()
    return g
  }, [])
  const check = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.24, 0.02, 0), new THREE.Vector3(-0.07, -0.16, 0), new THREE.Vector3(0.27, 0.22, 0)], false, 'catmullrom', 0)
    return new THREE.TubeGeometry(curve, 24, 0.055, 10, false)
  }, [])
  return (
    <group scale={1.05}>
      <mesh geometry={geometry} material={m.body} castShadow />
      <mesh geometry={geometry} material={m.metal} scale={[1.08, 1.06, 0.6]} position={[0, 0, -0.06]} />
      <mesh geometry={check} material={m.glow} position={[0, 0.02, 0.17]} />
    </group>
  )
}

export function VaultModel({ m }: { m: ModelMaterials }) {
  const dial = useRef<THREE.Group>(null)
  useFrame((_, delta) => { if (dial.current) dial.current.rotation.z += delta * 0.8 })
  return (
    <group>
      <RoundedBox args={[1.15, 1.15, 1.0]} radius={0.1} smoothness={4} material={m.body} castShadow />
      <mesh material={m.metal} position={[0, 0, 0.51]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.06, 48]} />
      </mesh>
      <mesh material={m.body} position={[0, 0, 0.55]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.03, 48]} />
      </mesh>
      <group ref={dial} position={[0, 0, 0.58]}>
        <mesh material={m.glow} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.1, 0.1, 0.05, 24]} /></mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} material={m.metal} rotation={[0, 0, (i * Math.PI) / 2]} position={[Math.cos((i * Math.PI) / 2) * 0.17, Math.sin((i * Math.PI) / 2) * 0.17, 0]}>
            <boxGeometry args={[0.2, 0.035, 0.035]} />
          </mesh>
        ))}
      </group>
      <mesh material={m.metal} position={[-0.56, 0.28, 0.35]}><boxGeometry args={[0.06, 0.18, 0.12]} /></mesh>
      <mesh material={m.metal} position={[-0.56, -0.28, 0.35]}><boxGeometry args={[0.06, 0.18, 0.12]} /></mesh>
      {[-0.42, 0.42].map((x) => [-0.42, 0.42].map((y) => (
        <mesh key={`${x}${y}`} material={m.metal} position={[x, y, 0.5]}><sphereGeometry args={[0.035, 12, 12]} /></mesh>
      )))}
    </group>
  )
}

export function FolderModel({ color, intensity, opacity }: { color: string; intensity: number; opacity: number }) {
  return (
    <group>
      <RoundedBox args={[0.54, 0.36, 0.07]} radius={0.025}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} toneMapped={intensity < 1} transparent opacity={opacity} metalness={0.2} roughness={0.4} />
      </RoundedBox>
      <RoundedBox args={[0.2, 0.08, 0.07]} radius={0.02} position={[-0.15, 0.2, 0]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} toneMapped={intensity < 1} transparent opacity={opacity} />
      </RoundedBox>
      <mesh position={[0.02, 0.02, 0.04]}>
        <boxGeometry args={[0.34, 0.03, 0.005]} />
        <meshStandardMaterial color="#e7edff" transparent opacity={0.5 * opacity} />
      </mesh>
      <mesh position={[0.02, -0.06, 0.04]}>
        <boxGeometry args={[0.26, 0.03, 0.005]} />
        <meshStandardMaterial color="#e7edff" transparent opacity={0.5 * opacity} />
      </mesh>
    </group>
  )
}
