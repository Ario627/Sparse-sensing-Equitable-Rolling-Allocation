const timeZone = "Asia/Jakarta";

export interface EstimateInterval {
  readonly low: number;
  readonly high: number;
}

const clockFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone,
  day: "numeric",
  month: "short",
});

const formatterCache = new Map<string, Intl.NumberFormat>();

function cachedFormatter(
  key: string,
  create: () => Intl.NumberFormat,
): Intl.NumberFormat {
  const existing = formatterCache.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = create();
  formatterCache.set(key, created);
  return created;
}

function decimalFormatter(
  digits: number,
  signDisplay: Intl.NumberFormatOptions["signDisplay"],
): Intl.NumberFormat {
  return cachedFormatter(
    `decimal:${digits}:${signDisplay}`,
    () =>
      new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay,
      }),
  );
}

function percentFormatter(digits: number): Intl.NumberFormat {
  return cachedFormatter(
    `percent:${digits}`,
    () =>
      new Intl.NumberFormat("id-ID", {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
  );
}

export function formatNumber(value: number, digits = 0): string {
  return decimalFormatter(digits, "auto").format(value);
}

export function formatSigned(value: number, digits = 0): string {
  return decimalFormatter(digits, "exceptZero").format(value);
}

export function formatPercent(ratio: number, digits = 0): string {
  return percentFormatter(digits).format(ratio);
}

export function formatCappedPercent(ratio: number | null, digits = 0): string {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "—";
  }
  const capped = Math.min(1, Math.max(0, ratio));
  const base = formatPercent(capped, digits);
  return ratio > 1 ? `${base}+` : base;
}

export function formatUnit(value: number, unit: string, digits = 1): string {
  return `${formatNumber(value, digits)} ${unit}`;
}

export function formatInterval(interval: EstimateInterval, digits = 2): string {
  return `${formatNumber(interval.low, digits)}–${formatNumber(interval.high, digits)}`;
}

export function formatEstimate(
  value: number,
  interval: EstimateInterval | null,
  digits = 2,
): string {
  const point = formatNumber(value, digits);
  return interval === null ? point : `${point} [${formatInterval(interval, digits)}]`;
}

export function formatClockMs(ms: number): string {
  const parts = clockFormatter.formatToParts(new Date(ms));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function formatClock(iso: string): string {
  return formatClockMs(Date.parse(iso));
}

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return `${shortDateFormatter.format(new Date(iso))} ${formatClock(iso)}`;
}

export function formatClockRange(fromIso: string, toIso: string): string {
  return `${formatClock(fromIso)}–${formatClock(toIso)}`;
}

export function formatAge(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds));
  if (clamped < 60) {
    return `${clamped} dtk`;
  }
  const minutes = Math.floor(clamped / 60);
  if (minutes < 60) {
    return `${minutes} mnt`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours} j`;
  }
  return `${Math.floor(hours / 24)} hr`;
}

export function formatAgeFrom(iso: string, now: number = Date.now()): string {
  return formatAge((now - Date.parse(iso)) / 1000);
}

export function formatDurationMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) {
    return `${rest} mnt`;
  }
  return rest === 0 ? `${hours} j` : `${hours} j ${rest} mnt`;
}
