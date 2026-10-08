import type { ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export interface PageHeaderProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  leading,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("min-w-0", className)}>
      {leading !== undefined && <div className="mb-2">{leading}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {eyebrow !== undefined && (
            <p className="label-caps text-water">{eyebrow}</p>
          )}
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {title}
          </h1>
          {description !== undefined && (
            <p className="mt-1 max-w-prose text-sm text-ink-2">{description}</p>
          )}
        </div>
        {actions !== undefined && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
      <div className="rule-staff mt-4" aria-hidden="true" />
    </header>
  );
}