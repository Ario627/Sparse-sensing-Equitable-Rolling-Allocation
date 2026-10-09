import { BrandMark } from "@/components/shell/brand.tsx";
import { LinkButton } from "@/components/shell/link-button.tsx";

interface PipelineStep {
  readonly index: string;
  readonly title: string;
  readonly body: string;
}

const PIPELINE: readonly PipelineStep[] = [
  {
    index: "01",
    title: "Estimasi",
    body: "Keadaan jaringan dan loss direkonstruksi dari sedikit bacaan.",
  },
  {
    index: "02",
    title: "Memori layanan",
    body: "Ledger menjaga kekurangan tidak menumpuk di blok yang sama.",
  },
  {
    index: "03",
    title: "Optimasi bergulir",
    body: "Rencana dihitung ulang saat kondisi berubah, dengan fallback.",
  },
  {
    index: "04",
    title: "Keputusan manusia",
    body: "Operator menyetujui, menolak, atau mengubah. Semua tercatat.",
  },
];

const EVIDENCE: readonly string[] = [
  "Eksperimen E1–E8 di simulator dengan ground truth terkontrol.",
  "Pembanding tetap: proporsional, rotasi, greedy, oracle.",
  "Reproducible dari konfigurasi dan seed yang sama.",
];

const LIMITS: readonly string[] = [
  "Belum ada validasi lapangan; bukti dari simulator dan HIL.",
  "Lingkup: padi, satu sumber, 6–20 blok.",
  "Keadilan adalah pilihan kebijakan, bukan bobot tersembunyi.",
];

function BulletList({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
          <span
            aria-hidden="true"
            className="mt-[0.55rem] size-1 shrink-0 rounded-full bg-water/50"
          />
          {item}
        </li>
      ))}
    </ul>
  );
}

function PipelineSection() {
  return (
    <section id="cara-kerja" className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-shell flex-col gap-10 px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="max-w-lg text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Empat langkah, satu siklus.
          </h2>
          <p className="label-caps text-water">Alur keputusan</p>
        </div>
        <ol className="relative grid gap-9 lg:grid-cols-4 lg:gap-8">
          <span
            aria-hidden="true"
            className="absolute top-[0.3rem] right-0 left-0 hidden h-px bg-line-2 lg:block"
          />
          {PIPELINE.map((step) => (
            <li key={step.index} className="relative flex flex-col">
              <span
                aria-hidden="true"
                className="hidden size-2.5 rounded-full border-2 border-water bg-paper lg:block"
              />
              <span className="mt-4 font-mono text-2xs font-medium text-water tabular lg:mt-5">
                {step.index}
              </span>
              <h3 className="mt-1.5 text-base font-semibold text-ink">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ResearchSection() {
  return (
    <section id="riset" className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-shell flex-col gap-8 px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <h2 className="max-w-lg text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Bukti dibuka, batas ditulis.
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-paper p-5 sm:p-6">
            <p className="label-caps text-water-deep">Yang dapat diuji</p>
            <BulletList items={EVIDENCE} />
          </div>
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-warn-soft/50 p-5 sm:p-6">
            <p className="label-caps text-warn">Batas yang perlu diketahui</p>
            <BulletList items={LIMITS} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingSections() {
  return (
    <>
      <PipelineSection />
      <ResearchSection />
    </>
  );
}

export interface LandingFooterProps {
  readonly authed: boolean;
}

export function LandingFooter({ authed }: LandingFooterProps) {
  return (
    <footer data-surface="deep" className="reservoir-face text-surface">
      <div className="mx-auto flex max-w-shell flex-col gap-6 px-4 py-9 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-10">
        <BrandMark inverse />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="max-w-sm text-sm text-surface/60">
            Keputusan akhir tetap di tangan operator, dengan persetujuan tercatat.
          </p>
          <LinkButton
            to={authed ? "/operations" : "/login"}
            size="sm"
            variant="outline"
            className="border border-white/30 bg-transparent text-surface hover:bg-white/10 hover:text-surface"
          >
            {authed ? "Buka Operasi" : "Masuk"}
          </LinkButton>
        </div>
      </div>
    </footer>
  );
}
