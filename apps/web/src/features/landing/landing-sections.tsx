import * as m from "motion/react-m";
import { BrandMark } from "@/components/shell/brand.tsx";
import { LinkButton } from "@/components/shell/link-button.tsx";

const EASE_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];
const VIEWPORT = { once: true, margin: "-80px" } as const;

const GROUP_VARIANTS = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: EASE_QUART },
  },
};

const RULE_VARIANTS = {
  hidden: { scaleX: 0 },
  show: { scaleX: 1, transition: { duration: 0.5, ease: EASE_QUART } },
};

interface ProblemEntry {
  readonly title: string;
  readonly problem: string;
  readonly response: string;
}

const PROBLEMS: readonly ProblemEntry[] = [
  {
    title: "Sensing terbatas",
    problem: "Satu sampai dua sensor harus mewakili belasan blok.",
    response:
      "Kondisi jaringan dan kehilangan air diestimasi dari bacaan yang ada — selalu dengan interval keyakinan.",
  },
  {
    title: "Kehilangan air tidak terukur",
    problem:
      "Efisiensi tiap ruas tidak diketahui, sehingga air yang dialokasikan tidak sama dengan yang tiba di blok.",
    response:
      "Estimasi loss berdimensi rendah dengan gerbang identifiabilitas: parameter yang tidak bisa dikenali tidak dipaksa diestimasi.",
  },
  {
    title: "Kekurangan menumpuk di hilir",
    problem:
      "Blok yang sama menerima kurang secara berulang dan memicu konflik antar-petani.",
    response:
      "Service ledger mencatat target dan realisasi tiap blok, dengan forgetting factor dan batas utang yang eksplisit.",
  },
  {
    title: "Suplai dan cuaca berubah",
    problem:
      "Rencana yang disusun hari ini bisa salah begitu debit atau hujan tidak sesuai perkiraan.",
    response:
      "Optimasi bergulir nonantisipatif dengan skenario ketidakpastian dan ukuran risiko CVaR — keputusan tidak mengintip masa depan.",
  },
  {
    title: "Investasi sensor belum tentu sepadan",
    problem: "Menambah sensor tidak otomatis memperbaiki keputusan alokasi.",
    response:
      "Anggaran sensor dievaluasi dari regret keputusan — bukan hanya dari galat estimasi.",
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
    body: "Keadaan jaringan dan kehilangan air direkonstruksi dari sedikit bacaan — selalu dengan interval keyakinan.",
  },
  {
    index: "02",
    title: "Memori pelayanan",
    body: "Ledger mencatat target dan realisasi tiap blok. Kekurangan tidak menumpuk di blok yang sama.",
  },
  {
    index: "03",
    title: "Optimasi bergulir",
    body: "Rencana beberapa hari dihitung ulang saat kondisi berubah; fallback berjenjang bila solver gagal.",
  },
  {
    index: "04",
    title: "Keputusan manusia",
    body: "Operator P3A menyetujui, menolak, atau mengubah. Semua keputusan tercatat untuk audit.",
  },
];

const EVIDENCE: readonly string[] = [
  "Eksperimen berjenjang (E1–E8) dijalankan di simulator dengan ground truth yang dikontrol.",
  "Pembanding tetap: proporsional, rotasi tetap, greedy ledger, dan oracle penginderaan penuh.",
  "Penilaian dari empat keluarga metrik — kecukupan, efisiensi, keandalan, pemerataan — bukan satu angka gabungan.",
  "Hasil dapat direproduksi dari konfigurasi dan seed yang sama.",
];

const LIMITS: readonly string[] = [
  "Belum ada validasi lapangan; bukti saat ini berasal dari simulator dan demonstrator HIL.",
  "Lingkup saat ini: padi, satu sumber, jaringan tersier 6–20 blok.",
  "Definisi keadilan adalah pilihan kebijakan — ditampilkan sebagai profil dan kurva trade-off, bukan bobot tersembunyi.",
  "Angka performa baru bermakna setelah eksperimen dijalankan; tidak ada klaim tanpa bukti di halaman ini.",
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
    <m.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.45, ease: EASE_QUART }}
      className="max-w-2xl"
    >
      <p className="label-caps text-water">{eyebrow}</p>
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {description !== undefined && (
        <p className="mt-2 text-sm text-ink-2">{description}</p>
      )}
    </m.div>
  );
}

