import * as m from "motion/react-m";
import { Component, lazy, type ReactNode, Suspense, useState } from "react";
import { LinkButton, linkButtonClass } from "@/components/shell/link-button.tsx";
import { cn } from "@/lib/cn.ts";
import { usePrefersReducedMotion } from "@/lib/hooks.ts";
import { VIEWPOINT_ORDER, VIEWPOINTS, type ViewpointId } from "./paddy/paddy-layout.ts";
import { PaddyMap } from "./paddy/paddy-map.tsx";

const PaddyScene = lazy(() =>
  import("./paddy/paddy-scene.tsx").then((module) => ({
    default: module.PaddyScene,
  })),
);

const EYEBROW = "Sparse-sensing Equitable Rolling Allocation";
const TITLE = "Baca aliran. Jaga giliran.";
const DESCRIPTION =
  "Estimasi jaringan, memori layanan blok, dan optimasi bergulir — ditinjau operator sebelum perintah pintu dikirim.";

const SCENE_CAPTION = "Model contoh, bukan data lapangan.";
const MAP_CAPTION = "Peta contoh. Klik zona untuk menyorot.";

type ViewMode = "peta" | "3d";

const HERO_STATS = [
  { label: "Blok", value: "6–20" },
  { label: "Sensor", value: "1–5 titik" },
  { label: "Profil alokasi", value: "3" },
] as const;

function SceneFallback() {
  return (
    <div className="grid h-full w-full place-items-center bg-[#e9f2f4]">
      <span className="label-caps text-ink-3">Menyiapkan diorama</span>
    </div>
  );
}

interface SceneBoundaryProps {
  readonly children: ReactNode;
}

interface SceneBoundaryState {
  readonly failed: boolean;
}

class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  override state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <SceneFallback />;
    }
    return this.props.children;
  }
}

const VIEWPOINT_SHORT: Record<ViewpointId, string> = {
  overview: "Jaringan",
  source: "Sumber",
  head: "Hulu",
  middle: "Tengah",
  tail: "Hilir",
};

const chipBase =
  "h-7 rounded-xs border px-2.5 font-mono text-2xs tracking-[0.06em] uppercase transition-colors";
const chipActive = "border-water/50 bg-water-soft text-water-deep";
const chipIdle =
  "border-line-2 bg-surface text-ink-2 hover:border-ink-3/40 hover:text-ink";

interface ViewpointChipsProps {
  readonly value: ViewpointId;
  readonly onChange: (id: ViewpointId) => void;
}

function ViewpointChips({ value, onChange }: ViewpointChipsProps) {
  return (
    <fieldset aria-label="Sudut kamera" className="flex flex-wrap items-center gap-1">
      {VIEWPOINT_ORDER.map((id) => (
        <m.button
          key={id}
          type="button"
          aria-pressed={id === value}
          whileTap={{ scale: 0.94 }}
          onClick={() => {
            onChange(id);
          }}
          className={cn(chipBase, id === value ? chipActive : chipIdle)}
        >
          {VIEWPOINT_SHORT[id]}
        </m.button>
      ))}
    </fieldset>
  );
}

const VIEW_MODES: readonly { readonly id: ViewMode; readonly label: string }[] = [
  { id: "peta", label: "Peta" },
  { id: "3d", label: "3D" },
];

const modeBase =
  "h-6 rounded-xs px-2 font-mono text-2xs tracking-[0.06em] uppercase transition-colors";
const modeActive = "bg-surface text-ink shadow-hair";
const modeIdle = "text-ink-2 hover:text-ink";

interface ModeToggleProps {
  readonly value: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
}

function ModeToggle({ value, onChange }: ModeToggleProps) {
  return (
    <fieldset
      aria-label="Mode tampilan"
      className="inline-flex items-center gap-0.5 rounded-sm border border-line-2 bg-sunk p-0.5"
    >
      {VIEW_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          aria-pressed={mode.id === value}
          onClick={() => {
            onChange(mode.id);
          }}
          className={cn(modeBase, mode.id === value ? modeActive : modeIdle)}
        >
          {mode.label}
        </button>
      ))}
    </fieldset>
  );
}

