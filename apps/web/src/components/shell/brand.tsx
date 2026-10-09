import { IconWater } from "@/components/icons.tsx";

const TITLE = "SERA";
const SUBTITLE = "Alokasi irigasi tersier";

export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-sm bg-ink text-surface"
      >
        <IconWater size={18} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold tracking-tight text-ink">
          {TITLE}
        </span>
        <span className="truncate text-2xs text-ink-3">{SUBTITLE}</span>
      </span>
    </div>
  );
}
