import { useId, useState } from "react";
import { cn } from "@/lib/cn.ts";

const HOUR_MS = 3_600_000;
const JAKARTA_OFFSET = "+07:00";
const DEFAULT_CUSTOM_MS = 24 * HOUR_MS;

export interface TimeRange {
  readonly from: string;
  readonly to: string;
}

export type TimeRangePreset = "all" | "24h" | "7d" | "30d" | "custom";

const presetMs: Record<Exclude<TimeRangePreset, "all" | "custom">, number> = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
};

const presetLabels: Record<TimeRangePreset, string> = {
  all: "Semua",
  "24h": "24 jam",
  "7d": "7 hari",
  "30d": "30 hari",
  custom: "Kustom",
};

const PRESET_ORDER: readonly TimeRangePreset[] = [
  "all",
  "24h",
  "7d",
  "30d",
  "custom",
];

const jakartaFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function jakartaInputValue(iso: string): string {
  const parts = jakartaFormatter.formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
}

function jakartaInputToIso(value: string): string | null {
  const parsed = new Date(`${value}:00${JAKARTA_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface TimeRangePickerProps {
  readonly value: TimeRange | null;
  readonly onChange: (value: TimeRange | null) => void;
  readonly now?: number;
  readonly className?: string;
}

export function TimeRangePicker({
  value,
  onChange,
  now,
  className,
}: TimeRangePickerProps) {
  const [preset, setPreset] = useState<TimeRangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const fromId = useId();
  const toId = useId();

  function resolveNow(): number {
    return now ?? Date.now();
  }

  function applyPreset(next: TimeRangePreset): void {
    setPreset(next);
    setCustomError(null);
    if (next === "all") {
      onChange(null);
      return;
    }
    if (next === "custom") {
      const base = value ?? {
        from: new Date(resolveNow() - DEFAULT_CUSTOM_MS).toISOString(),
        to: new Date(resolveNow()).toISOString(),
      };
      setCustomFrom(jakartaInputValue(base.from));
      setCustomTo(jakartaInputValue(base.to));
      onChange(base);
      return;
    }
    const reference = resolveNow();
    onChange({
      from: new Date(reference - presetMs[next]).toISOString(),
      to: new Date(reference).toISOString(),
    });
  }

  function commitCustom(fromValue: string, toValue: string): void {
    const fromIso = jakartaInputToIso(fromValue);
    const toIso = jakartaInputToIso(toValue);
    if (fromIso === null || toIso === null) {
      setCustomError("Lengkapi kedua waktu terlebih dahulu.");
      return;
    }
    if (Date.parse(fromIso) > Date.parse(toIso)) {
      setCustomError("Waktu selesai harus setelah waktu mulai.");
      return;
    }
    setCustomError(null);
    onChange({ from: fromIso, to: toIso });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="group"
        aria-label="Rentang waktu"
        className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-sm border border-line-2 bg-sunk p-0.5"
      >
        {PRESET_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === preset}
            onClick={() => {
              applyPreset(option);
            }}
            className={cn(
              "h-7 rounded-xs px-2.5 text-xs font-medium transition-colors",
              option === preset
                ? "bg-surface text-ink shadow-hair"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {presetLabels[option]}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex flex-col gap-2">
          <div className="grid gap-3 xs:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fromId} className="text-xs font-medium text-ink-2">
                Dari (WIB)
              </label>
              <input
                id={fromId}
                type="datetime-local"
                value={customFrom}
                onChange={(event) => {
                  setCustomFrom(event.target.value);
                  commitCustom(event.target.value, customTo);
                }}
                className="h-9 w-full rounded-sm border border-input bg-surface px-2.5 text-sm text-ink"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={toId} className="text-xs font-medium text-ink-2">
                Sampai (WIB)
              </label>
              <input
                id={toId}
                type="datetime-local"
                value={customTo}
                onChange={(event) => {
                  setCustomTo(event.target.value);
                  commitCustom(customFrom, event.target.value);
                }}
                className="h-9 w-full rounded-sm border border-input bg-surface px-2.5 text-sm text-ink"
              />
            </div>
          </div>
          {customError !== null && (
            <p role="alert" className="text-xs text-crit">
              {customError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}