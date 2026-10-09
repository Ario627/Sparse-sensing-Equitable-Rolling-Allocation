import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Tone } from "@/components/kit/status-pill.tsx";
import { cn } from "@/lib/cn.ts";
import { formatCappedPercent, formatNumber } from "@/lib/format.ts";
import { palette, rgba } from "@/lib/palette.ts";
import type { NetworkFlowModel, NetworkNodeData } from "./selectors.ts";

const DEFAULT_HEIGHT = 640;
const CARD_WIDTH = 204;
const BAR_MAX_PERCENT = 100;
const FIT_PADDING = 0.1;

const toneBorderClasses: Record<Tone, string> = {
  ok: "border-ok/45",
  warn: "border-warn/45",
  crit: "border-crit/45",
  fallback: "border-fallback/45",
  info: "border-info/45",
  neutral: "border-line-2",
};

const toneFillClasses: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  fallback: "bg-fallback",
  info: "bg-info",
  neutral: "bg-ink-3",
};

const toneRailClasses: Record<Tone, string> = {
  ok: "bg-ok/70",
  warn: "bg-warn/70",
  crit: "bg-crit/70",
  fallback: "bg-fallback/70",
  info: "bg-info/70",
  neutral: "bg-line-2",
};

function ratioBarWidth(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "0%";
  }
  return `${Math.min(BAR_MAX_PERCENT, Math.max(0, Math.round(ratio * BAR_MAX_PERCENT)))}%`;
}

function selectionClasses(selected: boolean): string {
  return selected ? "outline outline-2 outline-water/45" : "";
}

function zoneTag(role: string): string {
  const parts = role.split("·");
  return parts.length > 1 ? (parts[1]?.trim() ?? "") : "";
}

function BlockNode({ data, selected }: NodeProps) {
  const node = data as NetworkNodeData;
  const block = node.block;
  if (block === null) {
    return null;
  }
  const stale = block.sensors.staleCount;
  return (
    <div
      title={`${block.name} · ${block.band.label}`}
      className={cn(
        "relative rounded-md border bg-surface shadow-hair transition-colors",
        toneBorderClasses[block.band.tone],
        selectionClasses(selected),
      )}
      style={{ width: CARD_WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="!bg-line-2" />
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1 rounded-l-md",
          toneRailClasses[block.band.tone],
        )}
      />
      <div className="flex flex-col gap-2 py-3 pr-3 pl-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-ink">{block.name}</p>
          <span className="shrink-0 font-mono text-2xs text-ink-3">
            {zoneTag(node.role)}
          </span>
        </div>
        <p className="flex items-baseline gap-2">
          <span className="font-display text-2xl leading-none font-semibold text-ink tabular">
            {formatCappedPercent(block.serviceRatio)}
          </span>
          <span className="label-caps text-ink-3">{block.band.label}</span>
        </p>
        <div className="flume-bed h-1.5 overflow-hidden rounded-xs bg-sunk">
          <div
            className={cn("h-full", toneFillClasses[block.band.tone])}
            style={{ width: ratioBarWidth(block.serviceRatio) }}
          />
        </div>
        <p className="flex items-center justify-between font-mono text-2xs text-ink-3">
          <span className="tabular">{formatNumber(block.areaM2 / 10_000, 1)} ha</span>
          <span className="tabular">{formatNumber(block.nominalFlowLps, 1)} L/s</span>
          <span className={cn("tabular", stale > 0 && "text-crit")}>
            {block.sensors.sensorCount === 0
              ? "tanpa sensor"
              : stale > 0
                ? `${formatNumber(stale)} basi`
                : `${formatNumber(block.sensors.sensorCount)} sensor`}
          </span>
        </p>
      </div>
    </div>
  );
}

interface SensorBadgeProps {
  readonly sensors: NetworkNodeData["sensors"];
}

