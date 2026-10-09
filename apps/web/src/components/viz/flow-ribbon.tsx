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
const NAME_Y = 206;
const VALUE_Y = 220;
const MIN_LABEL_PERCENT = 7.5;
const MIN_STEM_PERCENT = 5;

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

const zoneOrder: Record<LossZone, number> = { HEAD: 0, MIDDLE: 1, TAIL: 2 };

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
  readonly designDepth: number;
  readonly waterDepth: number;
  readonly ratio: number | null;
}

interface RibbonGeometry {
  readonly reaches: readonly Reach[];
  readonly designEdge: string;
  readonly waterPath: string;
  readonly shortfallPath: string;
  readonly flowLine: string;
  readonly efficiency: number;
  readonly fuzzDepth: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function averages(blocks: readonly FlowRibbonBlock[]): {
  readonly efficiency: number;
  readonly weighted: boolean;
} {
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
  if (weight === 0) {
    return { efficiency: 1, weighted: false };
  }
  return { efficiency: total / weight, weighted: true };
}

function buildGeometry(
  blocks: readonly FlowRibbonBlock[],
  confidence: number | null,
): RibbonGeometry {
  const count = blocks.length;
  const span = VIEW_WIDTH - PAD_X * 2;
  const step = count === 0 ? span : span / count;
  const nominalTotal = blocks.reduce(
    (sum, block) => sum + Math.max(0, block.nominalFlowLps),
    0,
  );
  const { efficiency, weighted } = averages(blocks);
  const delivered = weighted ? efficiency : 0.72;
  const fuzz = clamp01(1 - (confidence ?? 0.5)) * 0.18 + 0.02;

  const shares = blocks.map((block) => {
    if (nominalTotal > 0) {
      return Math.max(0, block.nominalFlowLps) / nominalTotal;
    }
    return count === 0 ? 0 : 1 / count;
  });

  const reaches: Reach[] = [];
  let remaining = 1;
  for (let index = 0; index < count; index += 1) {
    const share = shares[index] ?? 0;
    const designDepth = clamp01(remaining);
    remaining = clamp01(remaining - share);
    reaches.push({
      x0: PAD_X + step * index,
      x1: PAD_X + step * (index + 1),
      center: PAD_X + step * (index + 0.5),
      designDepth,
      waterDepth: clamp01(designDepth * delivered),
      ratio: blocks[index]?.serviceRatio ?? null,
    });
  }

  const designTop = reaches.map((reach) => BED_Y - reach.designDepth * MAX_DEPTH);
  const waterTop = reaches.map((reach) => BED_Y - reach.waterDepth * MAX_DEPTH);

  const designSegments: string[] = [`M ${PAD_X} ${BED_Y}`];
  const waterSegments: string[] = [`M ${PAD_X} ${BED_Y}`];
  reaches.forEach((reach, index) => {
    const design = designTop[index] ?? BED_Y;
    const water = waterTop[index] ?? BED_Y;
    designSegments.push(`L ${reach.x0} ${design}`, `L ${reach.x1} ${design}`);
    waterSegments.push(
      `L ${reach.x0} ${design}`,
      `L ${reach.x0} ${water}`,
      `L ${reach.x1} ${water}`,
    );
  });
  designSegments.push(`L ${VIEW_WIDTH - PAD_X} ${BED_Y}`);
  waterSegments.push(`L ${VIEW_WIDTH - PAD_X} ${BED_Y}`, "Z");

  const shortfallSegments: string[] = [];
  reaches.forEach((reach, index) => {
    const design = designTop[index] ?? BED_Y;
    const water = waterTop[index] ?? BED_Y;
    const previousDesign = index === 0 ? design : (designTop[index - 1] ?? design);
    shortfallSegments.push(
      `M ${reach.x0} ${previousDesign}`,
      `L ${reach.x0} ${water}`,
      `L ${reach.x1} ${water}`,
      `L ${reach.x1} ${design}`,
      "Z",
    );
  });

  const flowSegments: string[] = [];
  reaches.forEach((reach, index) => {
    const water = waterTop[index] ?? BED_Y;
    const mid = water + (BED_Y - water) * 0.55;
    if (index === 0) {
      flowSegments.push(`M ${reach.x0} ${mid}`);
    }
    flowSegments.push(`L ${reach.x1} ${mid}`);
  });

  return {
    reaches,
    designEdge: designSegments.join(" "),
    waterPath: waterSegments.join(" "),
    shortfallPath: shortfallSegments.join(" "),
    flowLine: flowSegments.join(" "),
    efficiency: delivered,
    fuzzDepth: Math.max(2.5, fuzz * MAX_DEPTH),
  };
}

function ZoneBands({ reaches, blocks }: {
  readonly reaches: readonly Reach[];
  readonly blocks: readonly FlowRibbonBlock[];
}) {
  const bands: { readonly zone: LossZone; readonly from: number; readonly to: number }[] =
    [];
  reaches.forEach((reach, index) => {
    const zone = blocks[index]?.zone ?? null;
    if (zone === null) {
      return;
    }
    const current = bands.at(-1);
    if (current !== undefined && current.zone === zone) {
      return;
    }
    bands.push({ zone, from: reach.x0, to: reach.x1 });
  });
  reaches.forEach((reach, index) => {
    const zone = blocks[index]?.zone ?? null;
    if (zone === null) {
      return;
    }
    const last = bands.at(-1);
    if (last !== undefined && last.zone === zone) {
      bands[bands.length - 1] = { zone, from: last.from, to: reach.x1 };
    }
  });
  return (
    <g>
      {bands.map((band) => (
        <g key={`${band.zone}-${band.from}`}>
          <rect
            x={band.from}
            y={BED_Y + 4}
            width={Math.max(0, band.to - band.from)}
            height={3}
            fill={rgba(palette.water, 0.18)}
          />
          <text
            x={(band.from + band.to) / 2}
            y={BED_Y + 20}
            textAnchor="middle"
            className="fill-ink-3 font-mono text-2xs"
          >
            {zoneLabels[band.zone]}
          </text>
        </g>
      ))}
    </g>
  );
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
        const left = a.zone === null ? 3 : zoneOrder[a.zone];
        const right = b.zone === null ? 3 : zoneOrder[b.zone];
        return left - right;
      }),
    [blocks],
  );
  const geometry = useMemo(
    () => buildGeometry(ordered, confidence),
    [ordered, confidence],
  );
  const labelEvery = Math.max(1, Math.ceil(MIN_LABEL_PERCENT / 6));
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
            <stop offset="0%" stopColor={rgba(palette.water, 0.72)} />
            <stop offset="100%" stopColor={rgba(palette.water, 0.96)} />
          </linearGradient>
          <pattern
            id="sera-shortfall"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(115)"
          >
            <rect width="7" height="7" fill={rgba(palette.ink3, 0.06)} />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke={rgba(palette.ink3, 0.34)}
              strokeWidth="1"
            />
          </pattern>
        </defs>

        <path d={geometry.shortfallPath} fill="url(#sera-shortfall)" />
        <path d={geometry.waterPath} fill="url(#sera-flume)" />
        <path
          d={geometry.flowLine}
          fill="none"
          stroke={rgba(palette.surface, 0.55)}
          strokeWidth={1.5}
          strokeDasharray="5 11"
          className="motion-safe:animate-flow"
        />
        <path
          d={geometry.designEdge}
          fill="none"
          stroke={rgba(palette.ink, 0.34)}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <rect
          x={PAD_X}
          y={BED_Y - geometry.fuzzDepth}
          width={VIEW_WIDTH - PAD_X * 2}
          height={geometry.fuzzDepth}
          fill={rgba(palette.water, 0.16)}
        />

        <line
          x1={PAD_X - 12}
          y1={BED_Y}
          x2={VIEW_WIDTH - PAD_X + 12}
          y2={BED_Y}
          stroke={rgba(palette.ink, 0.5)}
          strokeWidth={1.25}
        />

        <ZoneBands reaches={geometry.reaches} blocks={ordered} />

        <line
          x1={PAD_X}
          y1={DISTRIBUTOR_Y}
          x2={VIEW_WIDTH - PAD_X}
          y2={DISTRIBUTOR_Y}
          stroke={rgba(palette.ink, 0.18)}
          strokeWidth={1}
        />

        {geometry.reaches.map((reach, index) => {
          const block = ordered[index];
          if (block === undefined) {
            return null;
          }
          const ratio = reach.ratio ?? geometry.efficiency;
          const length = clamp01(ratio) * STEM_SPREAD;
          const showLabel =
            index % labelEvery === 0 || ordered.length <= 12;
          const shortName =
            block.name.length > 11 ? `${block.name.slice(0, 10)}…` : block.name;
          return (
            <g key={block.id}>
              <line
                x1={reach.center}
                y1={DISTRIBUTOR_Y}
                x2={reach.center}
                y2={DISTRIBUTOR_Y + length}
                stroke={toneStroke[block.tone]}
                strokeWidth={stemWidth}
                strokeLinecap="butt"
                opacity={0.9}
              />
              <line
                x1={reach.center}
                y1={DISTRIBUTOR_Y}
                x2={reach.center}
                y2={DISTRIBUTOR_Y + STEM_SPREAD}
                stroke={rgba(palette.ink, 0.12)}
                strokeWidth={1}
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
                  y1={DISTRIBUTOR_Y - 3}
                  x2={reach.center + 4}
                  y2={DISTRIBUTOR_Y - 3}
                  stroke={palette.water}
                  strokeWidth={2}
                />
              )}
              {block.staleCount > 0 && (
                <circle
                  cx={reach.center}
                  cy={DISTRIBUTOR_Y + STEM_SPREAD + 5}
                  r={2.2}
                  fill={palette.crit}
                />
              )}
              {showLabel && (
                <>
                  <text
                    x={reach.center}
                    y={NAME_Y}
                    textAnchor="middle"
                    className="fill-ink-2 text-2xs"
                  >
                    {shortName}
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
              <title>
                {`${block.name} · ${block.bandLabel} · rasio ${formatCappedPercent(
                  reach.ratio,
                )} · debit rencana ${formatNumber(block.nominalFlowLps, 1)} L/s`}
              </title>
            </g>
          );
        })}

        <text x={PAD_X} y={20} className="fill-ink-2 text-2xs">
          {sourceName ?? "Intake"}
        </text>
        <text
          x={PAD_X}
          y={36}
          className="fill-ink font-mono text-xs tabular"
        >
          {flowLps === null ? "— L/s" : `${formatNumber(flowLps, 1)} L/s`}
        </text>
        <text
          x={VIEW_WIDTH - PAD_X}
          y={20}
          textAnchor="end"
          className="fill-ink-2 text-2xs"
        >
          Sisa ke hilir
        </text>
        <text
          x={VIEW_WIDTH - PAD_X}
          y={36}
          textAnchor="end"
          className="fill-ink font-mono text-xs tabular"
        >
          {formatCappedPercent(
            geometry.reaches.at(-1)?.ratio ?? geometry.efficiency,
          )}
        </text>
      </svg>
    </div>
  );
}
