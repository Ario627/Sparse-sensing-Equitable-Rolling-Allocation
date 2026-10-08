import type { Topology } from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/kit/button.tsx";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { MetricCard } from "@/components/kit/metric-card.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import { useNetwork, useNetworks } from "@/features/network/api.ts";
import { BlockInspector } from "@/features/network/block-inspector.tsx";
import { NetworkCanvas } from "@/features/network/network-canvas.tsx";
import type { BlockSummary } from "@/features/network/selectors.ts";
import { buildNetworkView, zoneLabel } from "@/features/network/selectors.ts";
import { usePlan, usePlans } from "@/features/scheduling/api.ts";
import { pickActionablePlan } from "@/features/scheduling/plan-selection.ts";
import { useLatestTelemetry } from "@/features/sensors/api.ts";
import { cn } from "@/lib/cn.ts";
import { formatNumber, formatPercent } from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const TICK_MS = 30_000;
const CANVAS_HEIGHT = 420;
const SKELETON_KEYS = ["rasio", "sensor", "blok"] as const;

const topologyLabels: Record<Topology, string> = {
  CHAIN: "Rantai",
  BRANCHED: "Bercabang",
  MIXED: "Campuran",
};

function buildBlockColumns(
  onSelect: (blockId: string) => void,
): SeraColumnDef<BlockSummary>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: "Blok",
      cell: (info) => (
        <button
          type="button"
          onClick={() => {
            onSelect(info.row.original.blockId);
          }}
          className="max-w-48 truncate text-left text-sm font-medium text-ink hover:text-water"
        >
          {info.row.original.name}
        </button>
      ),
    },
    {
      id: "zone",
      accessorFn: (row) => row.zone,
      header: "Zona",
      cell: (info) => (
        <span className="text-xs text-ink-2">
          {info.row.original.zone === null
            ? "—"
            : zoneLabel(info.row.original.zone)}
        </span>
      ),
    },
    {
      id: "ratio",
      accessorFn: (row) => row.serviceRatio,
      header: "Rasio",
      cell: (info) => (
        <span className="font-mono text-xs text-ink tabular">
          {info.row.original.serviceRatio === null
            ? "—"
            : formatPercent(info.row.original.serviceRatio)}
        </span>
      ),
    },
    {
      id: "band",
      accessorFn: (row) => row.band.label,
      header: "Status",
      cell: (info) => (
        <StatusPill
          tone={info.row.original.band.tone}
          label={info.row.original.band.label}
        />
      ),
    },
    {
      id: "sensors",
      accessorFn: (row) => row.sensors.sensorCount,
      header: "Sensor",
      cell: (info) => {
        const sensors = info.row.original.sensors;
        if (sensors.sensorCount === 0) {
          return <span className="text-xs text-ink-3">—</span>;
        }
        return (
          <span
            className={cn(
              "font-mono text-xs tabular",
              sensors.staleCount > 0 ? "text-crit" : "text-ink-2",
            )}
          >
            {formatNumber(sensors.sensorCount)}
            {sensors.staleCount > 0
              ? ` · ${formatNumber(sensors.staleCount)} basi`
              : ""}
          </span>
        );
      },
    },
  ];
}

export function NetworkPage() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const now = useNow(TICK_MS);
  const networksQuery = useNetworks({ limit: 50 });
  const networks = networksQuery.data?.items ?? [];
  const requestedId = readSearchString(search, "network");
  const networkId = requestedId ?? networks[0]?.id ?? null;
  const selectedId = readSearchString(search, "block");
  const networkQuery = useNetwork(networkId);
  const latestQuery = useLatestTelemetry(networkId);
  const plansQuery = usePlans(
    networkId === null ? {} : { network_id: networkId, limit: 20 },
  );
  const picked = pickActionablePlan(plansQuery.data?.items ?? []);
  const planQuery = usePlan(picked?.id ?? null);

  const detail = networkQuery.data ?? null;
  const telemetry = latestQuery.data?.items ?? [];
  const view =
    detail === null
      ? null
      : buildNetworkView({
          detail,
          telemetry,
          planItems: planQuery.data?.items ?? [],
          now,
        });
  const selected =
    view === null || selectedId === null
      ? null
      : (view.blocks.find((block) => block.blockId === selectedId) ?? null);
  const contentError = networkQuery.error ?? latestQuery.error;
  const columns = buildBlockColumns((blockId) => {
    selectBlock(blockId);
  });

  function selectBlock(blockId: string | null): void {
    navigate({
      to: "/operations/network",
      search: buildSearch({ network: networkId, block: blockId }),
      replace: true,
    });
  }

  function selectNetwork(nextId: string): void {
    navigate({
      to: "/operations/network",
      search: buildSearch({ network: nextId }),
    });
  }

  const networkSelect =
    networks.length > 1 ? (
      <select
        aria-label="Pilih jaringan"
        value={networkId ?? ""}
        onChange={(event) => {
          selectNetwork(event.target.value);
        }}
        className={cn(inputClass, "w-auto")}
      >
        {networks.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    ) : null;

  if (networksQuery.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Jaringan" />
        <Skeleton className="h-[420px]" />
      </div>
    );
  }

  if (networksQuery.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Jaringan" />
        <ErrorState
          error={networksQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void networksQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      </div>
    );
  }

  if (networks.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Jaringan" />
        <EmptyState
          title="Belum ada jaringan"
          description="Minta admin mendaftarkan jaringan irigasi sebelum memakai halaman operasi."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Operasi"
        title={detail?.name ?? "Jaringan"}
        description={
          detail === null
            ? "Memuat detail jaringan…"
            : `${topologyLabels[detail.topology]} · ${formatNumber(detail.node_count)} titik · ${formatNumber(detail.block_count)} blok`
        }
        actions={networkSelect}
      />
      {contentError !== null ? (
        <ErrorState
          error={contentError}
          action={
            <Button
              size="sm"
              onClick={() => {
                void networkQuery.refetch();
                void latestQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : view === null ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {SKELETON_KEYS.map((key) => (
                <Skeleton key={key} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-[420px]" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <MetricCard
                label="Rasio layanan"
                value={
                  view.summary.averageServiceRatio === null
                    ? "—"
                    : formatPercent(view.summary.averageServiceRatio)
                }
                note={
                  view.summary.weakestBlockName === null
                    ? "Belum ada slot plan"
                    : `Terendah: ${view.summary.weakestBlockName}`
                }
              />
              <MetricCard
                label="Titik sensor"
                value={formatNumber(view.summary.sensorCount)}
                note={
                  view.summary.staleSensorCount > 0
                    ? `${formatNumber(view.summary.staleSensorCount)} basi`
                    : "Semua segar"
                }
              />
              <MetricCard
                label="Blok"
                value={formatNumber(view.summary.blockCount)}
              />
            </div>
            <NetworkCanvas
              flow={view.flow}
              height={CANVAS_HEIGHT}
              onBlockSelect={selectBlock}
            />
            <DataTable
              columns={columns}
              data={[...view.blocks]}
              getRowId={(block) => block.blockId}
              emptyTitle="Belum ada blok"
              emptyDescription="Jaringan ini belum memiliki blok terdaftar."
            />
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            {selected === null ? (
              <EmptyState
                compact
                title="Pilih blok"
                description="Klik blok di kanvas atau tabel untuk melihat detail."
                className="rounded-md border border-line bg-surface"
              />
            ) : (
              <BlockInspector
                block={selected}
                onClose={() => {
                  selectBlock(null);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}