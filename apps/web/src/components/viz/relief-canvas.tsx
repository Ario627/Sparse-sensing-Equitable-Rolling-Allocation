import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn.ts";
import {
  clampPitch,
  lookAt,
  orbitEye,
  perspective,
  type Vec3,
} from "@/lib/gl/mat4.ts";
import {
  buildTerrainGeometry,
  type TerrainBlock,
  type TerrainFlowPoint,
} from "@/lib/gl/terrain.ts";
import { hexToRgb01, palette } from "@/lib/palette.ts";

export type { TerrainBlock, TerrainFlowPoint } from "@/lib/gl/terrain.ts";

const PAD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;
uniform mat4 uProjection;
uniform mat4 uView;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

const PAD_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor, 1.0);
}
`;

const FLOW_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aArc;
uniform mat4 uProjection;
uniform mat4 uView;
out float vArc;
void main() {
  vArc = aArc;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

const FLOW_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float vArc;
uniform float uTime;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  float phase = fract(vArc - uTime * 0.16);
  float glow = 1.0 - smoothstep(0.0, 0.09, phase);
  outColor = vec4(uColor, 0.45 + 0.55 * glow);
}
`;

const FOV_Y = 0.72;
const NEAR = 0.1;
const FAR = 20;
const CENTER: Vec3 = [0, 0.16, 0];
const UP: Vec3 = [0, 1, 0];
const RADIUS = 3.7;
const INITIAL_YAW = 0.62;
const INITIAL_PITCH = 0.58;
const DRAG_SENSITIVITY = 0.0055;
const DPR_CAP = 2;
const PULSE_START = 0.45;
const AUTO_ROTATE_SPEED = 0.11;
const AUTO_RESUME_MS = 2_600;

const fallbackText = {
  unavailable:
    "Peramban ini tidak mendukung pratinjau 3D. Data blok tetap tersedia di panel lain.",
  paused:
    "Pratinjau 3D dijeda karena konteks grafis peramban dipulihkan. Muat ulang halaman untuk mengaktifkan kembali.",
} as const;

type FallbackKind = keyof typeof fallbackText;

interface Uniforms {
  readonly projection: WebGLUniformLocation | null;
  readonly view: WebGLUniformLocation | null;
}

interface FlowUniforms extends Uniforms {
  readonly time: WebGLUniformLocation | null;
  readonly color: WebGLUniformLocation | null;
}

interface Scene {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly padProgram: WebGLProgram;
  readonly flowProgram: WebGLProgram;
  readonly padVao: WebGLVertexArrayObject;
  readonly flowVao: WebGLVertexArrayObject;
  readonly padPositionBuffer: WebGLBuffer;
  readonly padColorBuffer: WebGLBuffer;
  readonly flowPositionBuffer: WebGLBuffer;
  readonly flowArcBuffer: WebGLBuffer;
  readonly padUniforms: Uniforms;
  readonly flowUniforms: FlowUniforms;
  readonly flowColor: readonly [number, number, number];
  padVertexCount: number;
  flowVertexCount: number;
  yaw: number;
  pitch: number;
  time: number;
  lastNow: number;
  needsDraw: boolean;
  reduced: boolean;
  autoRotate: boolean;
  dragging: boolean;
  lastInteraction: number;
  raf: number;
}

interface ReliefCanvasProps {
  readonly blocks: readonly TerrainBlock[];
  readonly flow: readonly TerrainFlowPoint[];
  readonly height?: number;
  readonly autoRotate?: boolean;
  readonly interactive?: boolean;
  readonly label: string;
  readonly className?: string;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("shader allocation failed");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown";
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("program allocation failed");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown";
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

function createBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) {
    throw new Error("buffer allocation failed");
  }
  return buffer;
}

function createVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (vao === null) {
    throw new Error("vertex array allocation failed");
  }
  return vao;
}

function uniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): Uniforms {
  return {
    projection: gl.getUniformLocation(program, "uProjection"),
    view: gl.getUniformLocation(program, "uView"),
  };
}

