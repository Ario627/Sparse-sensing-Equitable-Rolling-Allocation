import { cn } from "@/lib/cn.ts";
import { palette } from "@/lib/palette.ts";
import {
  DITCHES,
  GATES,
  PLOTS,
  SENSOR_STAKES,
  SOURCE,
  TERRAIN,
  TIER_CENTER,
  TIER_ORDER,
  TIER_RANGE,
  TREES,
  type TierId,
  type ViewpointId,
} from "./paddy-layout.ts";

const VIEW_BOX = { x: -6.6, y: -6.9, width: 13.2, height: 12.2 } as const;

const BASE_FILL = "#e9eee7";
const SOIL_FILL = "#ddd3b8";
const PLOT_EMPTY = "#d7e5cd";
const PLOT_MATURE = "#a9c99a";
const BUND_STROKE = "#75694f";
const CANOPY_FILL = "#6d9a72";
const CANOPY_INNER = "#4e7a5d";
const GATE_FILL = "#57616b";
const STAKE_FILL = "#55b5ba";

const TIER_FILLS: Record<TierId, string> = {
  head: "#e2ebe8",
  middle: "#e6ede0",
  tail: "#efe9dd",
};

const TIER_LABELS: Record<TierId, string> = {
  head: "HULU",
  middle: "TENGAH",
  tail: "HILIR",
};

