import { Button } from "@/components/kit/button.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import { MetricCard } from "@/components/kit/metric-card.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { useLatestTelemetry } from "@/features/sensors/api.ts";
import { DeviceTable } from "@/features/sensors/device-table.tsx";
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
        description="Status perangkat dari telemetri MQTT terakhir."
        actions={
          <InfoDialog
            label="Cara menyambung perangkat"
            eyebrow="MQTT"
            title="Kontrak perangkat"
            className="w-[min(40rem,calc(100vw-2rem))]"
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="label-caps text-ink-3">Topik</p>
                <ul className="flex flex-col gap-1 font-mono text-2xs text-ink-2">
                  <li>sera/&lt;situs&gt;/&lt;perangkat&gt;/telemetry</li>
                  <li>sera/&lt;situs&gt;/&lt;perangkat&gt;/status</li>
                  <li>sera/&lt;situs&gt;/&lt;perangkat&gt;/command</li>
                  <li>sera/&lt;situs&gt;/&lt;perangkat&gt;/command/ack</li>
                </ul>
              </div>
              <p>
                Perangkat mengirim satu pesan telemetri per siklus. Identitas pada topik
                dan pada isi pesan harus sama, nilai waktu memakai UTC, dan setiap bacaan
                wajib memakai id sensor yang sudah terdaftar beserta tipe dan satuannya.
              </p>
              <p>
                Perintah pintu datang pada topik command, lalu perangkat menjawab pada
                topik command/ack dengan status accepted, rejected, atau expired. Batas
                waktu jawaban dan toleransi posisi pintu ditentukan oleh konfigurasi API.
              </p>
              <p>
                Sensor yang tidak mengirim bacaan melewati ambang basi akan ditandai basi
                dan memicu peringatan, jadi perangkat sebaiknya juga mengirim status
                online saat tersambung.
              </p>
            </div>
          </InfoDialog>
        }
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
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))]">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))]">
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
                staleSensors > 0 ? "Perlu pemeriksaan lapangan" : "Semua dalam ambang"
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
