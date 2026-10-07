import type { ReactNode } from "react";
import { IconAlert, IconChevronDown } from "@/components/icons.tsx";
import { cn } from "@/lib/cn.ts";

const DEFAULT_TITLE = "Mode fallback aktif";

export interface FallbackBannerProps {
  readonly reason: string;
  readonly title?: string;
  readonly detail?: ReactNode;
  readonly className?: string;
}

function BannerMark({
  title,
  reason,
}: {
  readonly title: string;
  readonly reason: string;
}) {
  return (
    <span className="flex min-w-0 items-start gap-2.5">
      <IconAlert size={16} className="mt-0.5 shrink-0 text-fallback-deep" />
      <span className="min-w-0">
        <span className="label-caps block text-fallback-deep">{title}</span>
        <span className="mt-0.5 block text-sm text-ink">{reason}</span>
      </span>
    </span>
  );
}

export function FallbackBanner({
  reason,
  title = DEFAULT_TITLE,
  detail,
  className,
}: FallbackBannerProps) {
  if (detail === undefined) {
    return (
      <aside
        className={cn(
          "rounded-md border border-fallback/35 bg-fallback-soft px-3.5 py-3",
          className,
        )}
      >
        <BannerMark title={title} reason={reason} />
      </aside>
    );
  }
  return (
    <details
      className={cn(
        "group rounded-md border border-fallback/35 bg-fallback-soft",
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <BannerMark title={title} reason={reason} />
        <IconChevronDown
          size={16}
          className="mt-0.5 shrink-0 text-fallback-deep transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-fallback/25 px-3.5 py-3">{detail}</div>
    </details>
  );
}