function RegistrationMarks() {
  const corners = [
    "-top-1 -left-1",
    "-top-1 -right-1",
    "-bottom-1 -left-1",
    "-bottom-1 -right-1",
  ] as const;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {corners.map((position) => (
        <span key={position} className={`absolute size-2 ${position}`}>
          <span className="absolute top-1/2 left-0 h-px w-full bg-line-2" />
          <span className="absolute top-0 left-1/2 h-full w-px bg-line-2" />
        </span>
      ))}
    </span>
  );
}

export interface LandingHeroProps {
  readonly authed: boolean;
}

export function LandingHero({ authed }: LandingHeroProps) {
  const [viewpoint, setViewpoint] = useState<ViewpointId>("overview");
  const [mode, setMode] = useState<ViewMode>("peta");
  const reducedMotion = usePrefersReducedMotion();
  return (
    <section className="relative isolate overflow-hidden border-b border-line bg-[#e9f2f4]">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-grid" />
      <div className="mx-auto grid max-w-shell gap-7 px-4 py-9 sm:px-6 sm:py-11 lg:grid-cols-[minmax(17rem,0.7fr)_minmax(0,1.3fr)] lg:items-center lg:gap-12 lg:px-10 lg:py-14">
        <div className="relative z-10">
          <p className="label-caps animate-rise text-water-deep">{EYEBROW}</p>
          <h1 className="mt-4 max-w-[14ch] animate-rise text-4xl leading-[1.02] font-semibold tracking-tight text-ink [animation-delay:60ms] sm:text-5xl lg:text-6xl">
            {TITLE}
          </h1>
          <p className="mt-5 max-w-120 animate-rise text-base leading-relaxed text-ink-2 [animation-delay:120ms]">
            {DESCRIPTION}
          </p>
          <div className="mt-7 flex animate-rise flex-wrap items-center gap-3 [animation-delay:180ms]">
            <LinkButton to={authed ? "/operations" : "/login"} variant="primary">
              {authed ? "Lihat kondisi jaringan" : "Masuk ke SERA"}
            </LinkButton>
            <a href="#cara-kerja" className={linkButtonClass("outline", "md")}>
              Cara kerja
            </a>
          </div>
          <dl className="mt-9 grid animate-rise grid-cols-3 gap-x-4 border-t border-line-2/70 pt-4 [animation-delay:240ms]">
            {HERO_STATS.map((stat) => (
              <div key={stat.label} className="flex min-w-0 flex-col gap-1">
                <dt className="label-caps text-ink-3">{stat.label}</dt>
                <dd className="font-mono text-xs font-medium text-ink tabular sm:text-sm">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="relative min-w-0 animate-rise [animation-delay:140ms]">
          <div className="relative border border-line-2 bg-surface">
            <RegistrationMarks />
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
              <span className="font-mono text-2xs tracking-[0.08em] text-ink-3 uppercase">
                {mode === "peta" ? "Peta jaringan" : "Model 3D"}
              </span>
              <ModeToggle value={mode} onChange={setMode} />
            </div>
            <div
              role="img"
              aria-label={
                mode === "peta"
                  ? `Peta jaringan tersier, sorotan: ${VIEWPOINTS[viewpoint].label}`
                  : `Model 3D jaringan tersier, sudut kamera: ${VIEWPOINTS[viewpoint].label}`
              }
              className="h-[300px] w-full sm:h-[380px] lg:h-[440px]"
            >
              {mode === "peta" ? (
                <PaddyMap
                  viewpoint={viewpoint}
                  onViewpointChange={setViewpoint}
                  className="p-1.5"
                />
              ) : (
                <SceneBoundary>
                  <Suspense fallback={<SceneFallback />}>
                    <PaddyScene
                      viewpoint={viewpoint}
                      onViewpointChange={setViewpoint}
                      reducedMotion={reducedMotion}
                      className="h-full w-full"
                    />
                  </Suspense>
                </SceneBoundary>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line px-2.5 py-2">
              <ViewpointChips value={viewpoint} onChange={setViewpoint} />
              <span className="font-mono text-2xs text-ink-3">
                {mode === "peta" ? MAP_CAPTION : SCENE_CAPTION}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