function createScene(canvas: HTMLCanvasElement): Scene | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    depth: true,
  });
  if (gl === null) {
    return null;
  }
  const padProgram = linkProgram(gl, PAD_VERTEX_SHADER, PAD_FRAGMENT_SHADER);
  const flowProgram = linkProgram(gl, FLOW_VERTEX_SHADER, FLOW_FRAGMENT_SHADER);
  const padVao = createVao(gl);
  const flowVao = createVao(gl);
  const padPositionBuffer = createBuffer(gl);
  const padColorBuffer = createBuffer(gl);
  const flowPositionBuffer = createBuffer(gl);
  const flowArcBuffer = createBuffer(gl);
  gl.bindVertexArray(padVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, padPositionBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, padColorBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(flowVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, flowPositionBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, flowArcBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearColor(0, 0, 0, 0);
  return {
    gl,
    canvas,
    padProgram,
    flowProgram,
    padVao,
    flowVao,
    padPositionBuffer,
    padColorBuffer,
    flowPositionBuffer,
    flowArcBuffer,
    padUniforms: uniformLocations(gl, padProgram),
    flowUniforms: {
      ...uniformLocations(gl, flowProgram),
      time: gl.getUniformLocation(flowProgram, "uTime"),
      color: gl.getUniformLocation(flowProgram, "uColor"),
    },
    flowColor: hexToRgb01(palette.water),
    padVertexCount: 0,
    flowVertexCount: 0,
    yaw: INITIAL_YAW,
    pitch: INITIAL_PITCH,
    time: PULSE_START,
    lastNow: 0,
    needsDraw: true,
    reduced: false,
    autoRotate: false,
    dragging: false,
    lastInteraction: 0,
    raf: 0,
  };
}

function uploadGeometry(
  scene: Scene,
  blocks: readonly TerrainBlock[],
  flow: readonly TerrainFlowPoint[],
): void {
  const geometry = buildTerrainGeometry(blocks, flow);
  const { gl } = scene;
  gl.bindBuffer(gl.ARRAY_BUFFER, scene.padPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.padPositions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, scene.padColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.padColors, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, scene.flowPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.flowPositions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, scene.flowArcBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.flowArcs, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  scene.padVertexCount = geometry.padVertexCount;
  scene.flowVertexCount = geometry.flowVertexCount;
}

function syncCanvasSize(scene: Scene): boolean {
  const { canvas, gl } = scene;
  const ratio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) {
    return false;
  }
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
  return true;
}

function drawScene(scene: Scene): void {
  const { gl, canvas } = scene;
  syncCanvasSize(scene);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const projection = perspective(
    FOV_Y,
    canvas.width / Math.max(1, canvas.height),
    NEAR,
    FAR,
  );
  const eye = orbitEye(CENTER, RADIUS, scene.yaw, scene.pitch);
  const view = lookAt(eye, CENTER, UP);
  gl.disable(gl.BLEND);
  gl.useProgram(scene.padProgram);
  gl.uniformMatrix4fv(scene.padUniforms.projection, false, projection);
  gl.uniformMatrix4fv(scene.padUniforms.view, false, view);
  gl.bindVertexArray(scene.padVao);
  gl.drawArrays(gl.LINES, 0, scene.padVertexCount);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.useProgram(scene.flowProgram);
  gl.uniformMatrix4fv(scene.flowUniforms.projection, false, projection);
  gl.uniformMatrix4fv(scene.flowUniforms.view, false, view);
  gl.uniform1f(scene.flowUniforms.time, scene.time);
  gl.uniform3f(
    scene.flowUniforms.color,
    scene.flowColor[0],
    scene.flowColor[1],
    scene.flowColor[2],
  );
  gl.bindVertexArray(scene.flowVao);
  gl.drawArrays(gl.LINE_STRIP, 0, scene.flowVertexCount);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

function stopLoop(scene: Scene): void {
  if (scene.raf !== 0) {
    cancelAnimationFrame(scene.raf);
    scene.raf = 0;
  }
}

function startLoop(scene: Scene): void {
  const frame = (now: number): void => {
    const delta =
      scene.lastNow === 0 ? 0 : Math.min(0.05, (now - scene.lastNow) / 1000);
    scene.lastNow = now;
    if (!scene.reduced) {
      scene.time += delta;
      if (
        scene.autoRotate &&
        !scene.dragging &&
        now - scene.lastInteraction > AUTO_RESUME_MS
      ) {
        scene.yaw += delta * AUTO_ROTATE_SPEED;
      }
      scene.needsDraw = true;
    }
    if (scene.needsDraw) {
      drawScene(scene);
      scene.needsDraw = false;
    }
    scene.raf = requestAnimationFrame(frame);
  };
  scene.raf = requestAnimationFrame(frame);
}

function disposeScene(scene: Scene): void {
  const { gl } = scene;
  gl.deleteProgram(scene.padProgram);
  gl.deleteProgram(scene.flowProgram);
  gl.deleteBuffer(scene.padPositionBuffer);
  gl.deleteBuffer(scene.padColorBuffer);
  gl.deleteBuffer(scene.flowPositionBuffer);
  gl.deleteBuffer(scene.flowArcBuffer);
  gl.deleteVertexArray(scene.padVao);
  gl.deleteVertexArray(scene.flowVao);
}

export function ReliefCanvas({
  blocks,
  flow,
  height = 260,
  autoRotate = false,
  interactive = true,
  label,
  className,
}: ReliefCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const [fallback, setFallback] = useState<FallbackKind | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    let scene: Scene | null = null;
    try {
      scene = createScene(canvas);
    } catch (error) {
      console.error(error);
    }
    if (scene === null) {
      setFallback("unavailable");
      return;
    }
    const active = scene;
    sceneRef.current = active;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    active.reduced = media.matches;
    const onMotionChange = (): void => {
      active.reduced = media.matches;
      active.needsDraw = true;
    };
    media.addEventListener("change", onMotionChange);
    const observer = new ResizeObserver(() => {
      active.needsDraw = true;
    });
    observer.observe(canvas);
    const onContextLost = (event: Event): void => {
      event.preventDefault();
      stopLoop(active);
      setFallback("paused");
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    startLoop(active);
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      observer.disconnect();
      media.removeEventListener("change", onMotionChange);
      stopLoop(active);
      disposeScene(active);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) {
      return;
    }
    uploadGeometry(scene, blocks, flow);
    scene.needsDraw = true;
  }, [blocks, flow]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) {
      return;
    }
    scene.autoRotate = autoRotate;
  }, [autoRotate]);

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const scene = sceneRef.current;
    if (scene === null || fallback !== null || !interactive) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    scene.dragging = true;
    scene.lastInteraction = performance.now();
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const scene = sceneRef.current;
    const drag = dragRef.current;
    if (scene === null || drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    scene.yaw -= (event.clientX - drag.x) * DRAG_SENSITIVITY;
    scene.pitch = clampPitch(
      scene.pitch - (event.clientY - drag.y) * DRAG_SENSITIVITY,
    );
    drag.x = event.clientX;
    drag.y = event.clientY;
    scene.needsDraw = true;
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    const scene = sceneRef.current;
    if (scene !== null) {
      scene.dragging = false;
      scene.lastInteraction = performance.now();
    }
  }

  return (
    <div
      role="img"
      aria-label={label}
      style={{ height }}
      className={cn(
        "relative overflow-hidden rounded-md border border-line bg-surface",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          "block h-full w-full",
          interactive
            ? "cursor-grab touch-none active:cursor-grabbing"
            : "pointer-events-none",
        )}
      />
      {fallback !== null && (
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-ink-3">
          {fallbackText[fallback]}
        </p>
      )}
    </div>
  );
}