function mixHex(from: string, to: string, amount: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number): number => {
    const va = (a >> shift) & 0xff;
    const vb = (b >> shift) & 0xff;
    return Math.round(va + (vb - va) * amount);
  };
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${value.toString(16).padStart(6, "0")}`;
}

export interface PaddyMapProps {
  readonly viewpoint: ViewpointId;
  readonly onViewpointChange: (id: ViewpointId) => void;
  readonly className?: string;
}

export function PaddyMap({
  viewpoint,
  onViewpointChange,
  className,
}: PaddyMapProps) {
  const active = (tier: TierId): boolean => viewpoint === tier;
  return (
    <svg
      viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn("h-full w-full", className)}
    >
      <defs>
        <pattern
          id="sera-paddy-rows"
          width="0.34"
          height="0.34"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0 0.17 H0.34"
            stroke="#6f8f60"
            strokeWidth="0.035"
            opacity="0.28"
          />
        </pattern>
      </defs>
      <rect
        x={-TERRAIN.baseWidth / 2}
        y={-0.8 - TERRAIN.baseDepth / 2}
        width={TERRAIN.baseWidth}
        height={TERRAIN.baseDepth}
        rx={0.28}
        fill={BASE_FILL}
        stroke={palette.line2}
        strokeWidth={0.06}
      />
      {TIER_ORDER.map((tier) => (
        <g
          key={tier}
          className="cursor-pointer transition-opacity hover:opacity-95"
          onClick={() => {
            onViewpointChange(tier);
          }}
        >
          <rect
            x={-TERRAIN.slabWidth / 2}
            y={TIER_CENTER[tier] - TERRAIN.slabDepth / 2}
            width={TERRAIN.slabWidth}
            height={TERRAIN.slabDepth}
            rx={0.16}
            fill={TIER_FILLS[tier]}
            stroke={active(tier) ? palette.water : palette.line2}
            strokeWidth={active(tier) ? 0.09 : 0.05}
          />
        </g>
      ))}
      <text
        x={-5.55}
        y={TIER_CENTER.head}
        transform={`rotate(-90 -5.55 ${TIER_CENTER.head})`}
        textAnchor="middle"
        fontSize="0.3"
        letterSpacing="0.12em"
        fill={palette.ink3}
        fontFamily="var(--font-mono)"
        className="pointer-events-none"
      >
        {TIER_LABELS.head}
      </text>
      <text
        x={-5.55}
        y={TIER_CENTER.middle}
        transform={`rotate(-90 -5.55 ${TIER_CENTER.middle})`}
        textAnchor="middle"
        fontSize="0.3"
        letterSpacing="0.12em"
        fill={palette.ink3}
        fontFamily="var(--font-mono)"
        className="pointer-events-none"
      >
        {TIER_LABELS.middle}
      </text>
      <text
        x={-5.55}
        y={TIER_CENTER.tail}
        transform={`rotate(-90 -5.55 ${TIER_CENTER.tail})`}
        textAnchor="middle"
        fontSize="0.3"
        letterSpacing="0.12em"
        fill={palette.ink3}
        fontFamily="var(--font-mono)"
        className="pointer-events-none"
      >
        {TIER_LABELS.tail}
      </text>
      {TIER_ORDER.map((tier) =>
        PLOTS.filter((plot) => plot.tier === tier).map((plot) => (
          <g
            key={plot.id}
            className="cursor-pointer transition-opacity hover:opacity-95"
            onClick={() => {
              onViewpointChange(tier);
            }}
          >
            <rect
              x={plot.x - plot.width / 2}
              y={plot.z - plot.depth / 2}
              width={plot.width}
              height={plot.depth}
              rx={0.08}
              fill={mixHex(PLOT_EMPTY, PLOT_MATURE, plot.stage)}
              stroke={active(tier) ? palette.water : BUND_STROKE}
              strokeWidth={active(tier) ? 0.06 : 0.045}
            />
            <rect
              x={plot.x - plot.width / 2}
              y={plot.z - plot.depth / 2}
              width={plot.width}
              height={plot.depth}
              rx={0.08}
              fill="url(#sera-paddy-rows)"
            />
          </g>
        )),
      )}
      {PLOTS.map((plot, index) => (
        <text
          key={`${plot.id}-label`}
          x={plot.x}
          y={plot.z + 0.1}
          textAnchor="middle"
          fontSize="0.28"
          fill={palette.ink3}
          opacity="0.7"
          fontFamily="var(--font-mono)"
          className="pointer-events-none"
        >
          {`#${index + 1}`}
        </text>
      ))}
      <rect
        x={-0.35}
        y={TIER_RANGE.head[0]}
        width={0.7}
        height={TIER_RANGE.tail[1] - TIER_RANGE.head[0]}
        rx={0.1}
        fill={palette.water}
        opacity="0.85"
      />
      {DITCHES.filter((ditch) => !ditch.alongZ).map((ditch) => (
        <rect
          key={ditch.id}
          x={ditch.x - ditch.length / 2}
          y={ditch.z - ditch.width / 2}
          width={ditch.length}
          height={ditch.width}
          rx={0.06}
          fill={palette.water}
          opacity="0.65"
        />
      ))}
      {GATES.map((gate) => (
        <g key={gate.id}>
          <rect
            x={-0.41}
            y={gate.z - 0.07}
            width={0.82}
            height={0.14}
            rx={0.04}
            fill={GATE_FILL}
          />
          <rect x={-0.5} y={gate.z - 0.11} width={0.09} height={0.22} rx={0.02} fill={GATE_FILL} />
          <rect x={0.41} y={gate.z - 0.11} width={0.09} height={0.22} rx={0.02} fill={GATE_FILL} />
        </g>
      ))}
      <g
        className="cursor-pointer transition-opacity hover:opacity-95"
        onClick={() => {
          onViewpointChange("source");
        }}
      >
        <rect
          x={-TERRAIN.platformWidth / 2}
          y={SOURCE.z - TERRAIN.platformDepth / 2}
          width={TERRAIN.platformWidth}
          height={TERRAIN.platformDepth}
          rx={0.16}
          fill={SOIL_FILL}
          stroke={viewpoint === "source" ? palette.water : palette.line2}
          strokeWidth={viewpoint === "source" ? 0.09 : 0.05}
        />
        <circle
          cx={SOURCE.x}
          cy={SOURCE.z}
          r={0.85}
          fill="#bfe0e2"
          stroke={palette.water}
          strokeWidth="0.06"
        />
        <circle cx={SOURCE.x} cy={SOURCE.z} r={0.42} fill="#9fd0d4" />
        <rect x={0.85} y={SOURCE.z - 0.16} width={0.32} height={0.32} rx={0.05} fill={GATE_FILL} />
      </g>
      <text
        x={1.55}
        y={SOURCE.z - 0.18}
        fontSize="0.3"
        letterSpacing="0.12em"
        fill={palette.water}
        fontFamily="var(--font-mono)"
        className="pointer-events-none"
      >
        SUMBER
      </text>
      {TREES.map((tree) => (
        <g key={tree.id} transform={`translate(${tree.x} ${tree.z}) scale(${tree.scale})`}>
          <circle r={0.42} fill={CANOPY_FILL} stroke="#5d8a63" strokeWidth="0.05" />
          <circle r={0.18} fill={CANOPY_INNER} />
        </g>
      ))}
      {SENSOR_STAKES.map((stake) => (
        <g key={stake.id} transform={`translate(${stake.x} ${stake.z})`}>
          <circle r={0.26} fill="none" stroke={STAKE_FILL} strokeWidth="0.04" opacity="0.45" />
          <circle r={0.14} fill={STAKE_FILL} stroke="#ffffff" strokeWidth="0.045" />
        </g>
      ))}
    </svg>
  );
}
