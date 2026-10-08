import { IconClose } from "@/components/icons.tsx";
import { Button } from "@/components/kit/button.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import { sensorQualityLabel, sensorQualityTone } from "@/features/sensors/status.ts";
import { cn } from "@/lib/cn.ts";
import {
  formatClockRange,
  formatDate,
  formatNumber,
  formatPercent,
  formatUnit,
} from "@/lib/format.ts";
import type { BlockSummary } from "./selectors.ts";
import { zoneLabel } from "./selectors.ts";

const MAX_REASON_NOTES = 6;

export interface BlockInspectorProps {
  readonly block: BlockSummary;
  readonly onClose?: () => void;
  readonly className?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readReasonNotes(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter(isNonEmptyString).slice(0, MAX_REASON_NOTES);
  }
  if (typeof value === "object" && value !== null) {
    const notes: string[] = [];
    for (const [key, entry] of Object.entries(value)) {
      if (isNonEmptyString(entry)) {
        notes.push(`${key}: ${entry}`);
      }
    }
    return notes.slice(0, MAX_REASON_NOTES);
  }
  return [];
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function MonoValue({ children }: { readonly children: React.ReactNode }) {
  return <span className="font-mono text-xs text-ink tabular">{children}</span>;
}

function SectionTitle({ children }: { readonly children: React.ReactNode }) {
  return <p className="label-caps text-ink-3">{children}</p>;
}

export function BlockInspector({
  block,
  onClose,
  className,
}: BlockInspectorProps) {
  const notes = readReasonNotes(block.slot === null ? null : block.slot.reasonJson);
  const slot = block.slot;
  const areaHa = block.areaM2 / 10_000;
  return (
    <aside
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-line bg-surface",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-3.5 py-3">
        <div className="min-w-0">
          <p className="label-caps text-ink-3">
            {block.zone === null ? "Blok" : `Blok · ${zoneLabel(block.zone)}`}
          </p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-ink">
            {block.name}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusPill tone={block.band.tone} label={block.band.label} />
          {onClose !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Tutup panel blok"
              onClick={onClose}
            >
              <IconClose size={14} />
            </Button>
          )}
        </div>
      </header>
      <div className="flex flex-col gap-4 px-3.5 py-3.5">
        <section className="flex flex-col gap-1.5">
          <SectionTitle>Layanan</SectionTitle>
          <dl className="flex flex-col gap-1.5">
            <Fact label="Rasio layanan">
              <MonoValue>
                {block.serviceRatio === null
                  ? "—"
                  : formatPercent(block.serviceRatio, 1)}
              </MonoValue>
            </Fact>
            <Fact label="Luas blok">
              <MonoValue>{formatUnit(areaHa, "ha", 2)}</MonoValue>
            </Fact>
            <Fact label="Debit nominal">
              <MonoValue>{formatUnit(block.nominalFlowLps, "L/s", 1)}</MonoValue>
            </Fact>
            <Fact label="Kualitas sensor">
              <StatusPill
                tone={sensorQualityTone(block.sensors.worstQuality)}
                label={sensorQualityLabel(block.sensors.worstQuality)}
              />
            </Fact>
            <Fact label="Sensor terpasang">
              <MonoValue>
                {block.sensors.sensorCount === 0
                  ? "—"
                  : `${formatNumber(block.sensors.sensorCount)}${
                      block.sensors.staleCount > 0
                        ? ` · ${formatNumber(block.sensors.staleCount)} basi`
                        : ""
                    }`}
              </MonoValue>
            </Fact>
          </dl>
        </section>
        {slot !== null && (
          <section className="flex flex-col gap-1.5">
            <SectionTitle>
              {slot.upcoming ? "Jadwal berikutnya" : "Jadwal terakhir"}
            </SectionTitle>
            <dl className="flex flex-col gap-1.5">
              <Fact label="Waktu">
                <MonoValue>
                  {formatDate(slot.slotStart)}{" "}
                  {formatClockRange(slot.slotStart, slot.slotEnd)}
                </MonoValue>
              </Fact>
              <Fact label="Perintah pintu">
                <MonoValue>{slot.gateOpen ? "Dibuka" : "Ditutup"}</MonoValue>
              </Fact>
              {slot.volumeDelM3 !== null && (
                <Fact label="Volume sampai">
                  <MonoValue>{formatUnit(slot.volumeDelM3, "m³", 1)}</MonoValue>
                </Fact>
              )}
              {slot.volumeGrossM3 !== null && (
                <Fact label="Volume dialokasikan">
                  <MonoValue>
                    {formatUnit(slot.volumeGrossM3, "m³", 1)}
                  </MonoValue>
                </Fact>
              )}
            </dl>
          </section>
        )}
        {notes.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <SectionTitle>Catatan alasan</SectionTitle>
            <ul className="flex flex-col gap-1">
              {notes.map((note) => (
                <li key={note} className="text-xs text-ink-2">
                  {note}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}