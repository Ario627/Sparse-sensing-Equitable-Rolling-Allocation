import { IconWater } from "@/components/icons.tsx";

const TITLE = "SERA";

export interface BrandMarkProps {
  readonly inverse?: boolean;
}

export function BrandMark({ inverse = false }: BrandMarkProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-md bg-water text-surface shadow-hair"
      >
        <IconWater size={18} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={`font-display text-lg leading-none font-semibold tracking-tight ${inverse ? "text-surface" : "text-ink"}`}
        >
          {TITLE}
        </span>
        <span
          className={`mt-0.5 truncate text-2xs ${inverse ? "text-surface/65" : "text-ink-3"}`}
        ></span>
      </span>
    </div>
  );
}
