import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import { palette } from "@/lib/palette.ts";
import {
  type DitchSpec,
  type GateSpec,
  type PlotSpec,
  type SensorStakeSpec,
  SOURCE,
  TERRAIN,
  TIER_TOP,
  type TierId,
  type TreeSpec,
} from "./paddy-layout.ts";

const SOIL_TOP: Record<TierId, string> = {
  head: "#a89b83",
  middle: "#9e9179",
  tail: "#94886f",
};
const SOIL_SIDE = "#877c66";
const SOIL_WET = "#6d6a56";
const BUND = "#75694f";
const RICE_DEEP = "#5f8c5c";
const RICE_LIGHT = "#93b986";
const TRUNK = "#6b5b45";
const CANOPY = "#4e7a5d";
const CANOPY_ALT = "#5b8666";
const GATE_METAL = "#57616b";
const STAKE_POLE = "#4c5560";
const STAKE_HEAD = "#37424c";

const RICE_ROWS = 4;
const RICE_PER_ROW = 10;
const RICE_BASE_Y = 0.14;
const WATER_MARGIN = 0.34;

const FLOW_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLOW_FRAGMENT = `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec2 vUv;
void main() {
  float band = sin(vUv.y * 22.0 - uTime * 2.4);
  float shimmer = smoothstep(0.55, 1.0, band) * 0.4;
  vec3 color = mix(uDeep, uShallow, 0.38 + shimmer);
  gl_FragColor = vec4(color, 0.94);
}
`;

const STILL_FRAGMENT = `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec2 vUv;
void main() {
  float ripple = sin(vUv.x * 9.0 + uTime * 0.5) * sin(vUv.y * 11.0 - uTime * 0.35);
  vec3 color = mix(uDeep, uShallow, 0.42 + ripple * 0.08);
  gl_FragColor = vec4(color, 0.93);
}
`;

export interface WaterMaterialHandle {
  readonly material: THREE.ShaderMaterial;
  readonly time: { value: number };
}

export function createWaterMaterial(kind: "flow" | "still"): WaterMaterialHandle {
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: time,
      uDeep: { value: new THREE.Color(palette.water) },
      uShallow: { value: new THREE.Color("#57b6bc") },
    },
    vertexShader: FLOW_VERTEX,
    fragmentShader: kind === "flow" ? FLOW_FRAGMENT : STILL_FRAGMENT,
  });
  return { material, time };
}

export const PaddyMotionContext = createContext(false);

export function usePaddyReducedMotion(): boolean {
  return useContext(PaddyMotionContext);
}

interface WaterSurfaceProps {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly handle: WaterMaterialHandle;
}

export function WaterSurface({ x, y, z, width, depth, handle }: WaterSurfaceProps) {
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} material={handle.material}>
      <planeGeometry args={[width, depth]} />
    </mesh>
  );
}

export function useWaterMaterials(): {
  readonly flow: WaterMaterialHandle;
  readonly still: WaterMaterialHandle;
} {
  const flow = useMemo(() => createWaterMaterial("flow"), []);
  const still = useMemo(() => createWaterMaterial("still"), []);
  useEffect(
    () => () => {
      flow.material.dispose();
      still.material.dispose();
    },
    [flow, still],
  );
  return { flow, still };
}

interface TerraceProps {
  readonly tier: TierId;
  readonly z: number;
  readonly active: boolean;
}

export function Terrace({ tier, z, active }: TerraceProps) {
  const top = TIER_TOP[tier];
  const color = SOIL_TOP[tier];
  const edge = useMemo(
    () =>
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(TERRAIN.slabWidth, top, TERRAIN.slabDepth),
      ),
    [top],
  );
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, top / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[TERRAIN.slabWidth, top, TERRAIN.slabDepth]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {active && (
        <lineSegments geometry={edge} position={[0, top / 2, 0]}>
          <lineBasicMaterial color={palette.water} />
        </lineSegments>
      )}
    </group>
  );
}

export function GroundBase() {
  return (
    <mesh position={[0, -TERRAIN.baseHeight / 2, -0.8]} receiveShadow>
      <boxGeometry args={[TERRAIN.baseWidth, TERRAIN.baseHeight, TERRAIN.baseDepth]} />
      <meshLambertMaterial color={SOIL_SIDE} />
    </mesh>
  );
}

