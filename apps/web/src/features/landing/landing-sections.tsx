import { BrandMark } from "@/components/shell/brand.tsx";
import { LinkButton } from "@/components/shell/link-button.tsx";

interface ProblemEntry {
  readonly title: string;
  readonly note: string;
}

const PROBLEMS: readonly ProblemEntry[] = [
  {
    title: "Sensing terbatas",
    note: "Satu–dua sensor harus mewakili belasan blok.",
  },
  {
    title: "Kehilangan tak terukur",
    note: "Loss tiap ruas diestimasi dengan interval keyakinan.",
  },
  {
    title: "Kekurangan menumpuk",
    note: "Ledger menjaga kekurangan tidak menumpuk di blok yang sama.",
  },
  {
    title: "Suplai berubah",
    note: "Optimasi bergulir dengan skenario ketidakpastian.",
  },
  {
    title: "Investasi sensor",
    note: "Dinilai dari regret keputusan, bukan galat estimasi.",
  },
];

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
    body: "Rencana dihitung ulang saat kondisi berubah; ada fallback.",
  },
  {
    index: "04",
    title: "Keputusan manusia",
    body: "Operator menyetujui, menolak, atau mengubah — semua tercatat.",
  },
];

const EVIDENCE: readonly string[] = [
  "Eksperimen E1–E8 di simulator dengan ground truth terkontrol.",
  "Pembanding tetap: proporsional, rotasi, greedy, oracle.",
  "Empat keluarga metrik — bukan satu angka gabungan.",
  "Reproducible dari konfigurasi dan seed yang sama.",
];

const LIMITS: readonly string[] = [
  "Belum ada validasi lapangan — bukti dari simulator dan HIL.",
  "Lingkup: padi, satu sumber, 6–20 blok.",
  "Keadilan adalah pilihan kebijakan, bukan bobot tersembunyi.",
  "Angka performa menyusul setelah eksperimen dijalankan.",
];

function SectionHead({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="label-caps text-water">{eyebrow}</p>
      <h2 className="mt-1.5 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
      {description !== undefined && (
        <p className="mt-2 text-sm text-ink-2">{description}</p>
      )}
    </div>
  );
}

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

function ProblemSection() {
  return (
    <section id="masalah" className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-shell flex-col gap-8 px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <SectionHead
          eyebrow="Kenapa ini penting"
          title="Satu pintu masuk. Banyak blok yang tak terlihat."
          description="Yang terukur hanya sebagian kecil jaringan — SERA menjaga sisanya tetap terbaca."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEMS.map((entry, index) => (
            <li
              key={entry.title}
              className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-5"
            >
              <span className="font-mono text-2xs text-ink-3 tabular">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-base font-semibold text-ink">{entry.title}</h3>
              <p className="text-sm leading-relaxed text-ink-2">{entry.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PipelineSection() {
  return (
    <section id="cara-kerja" className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-shell flex-col gap-9 px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <SectionHead
          eyebrow="Alur keputusan"
          title="Dari bacaan ke jadwal yang bisa ditinjau."
          description="Satu siklus penuh — dari data sampai jejak audit."
        />
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {PIPELINE.map((step) => (
            <li key={step.index} className="flex flex-col">
              <div aria-hidden="true" className="h-0.5 w-full rounded-full bg-water/60" />
              <span className="mt-4 font-mono text-xs font-medium text-water tabular">
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
        <SectionHead
          eyebrow="Riset dan bukti"
          title="Buka hasilnya. Periksa batasnya."
          description="Setiap perbandingan berasal dari run tercatat — lingkup bukti tampil bersama metrik."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-paper p-5 sm:p-6">
            <p className="text-xs font-medium text-water-deep">Yang dapat diuji</p>
            <BulletList items={EVIDENCE} />
          </div>
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-sunk/50 p-5 sm:p-6">
            <p className="text-xs font-medium text-warn">Batas yang perlu diketahui</p>
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
      <ProblemSection />
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
    <footer className="bg-ink text-surface">
      <div className="mx-auto flex max-w-shell flex-col gap-5 px-4 py-9 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-10">
        <div className="flex flex-col gap-2">
          <BrandMark />
          <p className="max-w-md text-sm leading-relaxed text-surface/70">
            SERA tidak menetapkan hak air. Keputusan akhir tetap di tangan operator,
            dengan persetujuan yang tercatat.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <LinkButton
            to={authed ? "/operations" : "/login"}
            size="sm"
            variant="outline"
            className="border border-white/35 bg-transparent text-surface hover:bg-white/10 hover:text-surface"
          >
            {authed ? "Buka Operasi" : "Masuk ke aplikasi"}
          </LinkButton>
          <p className="font-mono text-2xs text-surface/55">Tim SERA · 2026</p>
        </div>
      </div>
    </footer>
  );
}
