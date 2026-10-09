import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { cn } from "@/lib/cn.ts";
import {
  DITCHES,
  GATES,
  PLOTS,
  SENSOR_STAKES,
  TIER_CENTER,
  TIER_ORDER,
  type TierId,
  TREES,
  VIEWPOINTS,
  type ViewpointId,
} from "./paddy-layout.ts";
import {
  Ditch,
  DitchWater,
  Gate,
  GroundBase,
  PaddyMotionContext,
  Plot,
  PlotWater,
  SensorStake,
  SourcePond,
  Terrace,
  Tree,
  usePaddyReducedMotion,
  useWaterMaterials,
} from "./paddy-parts.tsx";

const OVERVIEW = VIEWPOINTS.overview;

interface CameraRigProps {
  readonly viewpoint: ViewpointId;
  readonly reduced: boolean;
}

function CameraRig({ viewpoint, reduced }: CameraRigProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const lookTarget = useRef(new THREE.Vector3(...VIEWPOINTS.overview.target));
  const desired = useMemo(() => new THREE.Vector3(), []);
  const desiredTarget = useMemo(() => new THREE.Vector3(), []);
  const firstRun = useRef(true);

  useLayoutEffect(() => {
    const shouldSnap =
      firstRun.current || reduced || document.visibilityState === "hidden";
    firstRun.current = false;
    if (!shouldSnap) {
      return;
    }
    const spec = VIEWPOINTS[viewpoint];
    camera.position.set(spec.position[0], spec.position[1], spec.position[2]);
    lookTarget.current.set(spec.target[0], spec.target[1], spec.target[2]);
    camera.lookAt(lookTarget.current);
    camera.updateMatrixWorld(true);
    gl.render(scene, camera);
  }, [camera, gl, scene, viewpoint, reduced]);

  useFrame((state, delta) => {
    const spec = VIEWPOINTS[viewpoint];
    desired.set(spec.position[0], spec.position[1], spec.position[2]);
    desiredTarget.set(spec.target[0], spec.target[1], spec.target[2]);
    if (!reduced) {
      const time = state.clock.elapsedTime;
      desired.x += Math.sin(time * 0.11) * 0.32;
      desired.y += Math.sin(time * 0.07 + 1.3) * 0.12;
    }
    const blend = reduced ? 1 : 1 - Math.exp(-2.6 * delta);
    camera.position.lerp(desired, blend);
    lookTarget.current.lerp(desiredTarget, blend);
    camera.lookAt(lookTarget.current);
  });
  return null;
}

function SceneSizing() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const setSize = useThree((state) => state.setSize);
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (parent === null) {
      return;
    }
    const apply = (): void => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width > 0 && height > 0) {
        gl.setSize(width, height, true);
        setSize(width, height);
        gl.render(scene, camera);
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(parent);
    return () => {
      observer.disconnect();
    };
  }, [gl, camera, scene, setSize]);
  return null;
}

function useSceneSizeKick(hostRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const kick = (): void => {
      window.dispatchEvent(new Event("resize"));
    };
    kick();
    const frame = requestAnimationFrame(kick);
    const timer = window.setTimeout(kick, 250);
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        kick();
      }
    };
    const host = hostRef.current;
    const observer = host === null ? null : new ResizeObserver(kick);
    observer?.observe(host as HTMLDivElement);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, [hostRef]);
}

function Lights() {
  return (
    <>
      <hemisphereLight args={["#eaf4f5", "#c7bda9", 1.15]} />
      <directionalLight
        position={[6.5, 9, 4.5]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-normalBias={0.03}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={10}
        shadow-camera-bottom={-8}
        shadow-camera-far={32}
      />
      <directionalLight position={[-7, 5, -6]} intensity={0.45} color="#cfe6ea" />
    </>
  );
}

interface DioramaProps {
  readonly activeViewpoint: ViewpointId;
  readonly onSelect: (id: ViewpointId) => void;
}

function Diorama({ activeViewpoint, onSelect }: DioramaProps) {
  const gl = useThree((state) => state.gl);
  const materials = useWaterMaterials();
  const reduced = usePaddyReducedMotion();

  useFrame((state) => {
    if (reduced) {
      return;
    }
    materials.flow.time.value = state.clock.elapsedTime;
    materials.still.time.value = state.clock.elapsedTime;
  });

  useEffect(
    () => () => {
      gl.domElement.style.cursor = "auto";
    },
    [gl],
  );

  const hoverHandlers = {
    onPointerOver: () => {
      gl.domElement.style.cursor = "pointer";
    },
    onPointerOut: () => {
      gl.domElement.style.cursor = "auto";
    },
  };

  const select = (id: ViewpointId) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(id);
  };

  const activeFor = (tier: TierId): boolean => activeViewpoint === tier;

  return (
    <group>
      <GroundBase />
      {TIER_ORDER.map((tier) => (
        <group key={tier} onClick={select(tier)} {...hoverHandlers}>
          <Terrace tier={tier} z={TIER_CENTER[tier]} active={activeFor(tier)} />
          {PLOTS.filter((plot) => plot.tier === tier).map((plot) => (
            <Plot key={plot.id} spec={plot} active={activeFor(tier)} />
          ))}
          {DITCHES.filter((ditch) => ditch.tier === tier).map((ditch) => (
            <Ditch key={ditch.id} spec={ditch} active={activeFor(tier)} />
          ))}
          {GATES.filter((gate) => gate.tier === tier).map((gate) => (
            <Gate key={gate.id} spec={gate} />
          ))}
        </group>
      ))}
      <group>
        {PLOTS.map((plot) => (
          <PlotWater key={plot.id} spec={plot} handle={materials.still} />
        ))}
        {DITCHES.map((ditch) => (
          <DitchWater key={ditch.id} spec={ditch} handle={materials.flow} />
        ))}
      </group>
      <group onClick={select("source")} {...hoverHandlers}>
        <SourcePond handle={materials.still} />
      </group>
      {SENSOR_STAKES.map((stake) => (
        <SensorStake key={stake.id} spec={stake} />
      ))}
      {TREES.map((tree) => (
        <Tree key={tree.id} spec={tree} />
      ))}
    </group>
  );
}

export interface PaddySceneProps {
  readonly viewpoint: ViewpointId;
  readonly onViewpointChange: (id: ViewpointId) => void;
  readonly reducedMotion?: boolean;
  readonly className?: string;
}

export function PaddyScene({
  viewpoint,
  onViewpointChange,
  reducedMotion = false,
  className,
}: PaddySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  useSceneSizeKick(hostRef);
  return (
    <div ref={hostRef} className={cn("h-full w-full", className)}>
      <Canvas
        className="h-full w-full"
        shadows="percentage"
        flat
        dpr={[1, 1.7]}
        camera={{ fov: 34, near: 0.1, far: 80, position: [...OVERVIEW.position] }}
        gl={{ alpha: true, antialias: true }}
        style={{ touchAction: "pan-y" }}
      >
        <PaddyMotionContext.Provider value={reducedMotion}>
          <SceneSizing />
          <Lights />
          <CameraRig viewpoint={viewpoint} reduced={reducedMotion} />
          <Diorama activeViewpoint={viewpoint} onSelect={onViewpointChange} />
        </PaddyMotionContext.Provider>
      </Canvas>
    </div>
  );
}