function BulletList({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li
          key={item}
          className="border-l border-line pl-3 text-sm leading-relaxed text-ink-2"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function ProblemSection() {
  return (
    <section id="masalah" className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 lg:py-16">
        <SectionHead
          eyebrow="Masalah"
          title="Lima masalah nyata di lapangan"
          description="Setiap masalah punya penanganan eksplisit di SERA — bukan solusi satu ukuran untuk semua."
        />
        <m.ul
          initial="hidden"
          whileInView="show"
          viewport={VIEWPORT}
          variants={GROUP_VARIANTS}
        >
          {PROBLEMS.map((entry) => (
            <m.li
              key={entry.title}
              variants={ITEM_VARIANTS}
              className="grid gap-2 border-t border-line py-4 first:border-t-0 first:pt-0 lg:grid-cols-2 lg:gap-10"
            >
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {entry.title}
                </h3>
                <p className="mt-1 text-sm text-ink-2">{entry.problem}</p>
              </div>
              <p className="border-l-2 border-water/25 pl-3 text-sm text-water-deep">
                {entry.response}
              </p>
            </m.li>
          ))}
        </m.ul>
      </div>
    </section>
  );
}

function PipelineSection() {
  return (
    <section id="cara-kerja" className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:py-16">
        <SectionHead
          eyebrow="Cara kerja"
          title="Dari estimasi ke keputusan yang tercatat"
          description="Empat tahap yang berulang setiap kali kondisi jaringan berubah."
        />
        <m.ol
          initial="hidden"
          whileInView="show"
          viewport={VIEWPORT}
          variants={GROUP_VARIANTS}
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          {PIPELINE.map((step) => (
            <m.li
              key={step.index}
              variants={ITEM_VARIANTS}
              className="flex flex-col"
            >
              <m.div
                variants={RULE_VARIANTS}
                style={{ originX: 0 }}
                className="h-0.5 w-full bg-line-2"
              />
              <span className="mt-3 font-mono text-2xs text-ink-3 tabular">
                {step.index}
              </span>
              <h3 className="mt-1 text-sm font-semibold text-ink">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                {step.body}
              </p>
            </m.li>
          ))}
        </m.ol>
      </div>
    </section>
  );
}

function ResearchSection() {
  return (
    <section id="riset" className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 lg:py-16">
        <SectionHead
          eyebrow="Riset dan bukti"
          title="Simulation-first, hasil terbuka"
          description="Kami memisahkan tegas antara apa yang sudah dibuktikan dan apa yang belum."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <m.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={VIEWPORT}
            transition={{ duration: 0.45, ease: EASE_QUART }}
            className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4"
          >
            <p className="label-caps text-ink-3">Bagaimana kami membuktikan</p>
            <BulletList items={EVIDENCE} />
          </m.div>
          <m.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={VIEWPORT}
            transition={{ duration: 0.45, delay: 0.08, ease: EASE_QUART }}
            className="flex flex-col gap-3 rounded-md border border-line-2 bg-sunk/50 p-4"
          >
            <p className="label-caps text-ink-3">Yang tidak kami klaim</p>
            <BulletList items={LIMITS} />
          </m.div>
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
    <footer className="bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2">
          <BrandMark />
          <p className="max-w-md text-xs text-ink-3">
            SERA tidak menetapkan hak air. Keputusan akhir tetap di tangan
            operator, dengan persetujuan yang tercatat.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <LinkButton
            to={authed ? "/operations" : "/login"}
            size="sm"
            variant="outline"
          >
            {authed ? "Buka Operasi" : "Masuk ke aplikasi"}
          </LinkButton>
          <p className="font-mono text-2xs text-ink-3">Tim SERA · 2026</p>
        </div>
      </div>
    </footer>
  );
}