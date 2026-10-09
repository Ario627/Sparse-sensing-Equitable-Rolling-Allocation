import type { LossZone } from "@sera/contracts";
import { useMemo } from "react";
import type { Tone } from "@/components/kit/status-pill.tsx";
import { cn } from "@/lib/cn.ts";
import { formatCappedPercent, formatNumber } from "@/lib/format.ts";
import { palette, rgba } from "@/lib/palette.ts";

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 232;
const PAD_X = 46;
const BED_Y = 124;
const MAX_DEPTH = 76;
const DISTRIBUTOR_Y = 138;
const STEM_SPREAD = 52;
const NAME_Y = 208;
const VALUE_Y = 222;
const LABEL_LIMIT = 12;
const NAME_LIMIT = 11;

const toneStroke: Record<Tone, string> = {
  ok: palette.ok,
  warn: palette.warn,
  crit: palette.crit,
  fallback: palette.fallback,
  info: palette.info,
  neutral: palette.ink3,
};

const zoneLabels: Record<LossZone, string> = {
  HEAD: "Hulu",
  MIDDLE: "Tengah",
  TAIL: "Hilir",
};

const zoneRank: Record<LossZone, number> = { HEAD: 0, MIDDLE: 1, TAIL: 2 };

export interface FlowRibbonBlock {
  readonly id: string;
  readonly name: string;
  readonly zone: LossZone | null;
  readonly serviceRatio: number | null;
  readonly tone: Tone;
  readonly bandLabel: string;
  readonly nominalFlowLps: number;
  readonly staleCount: number;
  readonly gateOpen: boolean;
}

export interface FlowRibbonProps {
  readonly blocks: readonly FlowRibbonBlock[];
  readonly sourceName: string | null;
  readonly flowLps: number | null;
  readonly confidence: number | null;
  readonly className?: string;
}

interface Reach {
  readonly x0: number;
  readonly x1: number;
  readonly center: number;
  readonly designTop: number;
  readonly waterTop: number;
  readonly ratio: number | null;
  readonly zone: LossZone | null;
}

