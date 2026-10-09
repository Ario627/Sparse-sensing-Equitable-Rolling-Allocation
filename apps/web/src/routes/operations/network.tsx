import type { Topology } from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/button.tsx";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
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
import { formatCappedPercent, formatNumber } from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const TICK_MS = 30_000;
const CANVAS_HEIGHT = "clamp(30rem, 82vh, 60rem)";
const SKELETON_KEYS = ["rasio", "sensor", "blok"] as const;

const topologyLabels: Record<Topology, string> = {
  CHAIN: "Rantai",
  BRANCHED: "Bercabang",
  MIXED: "Campuran",
};

interface LegendItem {
  readonly label: string;
  readonly className: string;
}

const legendItems: readonly LegendItem[] = [
  { label: "Aman", className: "bg-ok" },
  { label: "Cukup", className: "bg-warn" },
  { label: "Kritis", className: "bg-crit" },
];

function LegendChip({ label, className }: LegendItem) {
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-ink-2">
      <span aria-hidden="true" className={cn("h-1.5 w-4 rounded-xs", className)} />
      {label}
    </span>
  );
}

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
          {info.row.original.zone === null ? "—" : zoneLabel(info.row.original.zone)}
        </span>
      ),
    },
    {
      id: "ratio",
      accessorFn: (row) => row.serviceRatio,
      header: "Rasio",
      cell: (info) => (
        <span className="font-mono text-xs text-ink tabular">
          {formatCappedPercent(info.row.original.serviceRatio)}
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
            {sensors.staleCount > 0 ? ` · ${formatNumber(sensors.staleCount)} basi` : ""}
          </span>
        );
      },
    },
  ];
}

interface CanvasPanelProps {
  readonly children: ReactNode;
  readonly nodeCount: number;
  readonly blockCount: number;
  readonly averageRatio: string;
  readonly weakestName: string | null;
  readonly sensorCount: number;
  readonly staleCount: number;
  readonly selected: boolean;
}

function CanvasPanel({
  children,
  nodeCount,
  blockCount,
  averageRatio,
  weakestName,
  sensorCount,
  staleCount,
  selected,
}: CanvasPanelProps) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-hair">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <p className="label-caps text-water">Peta jaringan</p>
          <InfoDialog
            label="Keterangan"
            eyebrow="Peta jaringan"
            title="Membaca peta jaringan"
            triggerClassName="border border-line-2 bg-surface"
          >
            <div className="flex flex-col gap-3">
              <p>
                Titik-titik pada latar adalah kisi penggambar. Kotak paling atas adalah
                intake, kotak abu-abu adalah pertemuan atau pintu air, dan kartu berwarna
                adalah blok layanan.
              </p>
              <p>
                Kartu blok memuat rasio layanan, luas, debit rencana, dan keadaan
                sensornya. Warna tepi kartu mengikuti status layanan blok tersebut.
              </p>
              <p>
                Jarum kanal yang berjalan dan berwarna air menandakan pintu blok sedang
                dibuka; jalur yang redup menandakan pintu tertutup.
              </p>
              <p>
                Klik kartu blok untuk membuka rinciannya pada panel samping. Gunakan
                kendali di kiri bawah untuk memperbesar, memperkecil, atau memasangkan
                seluruh jaringan ke layar.
              </p>
            </div>
          </InfoDialog>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legendItems.map((item) => (
            <LegendChip key={item.label} {...item} />
          ))}
          <span className="hidden items-center gap-1.5 text-2xs text-ink-3 sm:inline-flex">
            <span aria-hidden="true" className="h-px w-4 bg-water" />
            pintu dibuka
          </span>
          {!selected && (
            <span className="hidden text-2xs text-ink-3 md:inline">
              klik kartu blok untuk membuka rinciannya
            </span>
          )}
        </div>
      </div>
      {children}
      <div className="grid grid-cols-2 divide-line border-t border-line md:grid-cols-4 md:divide-x">
        <div className="flex flex-col px-5 py-3.5">
          <p className="label-caps text-ink-3">Rasio layanan</p>
          <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink tabular">
            {averageRatio}
          </p>
          <p className="mt-1 truncate text-2xs text-ink-3">
            {weakestName === null ? "belum ada plan" : `terendah ${weakestName}`}
          </p>
        </div>
        <div className="flex flex-col px-5 py-3.5">
          <p className="label-caps text-ink-3">Titik sensor</p>
          <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink tabular">
            {formatNumber(sensorCount)}
          </p>
          <p className="mt-1 text-2xs text-ink-3">
            {staleCount > 0 ? `${formatNumber(staleCount)} basi` : "semua segar"}
          </p>
        </div>
        <div className="flex flex-col px-5 py-3.5">
          <p className="label-caps text-ink-3">Blok</p>
          <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink tabular">
            {formatNumber(blockCount)}
          </p>
          <p className="mt-1 text-2xs text-ink-3">titik layanan terdaftar</p>
        </div>
        <div className="flex flex-col px-5 py-3.5">
          <p className="label-caps text-ink-3">Titik jaringan</p>
          <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink tabular">
            {formatNumber(nodeCount)}
          </p>
          <p className="mt-1 text-2xs text-ink-3">simpul pada topologi</p>
        </div>
      </div>
    </section>
  );
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
        <Skeleton className="h-[32rem]" />
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
        {...(detail === null
          ? {}
          : {
              description: `${topologyLabels[detail.topology]} · ${formatNumber(detail.node_count)} titik · ${formatNumber(detail.block_count)} blok`,
            })}
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
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))]">
            {SKELETON_KEYS.map((key) => (
              <Skeleton key={key} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-105" />
        </div>
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-[minmax(0,1fr)] gap-4",
              selected !== null && "xl:grid-cols-[minmax(0,1fr)_22rem]",
            )}
          >
            <CanvasPanel
              nodeCount={detail?.node_count ?? view.flow.nodes.length}
              blockCount={view.summary.blockCount}
              averageRatio={formatCappedPercent(view.summary.averageServiceRatio)}
              weakestName={view.summary.weakestBlockName}
              sensorCount={view.summary.sensorCount}
              staleCount={view.summary.staleSensorCount}
              selected={selected !== null}
            >
              <NetworkCanvas
                flow={view.flow}
                height={CANVAS_HEIGHT}
                className="rounded-none border-0"
                onBlockSelect={selectBlock}
              />
            </CanvasPanel>
            {selected !== null && (
              <div className="xl:sticky xl:top-24 xl:self-start">
                <BlockInspector
                  block={selected}
                  className="rounded-xl"
                  onClose={() => {
                    selectBlock(null);
                  }}
                />
              </div>
            )}
          </div>
          <DataTable
            columns={columns}
            data={[...view.blocks]}
            getRowId={(block) => block.blockId}
            emptyTitle="Belum ada blok"
            emptyDescription="Jaringan ini belum memiliki blok terdaftar."
          />
        </>
      )}
    </div>
  );
}