function SensorBadge({ sensors }: SensorBadgeProps) {
  if (sensors.sensorCount === 0) {
    return null;
  }
  const stale = sensors.staleCount > 0;
  return (
    <span
      title={
        stale
          ? `${formatNumber(sensors.staleCount)} dari ${formatNumber(sensors.sensorCount)} sensor basi`
          : `${formatNumber(sensors.sensorCount)} sensor segar`
      }
      className={cn(
        "mt-1.5 inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 font-mono text-2xs tabular",
        stale ? "bg-crit-soft text-crit" : "bg-ok-soft text-ok",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", stale ? "bg-crit" : "bg-ok")}
      />
      {stale
        ? `${formatNumber(sensors.staleCount)}/${formatNumber(sensors.sensorCount)} basi`
        : `${formatNumber(sensors.sensorCount)} sensor`}
    </span>
  );
}

function SourceNode({ data, selected }: NodeProps) {
  const node = data as NetworkNodeData;
  return (
    <div
      className={cn(
        "w-44 rounded-md border border-water/45 bg-water-soft px-3.5 py-2.5 shadow-hair",
        selectionClasses(selected),
      )}
    >
      <Handle type="source" position={Position.Bottom} className="!bg-water/60" />
      <p className="label-caps text-water-deep">Intake</p>
      <p className="mt-1 truncate text-sm font-medium text-ink">{node.name}</p>
      <SensorBadge sensors={node.sensors} />
    </div>
  );
}

function PassthroughNode({ data, selected }: NodeProps) {
  const node = data as NetworkNodeData;
  return (
    <div
      className={cn(
        "w-36 rounded-sm border border-line-2 bg-surface px-3 py-2 shadow-hair",
        selectionClasses(selected),
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-line-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-line-2" />
      <p className="label-caps text-ink-3">{node.role}</p>
      <p className="mt-1 truncate text-xs text-ink">{node.name}</p>
      <SensorBadge sensors={node.sensors} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  source: SourceNode,
  junction: PassthroughNode,
  gate: PassthroughNode,
  block: BlockNode,
};

function toFlowNodes(flow: NetworkFlowModel): Node<NetworkNodeData>[] {
  return flow.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    data: node.data,
    draggable: false,
    connectable: false,
  }));
}

function toFlowEdges(flow: NetworkFlowModel): Edge[] {
  const gateByNodeId = new Map<string, boolean>();
  for (const node of flow.nodes) {
    gateByNodeId.set(node.id, node.data.block?.slot?.gateOpen ?? false);
  }
  return flow.edges.map((edge) => {
    const open = gateByNodeId.get(edge.to) ?? false;
    const stroke = open ? palette.water : palette.line2;
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: "smoothstep",
      pathOptions: { borderRadius: 14 },
      animated: open,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: stroke,
      },
      style: open
        ? { stroke, strokeWidth: 2 }
        : { stroke, strokeWidth: 1.5, opacity: 0.85 },
    };
  });
}

export interface NetworkCanvasProps {
  readonly flow: NetworkFlowModel;
  readonly onBlockSelect?: (blockId: string) => void;
  readonly height?: number | string;
  readonly className?: string;
}

export function NetworkCanvas({
  flow,
  onBlockSelect,
  height = DEFAULT_HEIGHT,
  className,
}: NetworkCanvasProps) {
  const nodes = useMemo(() => toFlowNodes(flow), [flow]);
  const edges = useMemo(() => toFlowEdges(flow), [flow]);

  function handleNodeClick(_: unknown, node: Node): void {
    if (onBlockSelect === undefined) {
      return;
    }
    const blockId = (node.data as NetworkNodeData).block?.blockId;
    if (blockId !== undefined) {
      onBlockSelect(blockId);
    }
  }

  return (
    <div
      role="img"
      aria-label="Kanvas jaringan"
      style={{ height }}
      className={cn(
        "relative overflow-hidden rounded-xl border border-line bg-surface",
        className,
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, minZoom: 0.45, maxZoom: 1.1 }}
        minZoom={0.25}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        preventScrolling={false}
        onNodeClick={handleNodeClick}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1}
          color={rgba(palette.line2, 0.55)}
        />
        <Controls
          showInteractive={false}
          className="!bottom-4 !left-4 !rounded-md !border !border-line !shadow-hair"
        />
      </ReactFlow>
    </div>
  );
}
