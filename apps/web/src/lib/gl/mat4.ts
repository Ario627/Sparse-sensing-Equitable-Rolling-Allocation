export type Vec3 = readonly [number, number, number];
export type Mat4 = Float32Array;

const MIN_PITCH = 0.15;
const MAX_PITCH = 1.35;
const EPSILON = 1e-8;

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < EPSILON) {
    throw new RangeError("cannot normalize a zero-length vector");
  }
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch));
}

export function orbitEye(center: Vec3, radius: number, yaw: number, pitch: number): Vec3 {
  assertPositive(radius, "radius");
  const safePitch = clampPitch(pitch);
  const horizontal = radius * Math.cos(safePitch);
  return [
    center[0] + horizontal * Math.sin(yaw),
    center[1] + radius * Math.sin(safePitch),
    center[2] + horizontal * Math.cos(yaw),
  ];
}

export function perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  assertPositive(fovY, "fovY");
  assertPositive(aspect, "aspect");
  assertPositive(near, "near");
  if (far <= near) {
    throw new RangeError("far must be greater than near");
  }
  const focal = 1 / Math.tan(fovY / 2);
  const range = near - far;
  const out = new Float32Array(16);
  out[0] = focal / aspect;
  out[5] = focal;
  out[10] = (far + near) / range;
  out[11] = -1;
  out[14] = (2 * far * near) / range;
  return out;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}
