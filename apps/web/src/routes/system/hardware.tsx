import { Button } from "@/components/kit/button.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { MetricCard } from "@/components/kit/metric-card.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { DeviceTable } from "@/features/sensors/device-table.tsx";
import { useLatestTelemetry } from "@/features/sensors/api.ts";
import { devicesFromLatest } from "@/features/sensors/status.ts";
import { formatAge, formatNumber } from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";

const TICK_MS = 30_000;

export function HardwarePage() {
  const now = useNow(TICK_MS);
  const latestQuery = useLatestTelemetry();
  const items = latestQuery.data?.items ?? [];
  const devices = devicesFromLatest(items);
  const staleSensors = items.filter((item) => item.stale).length;
  const firstReceived =
    items.length === 0
      ? null
      : items.reduce<string | null>((oldest, item) => {
          if (item.ts === null) {
            return oldest;
          }
          return oldest === null || Date.parse(item.ts) < Date.parse(oldest)
            ? item.ts
            : oldest;
        }, null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Sistem"
        title="Perangkat"
        description="Status perangkat keras dari telemetri MQTT terakhir. Demonstrator HIL dikenali sebagai perangkat biasa — tidak ada jalur data khusus."
      />
      {latestQuery.isError ? (
        <ErrorState
          error={latestQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void latestQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : latestQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Perangkat aktif"
              value={formatNumber(devices.length)}
              note="Mengirim telemetri dalam ambang basi"
            />
            <MetricCard
              label="Titik sensor"
              value={formatNumber(items.length)}
              note={
                firstReceived === null
                  ? "Belum ada telemetri"
                  : `Terlama ${formatAge((now - Date.parse(firstReceived)) / 1000)} lalu`
              }
            />
            <MetricCard
              label="Sensor basi"
              value={formatNumber(staleSensors)}
              note={
                staleSensors > 0
                  ? "Perlu pemeriksaan lapangan"
                  : "Semua dalam ambang"
              }
            />
            <MetricCard
              label="Ambang basi"
              value={
                latestQuery.data === undefined
                  ? "—"
                  : String(latestQuery.data.stale_threshold_s)
              }
              unit="dtk"
              note="Dari konfigurasi API"
            />
          </div>
          <DeviceTable devices={devices} now={now} />
        </>
      )}
    </div>
  );
}