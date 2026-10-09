import { cn } from "@/lib/cn.ts";

const TEXT_LINES = [
  { key: "lead", width: "w-full" },
  { key: "body-a", width: "w-full" },
  { key: "body-b", width: "w-11/12" },
  { key: "body-c", width: "w-full" },
  { key: "body-d", width: "w-5/6" },
  { key: "tail", width: "w-2/3" },
] as const;

export interface SkeletonProps {
  readonly className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("block animate-pulse-soft rounded-xs bg-sunk", className)}
    />
  );
}

export interface SkeletonTextProps {
  readonly lines?: number;
  readonly className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const visible = TEXT_LINES.slice(0, Math.min(lines, TEXT_LINES.length));
  return (
    <span aria-hidden="true" className={cn("block space-y-2", className)}>
      {visible.map((line) => (
        <Skeleton key={line.key} className={cn("h-3", line.width)} />
      ))}
    </span>
  );
}
