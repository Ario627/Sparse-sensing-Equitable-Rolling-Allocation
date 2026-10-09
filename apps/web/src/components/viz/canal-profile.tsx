import { cn } from "@/lib/cn.ts";
import { palette, rgba } from "@/lib/palette.ts";

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 300;
const PAD_X = 24;
const BED_Y = 196;
const MAX_DEPTH = 104;
const DISTRIBUTOR_Y = 214;
const STEM_SPREAD = 46;

const REACHES = [1, 0.86, 0.78, 0.6, 0.52, 0.34, 0.22] as const;
const SERVICE = [0.94, 0.88, 0.72, 0.62, 0.81, 0.55, 0.42] as const;

interface ProfilePalette {
  readonly water: string;
  readonly waterTop: string;
  readonly shortfall: string;
  readonly bed: string;
  readonly stem: string;
  readonly glow: string;
}

const profiles: Record<"deep" | "light", ProfilePalette> = {
  deep: {
    water: rgba(palette.water, 0.92),
    waterTop: rgba(palette.surface, 0.34),
    shortfall: rgba(palette.water, 0.34),
    bed: rgba(palette.surface, 0.4),
    stem: rgba(palette.surface, 0.34),
    glow: rgba(palette.surface, 0.5),
  },
  light: {
    water: rgba(palette.water, 0.9),
    waterTop: rgba(palette.surface, 0.5),
    shortfall: rgba(palette.warn, 0.4),
    bed: rgba(palette.ink, 0.4),
    stem: rgba(palette.ink, 0.22),
    glow: rgba(palette.surface, 0.6),
  },
};

export interface CanalProfileProps {
  readonly variant?: "deep" | "light";
  readonly className?: string;
}

export function CanalProfile({ variant = "deep", className }: CanalProfileProps) {
  const tone = profiles[variant];
  const span = VIEW_WIDTH - PAD_X * 2;
  const step = span / REACHES.length;

  const x0 = (index: number): number => PAD_X + step * index;
  const x1 = (index: number): number => PAD_X + step * (index + 1);
  const designTop = (index: number): number => BED_Y - (REACHES[index] ?? 0) * MAX_DEPTH;
  const waterTop = (index: number): number =>
    BED_Y - (REACHES[index] ?? 0) * (SERVICE[index] ?? 0) * MAX_DEPTH;

  const designEdge = [`M ${PAD_X} ${BED_Y}`];
  REACHES.forEach((_, index) => {
    designEdge.push(
      `L ${x0(index)} ${designTop(index)}`,
      `L ${x1(index)} ${designTop(index)}`,
    );
  });

  const waterEdge = [`M ${PAD_X} ${BED_Y}`];
  REACHES.forEach((_, index) => {
    waterEdge.push(
      `L ${x0(index)} ${waterTop(index)}`,
      `L ${x1(index)} ${waterTop(index)}`,
    );
  });

  const shortfall = [designEdge.join(" ")];
  for (let index = REACHES.length - 1; index >= 0; index -= 1) {
    shortfall.push(
      `L ${x1(index)} ${waterTop(index)}`,
      `L ${x0(index)} ${waterTop(index)}`,
    );
  }
  shortfall.push("Z");

  const flow = REACHES.map((_, index) => {
    const mid = waterTop(index) + (BED_Y - waterTop(index)) * 0.58;
    const start = index === 0 ? `M ${x0(index)} ${mid} ` : "";
    return `${start}L ${x1(index)} ${mid}`;
  }).join(" ");

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      aria-hidden="true"
      preserveAspectRatio="xMidYMax meet"
      className={cn("h-full w-full", className)}
    >
      <defs>
        <linearGradient id="canal-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rgba(palette.water, 0.62)} />
          <stop offset="100%" stopColor={tone.water} />
        </linearGradient>
      </defs>
      <path d={shortfall.join(" ")} fill={tone.shortfall} opacity={0.28} />
      <path
        d={`${waterEdge.join(" ")} L ${x1(REACHES.length - 1)} ${BED_Y} Z`}
        fill="url(#canal-water)"
      />
      <path d={waterEdge.join(" ")} fill="none" stroke={tone.waterTop} strokeWidth={3} />
      <path
        d={flow}
        fill="none"
        stroke={tone.glow}
        strokeWidth={1.5}
        strokeDasharray="6 12"
        className="motion-safe:animate-flow"
      />
      <path
        d={designEdge.join(" ")}
        fill="none"
        stroke={tone.bed}
        strokeWidth={1}
        strokeDasharray="5 5"
      />
      <line
        x1={PAD_X - 10}
        y1={BED_Y}
        x2={VIEW_WIDTH - PAD_X + 10}
        y2={BED_Y}
        stroke={tone.bed}
        strokeWidth={1.25}
      />
      <line
        x1={PAD_X}
        y1={DISTRIBUTOR_Y}
        x2={VIEW_WIDTH - PAD_X}
        y2={DISTRIBUTOR_Y}
        stroke={tone.stem}
        strokeWidth={1}
      />
      {SERVICE.map((ratio, index) => (
        <line
          key={`stem-${ratio}-${index}`}
          x1={x0(index) + step * 0.5}
          y1={DISTRIBUTOR_Y}
          x2={x0(index) + step * 0.5}
          y2={DISTRIBUTOR_Y + ratio * STEM_SPREAD}
          stroke={tone.stem}
          strokeWidth={10}
        />
      ))}
    </svg>
  );
}
