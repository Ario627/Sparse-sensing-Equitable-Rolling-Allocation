const TITLE = "SERA";
const TAGLINE = "Kendali aliran irigasi";

export interface BrandMarkProps {
  readonly inverse?: boolean;
}

export function BrandMark({ inverse = false }: BrandMarkProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-sm bg-water text-surface shadow-hair"
      >
        <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
          <g stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 6.5h16" />
            <path d="M4 12h10.5" />
            <path d="M4 17.5h5" />
          </g>
        </svg>
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={`font-display text-lg leading-none font-semibold tracking-tight ${inverse ? "text-surface" : "text-ink"}`}
        >
          {TITLE}
        </span>
        <span
          className={`mt-0.5 truncate text-2xs ${inverse ? "text-surface/60" : "text-ink-3"}`}
        >
          {TAGLINE}
        </span>
      </span>
    </div>
  );
}
