export const palette = {
  ink: "#142d38",
  ink2: "#3f5863",
  ink3: "#566f7a",
  line: "#d8e3e9",
  line2: "#b7cbd5",
  paper: "#f2f6f8",
  surface: "#ffffff",
  water: "#007b83",
  paddy: "#286f55",
  ok: "#17644c",
  warn: "#8a4d12",
  crit: "#a12d38",
  fallback: "#9a571e",
  info: "#285f9c",
} as const;

export type PaletteKey = keyof typeof palette;

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const HEX_RADIX = 16;
const BYTE_MAX = 255;

export function hexToRgb01(hex: string): readonly [number, number, number] {
  if (!HEX_PATTERN.test(hex)) {
    throw new RangeError(`invalid hex color: ${hex}`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), HEX_RADIX) / BYTE_MAX,
    Number.parseInt(hex.slice(3, 5), HEX_RADIX) / BYTE_MAX,
    Number.parseInt(hex.slice(5, 7), HEX_RADIX) / BYTE_MAX,
  ];
}

export function mixRgb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number,
): readonly [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb01(hex);
  return `rgba(${Math.round(r * BYTE_MAX)}, ${Math.round(g * BYTE_MAX)}, ${Math.round(b * BYTE_MAX)}, ${alpha})`;
}
