const HOUR_MS = 3_600_000;
const MIN_SPAN_MS = 60_000;
const MAX_TICKS = 12;
const MAX_TICK_STEPS = 400;
const DEFAULT_PAD_RATIO = 0.04;
const TICK_STEPS_H = [1, 2, 3, 4, 6, 12, 24, 48, 72, 168] as const;

export interface TimelineDomain {
  readonly startMs: number;
  readonly endMs: number;
  readonly spanMs: number;
}

export function percentOf(ms: number, domain: TimelineDomain): number {
  if (!Number.isFinite(ms) || domain.spanMs <= 0) {
    return 0;
  }
  const percent = ((ms - domain.startMs) / domain.spanMs) * 100;
  return Math.min(100, Math.max(0, percent));
}

function pickStepHours(spanMs: number): number | null {
  for (const step of TICK_STEPS_H) {
    if (spanMs / (step * HOUR_MS) <= MAX_TICKS) {
      return step;
    }
  }
  return null;
}

export function buildTimelineDomain(
  spans: readonly (readonly [number, number])[],
  nowMs: number,
  padRatio: number = DEFAULT_PAD_RATIO,
): TimelineDomain {
  let min = nowMs;
  let max = nowMs;
  for (const [from, to] of spans) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      continue;
    }
    min = Math.min(min, from, to);
    max = Math.max(max, from, to);
  }
  let spanMs = max - min;
  if (spanMs < MIN_SPAN_MS) {
    const mid = (min + max) / 2;
    min = mid - MIN_SPAN_MS / 2;
    max = mid + MIN_SPAN_MS / 2;
    spanMs = MIN_SPAN_MS;
  }
  const pad = spanMs * Math.max(0, padRatio);
  return {
    startMs: min - pad,
    endMs: max + pad,
    spanMs: spanMs + pad * 2,
  };
}

export function hourTicks(domain: TimelineDomain): readonly number[] {
  const stepHours = pickStepHours(domain.spanMs);
  if (stepHours === null) {
    return [];
  }
  const stepMs = stepHours * HOUR_MS;
  const first = Math.ceil(domain.startMs / stepMs) * stepMs;
  const ticks: number[] = [];
  for (
    let ms = first;
    ms <= domain.endMs && ticks.length < MAX_TICK_STEPS;
    ms += stepMs
  ) {
    ticks.push(ms);
  }
  return ticks;
}
