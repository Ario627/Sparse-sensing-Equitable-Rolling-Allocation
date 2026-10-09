import * as m from "motion/react-m";
import { linkButtonClass } from "@/components/shell/link-button.tsx";
import { LinkButton } from "@/components/shell/link-button.tsx";
import { ReliefCanvas } from "@/components/viz/relief-canvas.tsx";
import type {
  TerrainBlock,
  TerrainFlowPoint,
  TerrainTone,
} from "@/lib/gl/terrain.ts";

const CANVAS_HEIGHT = 360;
const ROW_COUNTS = [1, 3, 3, 3, 3] as const;
const X_SPACING = 0.62;
const Z_SPACING = 0.6;
const HEIGHT_HEAD = 0.9;
const HEIGHT_TAIL = 0.35;

const EASE_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

const EYEBROW = "Pendukung keputusan · irigasi tersier";
const TITLE = "Seberapa sedikit sensor yang masih cukup?";
const DESCRIPTION =
  "SERA mengestimasi kondisi jaringan yang tidak terukur, mengingat pelayanan tiap blok, lalu mengoptimalkan alokasi air secara bergulir — dengan keputusan akhir tetap di tangan operator.";
const SCENE_CAPTION =
  "Model jaringan contoh — bukan data lapangan. Tinggi blok mengikuti debit nominal; pulsa menandai aliran dari sumber menuju blok.";

const zoneDots: Record<TerrainTone, string> = {
  water: "bg-water",
  ok: "bg-ok",
  neutral: "bg-ink-3",
  warn: "bg-warn",
  crit: "bg-crit",
  fallback: "bg-fallback",
};

const ZONE_LEGEND: readonly { readonly tone: TerrainTone; readonly label: string }[] = [
  { tone: "water", label: "Hulu" },
  { tone: "ok", label: "Tengah" },
  { tone: "neutral", label: "Hilir" },
];

const HERO_STATS = [
  { label: "Jaringan", value: "6–20 blok" },
  { label: "Sensing", value: "1–5 titik" },
  { label: "Kebijakan", value: "3 profil" },
  { label: "Bentuk", value: "2 GUI · 1 mesin" },
] as const;

interface HeroScene {
  readonly blocks: readonly TerrainBlock[];
  readonly flow: readonly TerrainFlowPoint[];
}

function rowTone(row: number): TerrainTone {
  if (row <= 1) {
    return "water";
  }
  if (row <= 3) {
    return "ok";
  }
  return "neutral";
}

function buildHeroScene(): HeroScene {
  const rows = ROW_COUNTS.length;
  const total = ROW_COUNTS.reduce((sum, count) => sum + count, 0);
  const totalZ = (rows - 1) * Z_SPACING;
  const blocks: TerrainBlock[] = [];
  const flow: TerrainFlowPoint[] = [];
  let index = 0;
  ROW_COUNTS.forEach((count, row) => {
    const z = row * Z_SPACING - totalZ / 2;
    const tone = rowTone(row);
    const centerIndex = Math.floor((count - 1) / 2);
    for (let column = 0; column < count; column += 1) {
      const x = (column - (count - 1) / 2) * X_SPACING;
      const fraction = total <= 1 ? 0 : index / (total - 1);
      blocks.push({
        id: `hero-${index}`,
        x,
        z,
        height: HEIGHT_HEAD + (HEIGHT_TAIL - HEIGHT_HEAD) * fraction,
        tone,
      });
      if (column === centerIndex) {
        flow.push({ x, z });
      }
      index += 1;
    }
  });
  return { blocks, flow };
}

const HERO_SCENE = buildHeroScene();

function enterProps(delay: number) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay, ease: EASE_QUART },
  };
}

function ZoneLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {ZONE_LEGEND.map((item) => (
        <span key={item.tone} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-2 rounded-[1px] ${zoneDots[item.tone]}`}
          />
          <span className="label-caps text-ink-3">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

export interface LandingHeroProps {
  readonly authed: boolean;
}

export function LandingHero({ authed }: LandingHeroProps) {
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:items-center lg:gap-12 lg:py-16">
        <div>
          <m.p className="label-caps text-water" {...enterProps(0)}>
            {EYEBROW}
          </m.p>
          <m.h1
            className="mt-2 text-3xl leading-tight font-semibold tracking-tight text-balance text-ink sm:text-4xl"
            {...enterProps(0.06)}
          >
            {TITLE}
          </m.h1>
          <m.p
            className="mt-4 max-w-xl text-sm leading-relaxed text-ink-2 sm:text-base"
            {...enterProps(0.12)}
          >
            {DESCRIPTION}
          </m.p>
          <m.div
            className="mt-6 flex flex-wrap items-center gap-2.5"
            {...enterProps(0.18)}
          >
            <LinkButton
              to={authed ? "/operations" : "/login"}
              variant="primary"
            >
              {authed ? "Buka Operasi" : "Masuk ke aplikasi"}
            </LinkButton>
            <a href="#cara-kerja" className={linkButtonClass("outline", "md")}>
              Lihat cara kerjanya
            </a>
          </m.div>
          <m.dl
            className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4"
            {...enterProps(0.24)}
          >
            {HERO_STATS.map((stat) => (
              <div key={stat.label} className="flex flex-col gap-0.5">
                <dt className="label-caps text-ink-3">{stat.label}</dt>
                <dd className="font-mono text-sm font-medium text-ink tabular">
                  {stat.value}
                </dd>
              </div>
            ))}
          </m.dl>
        </div>
        <m.div
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE_QUART }}
        >
          <ReliefCanvas
            blocks={HERO_SCENE.blocks}
            flow={HERO_SCENE.flow}
            height={CANVAS_HEIGHT}
            autoRotate
            interactive={false}
            label={`Model jaringan contoh dengan ${HERO_SCENE.blocks.length} blok, satu sumber, zona hulu sampai hilir`}
          />
          <ZoneLegend />
          <p className="mt-1.5 text-xs text-ink-3">{SCENE_CAPTION}</p>
        </m.div>
      </div>
    </section>
  );
}