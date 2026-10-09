import {
  DataTable,
  type SeraColumnDef,
} from "@/components/kit/data-table.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import { cn } from "@/lib/cn.ts";
import { formatAgeFrom, formatNumber } from "@/lib/format.ts";
import {
  sensorQualityLabel,
  sensorQualityTone,
  sensorTypeLabel,
  type DeviceSummary,
} from "./status.ts";

const LAST_SEEN_TITLE = "Waktu telemetri terakhir diterima dari perangkat ini";

function TypeList({ types }: { readonly types: DeviceSummary["types"] }) {
  if (types.length === 0) {
    return <span className="text-xs text-ink-3">—</span>;
  }
  return (
    <span className="text-xs text-ink-2">
      {types.map((type) => sensorTypeLabel(type)).join(" · ")}
    </span>
  );
}

function NodesCell({ nodes }: { readonly nodes: DeviceSummary["nodeNames"] }) {
  if (nodes.length === 0) {
    return <span className="text-xs text-ink-3">—</span>;
  }
  return (
    <span
      className="block max-w-44 truncate text-xs text-ink-2"
      title={nodes.join(", ")}
    >
      {nodes.join(" · ")}
    </span>
  );
}

function buildColumns(now: number): SeraColumnDef<DeviceSummary>[] {
  return [
    {
      id: "device",
      accessorKey: "deviceId",
      header: "Perangkat",
      cell: (info) => (
        <span className="block max-w-36 truncate font-mono text-xs text-ink">
          {info.row.original.deviceId}
        </span>
      ),
    },
    {
      id: "types",
      accessorFn: (row) => row.types.join(","),
      header: "Jenis sensor",
      cell: (info) => <TypeList types={info.row.original.types} />,
    },
    {
      id: "nodes",
      accessorFn: (row) => row.nodeNames.join(","),
      header: "Titik",
      cell: (info) => <NodesCell nodes={info.row.original.nodeNames} />,
    },
    {
      id: "sensors",
      accessorFn: (row) => row.sensorCount,
      header: "Sensor",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {formatNumber(info.row.original.sensorCount)}
        </span>
      ),
    },
    {
      id: "stale",
      accessorFn: (row) => row.staleCount,
      header: "Basi",
      cell: (info) => {
        const stale = info.row.original.staleCount;
        return (
          <span
            className={cn(
              "font-mono text-xs tabular",
              stale > 0 ? "text-crit" : "text-ink-2",
            )}
          >
            {formatNumber(stale)}
          </span>
        );
      },
    },
    {
      id: "quality",
      accessorFn: (row) => row.worstQuality ?? "",
      header: "Kualitas",
      cell: (info) => (
        <StatusPill
          tone={sensorQualityTone(info.row.original.worstQuality)}
          label={sensorQualityLabel(info.row.original.worstQuality)}
        />
      ),
    },
    {
      id: "last_seen",
      accessorFn: (row) => row.lastSeenIso ?? "",
      header: "Terakhir terlihat",
      cell: (info) => {
        const iso = info.row.original.lastSeenIso;
        return (
          <span
            title={LAST_SEEN_TITLE}
            className="font-mono text-xs text-ink-2 tabular"
          >
            {iso === null ? "—" : `${formatAgeFrom(iso, now)} lalu`}
          </span>
        );
      },
    },
  ];
}

export interface DeviceTableProps {
  readonly devices: readonly DeviceSummary[];
  readonly now: number;
  readonly isLoading?: boolean;
  readonly className?: string;
}

export function DeviceTable({
  devices,
  now,
  isLoading = false,
  className,
}: DeviceTableProps) {
  return (
    <DataTable
      columns={buildColumns(now)}
      data={[...devices]}
      isLoading={isLoading}
      getRowId={(device) => device.deviceId}
      emptyTitle="Belum ada perangkat"
      emptyDescription="Perangkat muncul di sini setelah mengirim telemetri pertama lewat MQTT."
      className={cn(className)}
    />
  );
}