interface TuftTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotation: number;
  readonly scale: number;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildTuftTransforms(spec: PlotSpec): TuftTransform[] {
  const halfW = (spec.width - WATER_MARGIN - 0.36) / 2;
  const halfD = (spec.depth - WATER_MARGIN - 0.36) / 2;
  let state = hashSeed(spec.id);
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const transforms: TuftTransform[] = [];
  for (let row = 0; row < RICE_ROWS; row += 1) {
    const z = -halfD + (row / (RICE_ROWS - 1)) * halfD * 2;
    for (let column = 0; column < RICE_PER_ROW; column += 1) {
      const x = -halfW + (column / (RICE_PER_ROW - 1)) * halfW * 2;
      transforms.push({
        x: x + (next() - 0.5) * 0.14,
        y: RICE_BASE_Y,
        z: z + (next() - 0.5) * 0.14,
        rotation: next() * Math.PI,
        scale: 0.8 + next() * 0.3 + spec.stage * 0.3,
      });
    }
  }
  return transforms;
}

function RiceRows({ spec }: { readonly spec: PlotSpec }) {
  const geometry = useMemo(() => new THREE.ConeGeometry(0.055, 0.17, 5), []);
  const material = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(RICE_DEEP).lerp(new THREE.Color(RICE_LIGHT), spec.stage),
        flatShading: true,
      }),
    [spec.stage],
  );
  const transforms = useMemo(() => buildTuftTransforms(spec), [spec]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();
    transforms.forEach((transform, index) => {
      position.set(transform.x, transform.y, transform.z);
      euler.set(0, transform.rotation, 0);
      quaternion.setFromEuler(euler);
      scale.setScalar(transform.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms]);
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, transforms.length]}
      castShadow
    />
  );
}

const BUND_HEIGHT = 0.14;
const BUND_THICKNESS = 0.12;

export function Plot({
  spec,
  active,
}: {
  readonly spec: PlotSpec;
  readonly active: boolean;
}) {
  const edge = useMemo(
    () =>
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(spec.width - WATER_MARGIN, 0.02, spec.depth - WATER_MARGIN),
      ),
    [spec.width, spec.depth],
  );
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  return (
    <group position={[spec.x, spec.y, spec.z]}>
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[spec.width - 0.16, 0.05, spec.depth - 0.16]} />
        <meshLambertMaterial color={SOIL_WET} />
      </mesh>
      <mesh position={[0, BUND_HEIGHT / 2, -(halfD + BUND_THICKNESS / 2)]} castShadow>
        <boxGeometry args={[spec.width + 0.24, BUND_HEIGHT, BUND_THICKNESS]} />
        <meshLambertMaterial color={BUND} />
      </mesh>
      <mesh position={[0, BUND_HEIGHT / 2, halfD + BUND_THICKNESS / 2]} castShadow>
        <boxGeometry args={[spec.width + 0.24, BUND_HEIGHT, BUND_THICKNESS]} />
        <meshLambertMaterial color={BUND} />
      </mesh>
      <mesh position={[-(halfW + BUND_THICKNESS / 2), BUND_HEIGHT / 2, 0]} castShadow>
        <boxGeometry args={[BUND_THICKNESS, BUND_HEIGHT, spec.depth + 0.24]} />
        <meshLambertMaterial color={BUND} />
      </mesh>
      <mesh position={[halfW + BUND_THICKNESS / 2, BUND_HEIGHT / 2, 0]} castShadow>
        <boxGeometry args={[BUND_THICKNESS, BUND_HEIGHT, spec.depth + 0.24]} />
        <meshLambertMaterial color={BUND} />
      </mesh>
      <RiceRows spec={spec} />
      {active && (
        <lineSegments geometry={edge} position={[0, 0.09, 0]}>
          <lineBasicMaterial color={palette.water} />
        </lineSegments>
      )}
    </group>
  );
}

export function PlotWater({
  spec,
  handle,
}: {
  readonly spec: PlotSpec;
  readonly handle: WaterMaterialHandle;
}) {
  return (
    <WaterSurface
      x={spec.x}
      y={spec.y + 0.06}
      z={spec.z}
      width={spec.width - WATER_MARGIN}
      depth={spec.depth - WATER_MARGIN}
      handle={handle}
    />
  );
}

