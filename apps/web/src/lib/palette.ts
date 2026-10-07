export const palette = {
  ink: "#161a17",
  ink2: "#434a44",
  ink3: "#5a625b",
  line: "#dfe4d9",
  line2: "#c5ccbe",
  paper: "#f4f6f1",
  surface: "#fbfcf8",
  water: "#0f5e66",
  paddy: "#3d692e",
  ok: "#24663b",
  warn: "#8a5a0b",
  crit: "#a62d23",
  fallback: "#9e4a15",
  info: "#1e5ca3",
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