interface RibbonGeometry {
  readonly reaches: readonly Reach[];
  readonly designEdge: string;
  readonly waterEdge: string;
  readonly waterPath: string;
  readonly shortfallPath: string;
  readonly flowLine: string;
  readonly efficiency: number;
  readonly surfaceWidth: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function deliveredRatio(blocks: readonly FlowRibbonBlock[]): number {
  let weight = 0;
  let total = 0;
  for (const block of blocks) {
    if (block.serviceRatio === null) {
      continue;
    }
    const share = block.nominalFlowLps > 0 ? block.nominalFlowLps : 1;
    weight += share;
    total += share * clamp01(block.serviceRatio);
  }
  return weight === 0 ? 0.72 : total / weight;
}

interface ZoneBand {
  readonly zone: LossZone;
  readonly from: number;
  readonly to: number;
}

function zoneBandsOf(reaches: readonly Reach[]): readonly ZoneBand[] {
  const bands: ZoneBand[] = [];
  for (const reach of reaches) {
    if (reach.zone === null) {
      continue;
    }
    const last = bands.at(-1);
    if (last !== undefined && last.zone === reach.zone) {
      bands[bands.length - 1] = { zone: reach.zone, from: last.from, to: reach.x1 };
      continue;
    }
    bands.push({ zone: reach.zone, from: reach.x0, to: reach.x1 });
  }
  return bands;
}

function buildGeometry(
  blocks: readonly FlowRibbonBlock[],
  confidence: number | null,
  delivered: number,
): RibbonGeometry {
  const count = blocks.length;
  const span = VIEW_WIDTH - PAD_X * 2;
  const step = count === 0 ? span : span / count;
  const nominalTotal = blocks.reduce(
    (sum, block) => sum + Math.max(0, block.nominalFlowLps),
    0,
  );

  const reaches: Reach[] = [];
  let remaining = 1;
  for (let index = 0; index < count; index += 1) {
    const block = blocks[index];
    const share =
      nominalTotal > 0
        ? Math.max(0, block?.nominalFlowLps ?? 0) / nominalTotal
        : 1 / count;
    const designDepth = clamp01(remaining);
    remaining = clamp01(remaining - share);
    reaches.push({
      x0: PAD_X + step * index,
      x1: PAD_X + step * (index + 1),
      center: PAD_X + step * (index + 0.5),
      designTop: BED_Y - designDepth * MAX_DEPTH,
      waterTop: BED_Y - designDepth * delivered * MAX_DEPTH,
      ratio: block?.serviceRatio ?? null,
      zone: block?.zone ?? null,
    });
  }

  const topEdge = (key: "designTop" | "waterTop"): string => {
    if (reaches.length === 0) {
      return "";
    }
    const parts = [`M ${PAD_X} ${BED_Y}`];
    for (const reach of reaches) {
      parts.push(`L ${reach.x0} ${reach[key]}`, `L ${reach.x1} ${reach[key]}`);
    }
    return parts.join(" ");
  };

  const designEdge = topEdge("designTop");
  const waterEdge = topEdge("waterTop");
  const lastX = PAD_X + span;

  const shortfallParts: string[] = [];
  if (reaches.length > 0) {
    shortfallParts.push(designEdge);
    for (let index = reaches.length - 1; index >= 0; index -= 1) {
      const reach = reaches[index];
      if (reach === undefined) {
        continue;
      }
      shortfallParts.push(
        `L ${reach.x1} ${reach.waterTop}`,
        `L ${reach.x0} ${reach.waterTop}`,
      );
    }
    shortfallParts.push("Z");
  }

  const flowParts: string[] = [];
  reaches.forEach((reach, index) => {
    const mid = reach.waterTop + (BED_Y - reach.waterTop) * 0.58;
    if (index === 0) {
      flowParts.push(`M ${reach.x0} ${mid}`);
    }
    flowParts.push(`L ${reach.x1} ${mid}`);
  });

  return {
    reaches,
    designEdge,
    waterEdge,
    waterPath: reaches.length === 0 ? "" : `${waterEdge} L ${lastX} ${BED_Y} Z`,
    shortfallPath: shortfallParts.join(" "),
    flowLine: flowParts.join(" "),
    efficiency: delivered,
    surfaceWidth: Math.max(3, clamp01(1 - (confidence ?? 0.55)) * MAX_DEPTH * 0.5),
  };
}

function trimName(name: string): string {
  return name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name;
}

export function FlowRibbon({
  blocks,
  sourceName,
  flowLps,
  confidence,
  className,
}: FlowRibbonProps) {
  const ordered = useMemo(
    () =>
      [...blocks].sort((a, b) => {
        const left = a.zone === null ? 3 : zoneRank[a.zone];
        const right = b.zone === null ? 3 : zoneRank[b.zone];
        return left - right;
      }),
    [blocks],
  );
  const delivered = useMemo(() => deliveredRatio(ordered), [ordered]);
  const geometry = useMemo(
    () => buildGeometry(ordered, confidence, delivered),
    [ordered, confidence, delivered],
  );
  const bands = useMemo(() => zoneBandsOf(geometry.reaches), [geometry.reaches]);
  const labelStep = ordered.length > LABEL_LIMIT ? 2 : 1;
  const stemWidth = Math.min(18, Math.max(7, 420 / Math.max(1, ordered.length)));

  return (
    <div className={cn("overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="Profil aliran dari hulu ke hilir beserta pembagian layanan tiap blok"
        className="h-auto w-full min-w-[46rem]"
      >
        <defs>
          <linearGradient id="sera-flume" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={rgba(palette.water, 0.7)} />
            <stop offset="100%" stopColor={rgba(palette.water, 0.95)} />
          </linearGradient>
          <pattern
            id="sera-shortfall"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(115)"
          >
            <rect width="7" height="7" fill={rgba(palette.warn, 0.07)} />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke={rgba(palette.warn, 0.38)}
              strokeWidth="1"
            />
          </pattern>
        </defs>

        <path d={geometry.shortfallPath} fill="url(#sera-shortfall)" />
        <path d={geometry.waterPath} fill="url(#sera-flume)" />
        <path
          d={geometry.waterEdge}
          fill="none"
          stroke={rgba(palette.surface, 0.4)}
          strokeWidth={geometry.surfaceWidth}
        />
        <path
          d={geometry.flowLine}
          fill="none"
          stroke={rgba(palette.surface, 0.5)}
          strokeWidth={1.5}
          strokeDasharray="5 11"
          className="motion-safe:animate-flow"
        />
        <path
          d={geometry.designEdge}
          fill="none"
          stroke={rgba(palette.ink, 0.3)}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <line
          x1={PAD_X - 12}
          y1={BED_Y}
          x2={VIEW_WIDTH - PAD_X + 12}
          y2={BED_Y}
          stroke={rgba(palette.ink, 0.45)}
          strokeWidth={1.25}
        />

        {bands.map((band) => (
          <g key={`${band.zone}-${band.from}`}>
            <rect
              x={band.from}
              y={BED_Y + 5}
              width={Math.max(0, band.to - band.from)}
              height={3}
              fill={rgba(palette.water, 0.2)}
            />
            <text
              x={(band.from + band.to) / 2}
              y={BED_Y + 21}
              textAnchor="middle"
              className="fill-ink-3 font-mono text-2xs"
            >
              {zoneLabels[band.zone]}
            </text>
          </g>
        ))}

        <line
          x1={PAD_X}
          y1={DISTRIBUTOR_Y}
          x2={VIEW_WIDTH - PAD_X}
          y2={DISTRIBUTOR_Y}
          stroke={rgba(palette.ink, 0.16)}
          strokeWidth={1}
        />

        {geometry.reaches.map((reach, index) => {
          const block = ordered[index];
          if (block === undefined) {
            return null;
          }
          const ratio = reach.ratio ?? geometry.efficiency;
          const length = clamp01(ratio) * STEM_SPREAD;
          return (
            <g key={block.id}>
              <title>
                {`${block.name} · ${block.bandLabel} · rasio ${formatCappedPercent(reach.ratio)} · rencana ${formatNumber(block.nominalFlowLps, 1)} L/s`}
              </title>
              <line
                x1={reach.center}
                y1={DISTRIBUTOR_Y}
                x2={reach.center}
                y2={DISTRIBUTOR_Y + STEM_SPREAD}
                stroke={rgba(palette.ink, 0.1)}
                strokeWidth={1}
              />
              <line
                x1={reach.center}
                y1={DISTRIBUTOR_Y}
                x2={reach.center}
                y2={DISTRIBUTOR_Y + length}
                stroke={toneStroke[block.tone]}
                strokeWidth={stemWidth}
              />
              <circle
                cx={reach.center}
                cy={DISTRIBUTOR_Y + length}
                r={2.6}
                fill={palette.surface}
                stroke={toneStroke[block.tone]}
                strokeWidth={1.5}
              />
              {block.gateOpen && (
                <line
                  x1={reach.center - 4}
                  y1={DISTRIBUTOR_Y - 4}
                  x2={reach.center + 4}
                  y2={DISTRIBUTOR_Y - 4}
                  stroke={palette.water}
                  strokeWidth={2}
                />
              )}
              {block.staleCount > 0 && (
                <circle
                  cx={reach.center}
                  cy={DISTRIBUTOR_Y + STEM_SPREAD + 6}
                  r={2.2}
                  fill={palette.crit}
                />
              )}
              {index % labelStep === 0 && (
                <>
                  <text
                    x={reach.center}
                    y={NAME_Y}
                    textAnchor="middle"
                    className="fill-ink-2 text-2xs"
                  >
                    {trimName(block.name)}
                  </text>
                  <text
                    x={reach.center}
                    y={VALUE_Y}
                    textAnchor="middle"
                    className="fill-ink font-mono text-2xs tabular"
                  >
                    {formatCappedPercent(reach.ratio)}
                  </text>
                </>
              )}
            </g>
          );
        })}

        <text x={PAD_X} y={20} className="fill-ink-2 text-2xs">
          {sourceName ?? "Intake"}
        </text>
        <text x={PAD_X} y={38} className="fill-ink font-mono text-xs tabular">
          {flowLps === null ? "— L/s" : `${formatNumber(flowLps, 1)} L/s`}
        </text>
        <text
          x={VIEW_WIDTH - PAD_X}
          y={20}
          textAnchor="end"
          className="fill-ink-2 text-2xs"
        >
          Belum tersalur
        </text>
        <text
          x={VIEW_WIDTH - PAD_X}
          y={38}
          textAnchor="end"
          className="fill-ink font-mono text-xs tabular"
        >
          {formatCappedPercent(Math.max(0, 1 - geometry.efficiency))}
        </text>
      </svg>
    </div>
  );
}