export function Ditch({
  spec,
  active,
}: {
  readonly spec: DitchSpec;
  readonly active: boolean;
}) {
  const edge = useMemo(
    () =>
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          spec.alongZ ? spec.width : spec.length,
          0.02,
          spec.alongZ ? spec.length : spec.width,
        ),
      ),
    [spec],
  );
  return (
    <group position={[spec.x, spec.y, spec.z]}>
      <mesh position={[0, 0.02, 0]} receiveShadow>
        {spec.alongZ ? (
          <boxGeometry args={[spec.width, 0.06, spec.length]} />
        ) : (
          <boxGeometry args={[spec.length, 0.06, spec.width]} />
        )}
        <meshLambertMaterial color={SOIL_WET} />
      </mesh>
      {active && (
        <lineSegments geometry={edge} position={[0, 0.075, 0]}>
          <lineBasicMaterial color={palette.water} />
        </lineSegments>
      )}
    </group>
  );
}

export function DitchWater({
  spec,
  handle,
}: {
  readonly spec: DitchSpec;
  readonly handle: WaterMaterialHandle;
}) {
  return (
    <WaterSurface
      x={spec.x}
      y={spec.y + 0.06}
      z={spec.z}
      width={spec.alongZ ? spec.width - 0.08 : spec.length - 0.06}
      depth={spec.alongZ ? spec.length - 0.06 : spec.width - 0.08}
      handle={handle}
    />
  );
}

export function Gate({ spec }: { readonly spec: GateSpec }) {
  return (
    <group position={[spec.x, spec.y, spec.z]}>
      <mesh position={[-0.45, 0.26, 0]} castShadow>
        <boxGeometry args={[0.12, 0.52, 0.16]} />
        <meshLambertMaterial color={GATE_METAL} />
      </mesh>
      <mesh position={[0.45, 0.26, 0]} castShadow>
        <boxGeometry args={[0.12, 0.52, 0.16]} />
        <meshLambertMaterial color={GATE_METAL} />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.82, 0.34, 0.06]} />
        <meshLambertMaterial color="#6a747e" />
      </mesh>
      <mesh position={[0.45, 0.58, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <torusGeometry args={[0.11, 0.025, 6, 16]} />
        <meshLambertMaterial color={GATE_METAL} />
      </mesh>
    </group>
  );
}

export function SourcePond({ handle }: { readonly handle: WaterMaterialHandle }) {
  return (
    <group>
      <mesh
        position={[SOURCE.x, TERRAIN.platformTop / 2, SOURCE.z]}
        castShadow
        receiveShadow
      >
        <boxGeometry
          args={[TERRAIN.platformWidth, TERRAIN.platformTop, TERRAIN.platformDepth]}
        />
        <meshLambertMaterial color={SOIL_TOP.head} />
      </mesh>
      <mesh position={[SOURCE.x, TERRAIN.platformTop + 0.12, SOURCE.z]} castShadow>
        <cylinderGeometry args={[1, 1.06, 0.24, 24]} />
        <meshLambertMaterial color={BUND} />
      </mesh>
      <WaterSurface
        x={SOURCE.x}
        y={TERRAIN.platformTop + 0.16}
        z={SOURCE.z}
        width={1.7}
        depth={1.7}
        handle={handle}
      />
      <mesh position={[0.95, TERRAIN.platformTop + 0.22, SOURCE.z]} castShadow>
        <boxGeometry args={[0.24, 0.44, 0.24]} />
        <meshLambertMaterial color={GATE_METAL} />
      </mesh>
    </group>
  );
}

export function Tree({ spec }: { readonly spec: TreeSpec }) {
  return (
    <group position={[spec.x, 0, spec.z]} scale={spec.scale}>
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.64, 6]} />
        <meshLambertMaterial color={TRUNK} />
      </mesh>
      <mesh position={[0, 0.82, 0]} castShadow>
        <coneGeometry args={[0.42, 0.62, 7]} />
        <meshLambertMaterial color={CANOPY} flatShading />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <coneGeometry args={[0.3, 0.5, 7]} />
        <meshLambertMaterial color={CANOPY_ALT} flatShading />
      </mesh>
    </group>
  );
}

export function SensorStake({ spec }: { readonly spec: SensorStakeSpec }) {
  return (
    <group position={[spec.x, spec.y, spec.z]}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.7, 6]} />
        <meshLambertMaterial color={STAKE_POLE} />
      </mesh>
      <mesh position={[0, 0.76, 0]} castShadow>
        <boxGeometry args={[0.13, 0.15, 0.13]} />
        <meshLambertMaterial color={STAKE_HEAD} />
      </mesh>
      <mesh position={[0, 0.86, 0]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshLambertMaterial color="#55b5ba" emissive="#55b5ba" emissiveIntensity={0.7} />
      </mesh>
    </group>
  );
}
