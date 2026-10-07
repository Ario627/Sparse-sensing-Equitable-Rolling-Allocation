import { IconClock } from "@/components/icons.tsx";
import { cn } from "@/lib/cn.ts";

const DEFAULT_LABEL = "Data stale";

export interface StaleBadgeProps {
  readonly age: string;
  readonly label?: string;
  readonly className?: string;
}

export function StaleBadge({
  age,
  label = DEFAULT_LABEL,
  className,
}: StaleBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-xs border border-crit/40 bg-crit-soft px-2 py-0.5 text-xs font-medium text-crit",
        className,
      )}
    >
      <IconClock size={13} />
      {label} · {age}
    </span>
  );
}