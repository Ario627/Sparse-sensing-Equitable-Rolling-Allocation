import { cn } from "@/lib/cn.ts";

export type Tone = "ok" | "warn" | "crit" | "fallback" | "info" | "neutral";

type PillSize = "sm" | "md";

interface StatusPillProps {
  readonly tone: Tone;
  readonly label: string;
  readonly size?: PillSize;
  readonly className?: string;
}

const toneClasses: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok-soft text-ok",
  warn: "border-warn/40 bg-warn-soft text-warn",
  crit: "border-crit/40 bg-crit-soft text-crit",
  fallback: "border-fallback/40 bg-fallback-soft text-fallback",
  info: "border-info/40 bg-info-soft text-info",
  neutral: "border-line-2 bg-sunk text-ink-2",
};

const sizeClasses: Record<PillSize, string> = {
  sm: "px-2 py-0.5",
  md: "px-2.5 py-1",
};

export function StatusPill({ tone, label, size = "sm", className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border label-caps",
        sizeClasses[size],
        toneClasses[tone],
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
