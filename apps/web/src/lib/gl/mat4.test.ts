import { describe, expect, it } from "vitest";
import { clampPitch, lookAt, orbitEye, perspective } from "./mat4.ts";

function column(
  matrix: Float32Array,
  index: number,
): readonly [number, number, number] {
  return [
    matrix[index * 4] ?? 0,
    matrix[index * 4 + 1] ?? 0,
    matrix[index * 4 + 2] ?? 0,
  ];
}

function dot(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: readonly [number, number, number]): number {
  return Math.hypot(a[0], a[1], a[2]);
}

describe("clampPitch", () => {
  it("menjepit sudut ke rentang yang menjaga lookAt tidak terdegenerasi", () => {
    expect(clampPitch(0)).toBe(0.15);
    expect(clampPitch(2)).toBe(1.35);
    expect(clampPitch(0.65)).toBe(0.65);
  });
});

describe("orbitEye", () => {
  it("menjaga jarak kamera ke pusat sama dengan radius", () => {
    const eye = orbitEye([1, 2, 3], 5, 0.3, 0.8);
    const distance = Math.hypot(eye[0] - 1, eye[1] - 2, eye[2] - 3);
    expect(distance).toBeCloseTo(5, 10);
  });

  it("menjepit pitch minimum sehingga kamera tetap di atas bidang", () => {
    const eye = orbitEye([0, 0, 0], 4, 0, 0);
    expect(eye[0]).toBeCloseTo(0, 10);
    expect(eye[1]).toBeCloseTo(4 * Math.sin(0.15), 10);
    expect(eye[2]).toBeCloseTo(4 * Math.cos(0.15), 10);
    expect(eye[1]).toBeGreaterThan(0);
  });

  it("menolak radius yang tidak positif", () => {
    expect(() => orbitEye([0, 0, 0], 0, 0, 0.5)).toThrow(RangeError);
  });
});

describe("perspective", () => {
  it("menghasilkan matriks proyeksi dengan elemen w = -1", () => {
    const matrix = perspective(Math.PI / 2, 1, 0.1, 20);
    expect(matrix[11]).toBe(-1);
    expect(matrix[0]).toBeCloseTo(1, 10);
    expect(matrix[5]).toBeCloseTo(1, 10);
    expect(matrix[15]).toBe(0);
  });

  it("membagi fokus dengan rasio aspek pada elemen x", () => {
    const matrix = perspective(Math.PI / 2, 2, 0.1, 20);
    expect(matrix[0]).toBeCloseTo(0.5, 10);
    expect(matrix[5]).toBeCloseTo(1, 10);
  });

  it("menolak parameter degenerat", () => {
    expect(() => perspective(Math.PI / 2, 0, 0.1, 20)).toThrow(RangeError);
    expect(() => perspective(Math.PI / 2, 1, 20, 20)).toThrow(RangeError);
  });
});

describe("lookAt", () => {
  it("menghasilkan orientasi identitas untuk kamera di sumbu +z", () => {
    const matrix = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
    expect(column(matrix, 0)).toEqual([1, 0, 0]);
    expect(column(matrix, 1)).toEqual([0, 1, 0]);
    expect(column(matrix, 2)).toEqual([0, 0, 1]);
    expect(matrix[12]).toBeCloseTo(0, 10);
    expect(matrix[13]).toBeCloseTo(0, 10);
    expect(matrix[14]).toBeCloseTo(-5, 10);
  });

  it("menjaga basis kamera ortonormal dalam toleransi float32", () => {
    const matrix = lookAt([3, 4, 5], [0, 0, 0], [0, 1, 0]);
    const x = column(matrix, 0);
    const y = column(matrix, 1);
    const z = column(matrix, 2);
    expect(length(x)).toBeCloseTo(1, 6);
    expect(length(y)).toBeCloseTo(1, 6);
    expect(length(z)).toBeCloseTo(1, 6);
    expect(dot(x, y)).toBeCloseTo(0, 6);
    expect(dot(x, z)).toBeCloseTo(0, 6);
    expect(dot(y, z)).toBeCloseTo(0, 6);
  });

  it("menolak mata yang berimpit dengan target", () => {
    expect(() => lookAt([1, 1, 1], [1, 1, 1], [0, 1, 0])).toThrow(RangeError);
  });
});
