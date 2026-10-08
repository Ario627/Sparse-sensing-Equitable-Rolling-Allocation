import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { cn } from "@/lib/cn.ts";
import { formatNumber, formatPercent } from "@/lib/format.ts";
import { palette } from "@/lib/palette.ts";
import type { Tone } from "@/components/kit/status-pill.tsx";
import type { NetworkFlowModel, NetworkNodeData } from "./selectors.ts";

const DEFAULT_HEIGHT = 420;
const CARD_WIDTH = 152;
const BAR_MAX_PERCENT = 100;

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

const kindSurfaceClasses: Record<string, string> = {
  source: "bg-water-soft",
  junction: "bg-surface",
  gate: "bg-surface",
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

function BlockNode({ data, selected }: NodeProps) {
  const node = data as NetworkNodeData;
  const block = node.block;
  if (block === null) {
    return null;
  }
  return (
    <div
      title={`${block.name} · ${block.band.label}`}
      className={cn(
        "rounded-sm border bg-surface px-2.5 py-2 shadow-hair transition-colors",
        toneBorderClasses[block.band.tone],
        selectionClasses(selected),
      )}
      style={{ width: CARD_WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="!bg-line-2" />
      <p className="truncate text-xs font-medium text-ink">{block.name}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-lg leading-none font-medium text-ink tabular">
          {block.serviceRatio === null ? "—" : formatPercent(block.serviceRatio)}
        </span>
        <span className="label-caps text-ink-3">{block.band.label}</span>
      </p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-xs bg-sunk">
        <div
          className={cn("h-full", toneFillClasses[block.band.tone])}
          style={{ width: ratioBarWidth(block.serviceRatio) }}
        />
      </div>
      <p className="mt-1.5 flex items-center justify-between text-2xs text-ink-3">
        <span className="tabular">
          {formatNumber(block.areaM2 / 10_000, 1)} ha
        </span>
        {block.sensors.sensorCount > 0 && (
          <span className={cn(block.sensors.staleCount > 0 && "text-crit")}>
            {block.sensors.staleCount > 0
              ? `${block.sensors.staleCount} basi`
              : `${block.sensors.sensorCount} sensor`}
          </span>
        )}
      </p>
    </div>
  );
}

function SourceNode({ data, selected }: NodeProps) {
  const node = data as NetworkNodeData;
  return (
    <div
      className={cn(
        "rounded-sm border border-water/45 bg-water-soft px-2.5 py-1.5 shadow-hair",
        selectionClasses(selected),
      )}
    >
      <Handle type="source" position={Position.Bottom} className="!bg-line-2" />
      <p className="label-caps text-water-deep">{node.role}</p>
      <p className="max-w-32 truncate text-xs text-ink">{node.name}</p>
    </div>
  );
}

function PassthroughNode({ data, selected }: NodeProps) {
  const node = data as NetworkNodeData;
  return (
    <div
      className={cn(
        "rounded-xs border border-line-2 px-2 py-1 shadow-hair",
        kindSurfaceClasses.junction,
        selectionClasses(selected),
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-line-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-line-2" />
      <p className="label-caps text-ink-3">{node.role}</p>
      <p className="max-w-28 truncate text-xs text-ink">{node.name}</p>
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
  return flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: palette.line2,
    },
    style: { stroke: palette.line2, strokeWidth: 1.5 },
  }));
}

export interface NetworkCanvasProps {
  readonly flow: NetworkFlowModel;
  readonly onBlockSelect?: (blockId: string) => void;
  readonly height?: number;
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
      aria-label="Kanvas jaringan"
      style={{ height }}
      className={cn(
        "overflow-hidden rounded-md border border-line bg-surface",
        className,
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22, minZoom: 0.35, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        preventScrolling={false}
        onNodeClick={handleNodeClick}
      />
    </div>
  );
}