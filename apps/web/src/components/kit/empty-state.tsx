import type { ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly compact?: boolean;
  readonly className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-14",
        className,
      )}
    >
      <span aria-hidden="true" className="rule-staff w-14" />
      <p className={cn("font-medium text-ink", compact ? "text-sm" : "text-base")}>
        {title}
      </p>
      {description !== undefined && (
        <p className={cn("max-w-sm text-ink-3", compact ? "text-xs" : "text-sm")}>
          {description}
        </p>
      )}
      {action !== undefined && (
        <div className={compact ? "mt-2" : "mt-3"}>{action}</div>
      )}
    </div>
  );
}