import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { CapabilityNotice, useCapability } from "@/components/kit/capability-notice.tsx";
import { CopyConfigButton } from "@/components/kit/copy-config-button.tsx";
import { textareaClass } from "@/components/kit/field.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { RoleGate } from "@/components/kit/role-gate.tsx";
import { ReliefCanvas } from "@/components/viz/relief-canvas.tsx";
import { useCreateExperiment } from "@/features/experiments/api.ts";
import { buildTerrainPreview } from "@/features/simulation/preview.ts";
import {
  buildExperimentYaml,
  defaultSensorSet,
  generateExperimentId,
} from "@/features/simulation/run.ts";
import {
  parseSimulationSearch,
  type SimulationScenario,
  scenarioPresets,
  toSimulationSearch,
} from "@/features/simulation/scenario.ts";
import {
  PresetPicker,
  ScenarioFields,
  topologyLabel,
} from "@/features/simulation/scenario-form.tsx";
import { isApiError } from "@/lib/api/client.ts";
import { labRoles } from "@/lib/auth/roles.ts";
import { cn } from "@/lib/cn.ts";
import { formatNumber } from "@/lib/format.ts";
import { asSearchRecord, buildSearch } from "@/lib/search.ts";

const PREVIEW_HEIGHT = 440;
const YAML_ROWS = 16;

function presetOf(scenario: SimulationScenario) {
  return scenarioPresets.find((entry) => entry.key === scenario.preset) ?? null;
}

function experimentName(scenario: SimulationScenario): string {
  const preset = presetOf(scenario);
  return `Simulasi ${preset?.label ?? scenario.preset} · ${scenario.blocks} blok · ${scenario.topology.toLowerCase()} · seed ${scenario.seed}`;
}

function sensorSetLabel(scenario: SimulationScenario): string {
  const set = defaultSensorSet(scenario.sensors, scenario.blocks);
  return set.length === 0 ? "tanpa sensor" : set.join(", ");
}

export function SimulationPage() {
  return (
    <RoleGate
      allow={labRoles}
      title="Halaman riset khusus peneliti"
      description="Penyusunan skenario dan penjalanan eksperimen hanya terbuka untuk peran peneliti atau admin."
    >
      <SimulationContent />
    </RoleGate>
  );
}

interface FactProps {
  readonly label: string;
  readonly value: string;
}

function Fact({ label, value }: FactProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/70 py-2 last:border-b-0">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="font-mono text-xs text-ink tabular">{value}</span>
    </div>
  );
}

function SimulationContent() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const scenario = parseSimulationSearch(asSearchRecord(search));
  const [experimentId, setExperimentId] = useState(() =>
    generateExperimentId(scenario.seed),
  );
  const create = useCreateExperiment();
  const canRun = useCapability("experiment.run");
  const preview = buildTerrainPreview(scenario.topology, scenario.blocks);
  const yaml = buildExperimentYaml({ experimentId, scenario });
  const preset = presetOf(scenario);
  const sensors = defaultSensorSet(scenario.sensors, scenario.blocks);

  function applyScenario(next: SimulationScenario): void {
    navigate({
      to: "/lab/simulation",
      search: toSimulationSearch(next),
      replace: true,
    });
  }

  async function run(): Promise<void> {
    const created = await create
      .mutateAsync({
        name: experimentName(scenario),
        description: null,
        config_yaml: yaml,
        seed_base: scenario.seed,
      })
      .catch(() => null);
    if (created === null) {
      return;
    }
    setExperimentId(generateExperimentId(scenario.seed));
    navigate({
      to: "/lab/experiments",
      search: buildSearch({ experiment: created.id }),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Riset"
        title="Simulasi"
        description="Uji satu skenario gangguan sebelum dijalankan sebagai eksperimen."
        actions={
          canRun ? (
            <Button
              variant="primary"
              pending={create.isPending}
              pendingLabel="Mengirim…"
              onClick={() => {
                void run();
              }}
            >
              Jalankan eksperimen
            </Button>
          ) : (
            <CapabilityNotice capability="experiment.run" />
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-hair">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <p className="label-caps text-water">Pratinjau struktur</p>
                <InfoDialog
                  label="Keterangan"
                  eyebrow="Pratinjau"
                  title="Apa yang ditampilkan pratinjau"
                  triggerClassName="border border-line-2 bg-surface"
                >
                  <div className="flex flex-col gap-3">
                    <p>
                      Bentuk jaringan dibangkitkan secara deterministik dari topologi,
                      jumlah blok, dan seed yang dipilih, sehingga dua orang dengan
                      parameter sama akan melihat struktur yang sama.
                    </p>
                    <p>
                      Blok ditampilkan seragam tanpa warna karena belum ada hasil
                      simulasi. Warna dan angka baru muncul di halaman Eksperimen setelah
                      solver menyelesaikan run.
                    </p>
                  </div>
                </InfoDialog>
              </div>
              <p className="font-mono text-2xs text-ink-3 tabular">
                {topologyLabel(scenario.topology)} · {formatNumber(scenario.blocks)} blok
              </p>
            </div>
            <ReliefCanvas
              blocks={preview.blocks}
              flow={preview.flow}
              height={PREVIEW_HEIGHT}
              label={`Pratinjau struktur jaringan ${scenario.topology.toLowerCase()} dengan ${scenario.blocks} blok`}
            />
          </section>
          <details className="group rounded-xl border border-line bg-surface shadow-hair">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2.5">
                <span className="label-caps text-water">Parameter lanjutan</span>
                <span className="text-2xs text-ink-3">
                  menimpa preset pada jalan berikutnya
                </span>
              </span>
              <span
                aria-hidden="true"
                className="text-2xs text-ink-3 transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div className="border-t border-line px-5 py-4">
              <ScenarioFields value={scenario} onChange={applyScenario} />
            </div>
          </details>
        </div>
        <div className="flex flex-col gap-4">
          <section className="contour-paper flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-hair">
            <p className="label-caps text-water">Skenario</p>
            <p className="font-display text-2xl leading-none font-semibold text-ink">
              {preset?.label ?? scenario.preset}
            </p>
            <p className="text-sm text-ink-2">
              {preset?.description ?? "Preset khusus."}
            </p>
            <PresetPicker
              value={scenario.preset}
              onChange={(next) => {
                applyScenario({ ...scenario, preset: next });
              }}
            />
          </section>
          <section className="flex flex-col rounded-xl border border-line bg-surface px-5 py-4 shadow-hair">
            <p className="label-caps text-water">Kondisi jaringan</p>
            <div className="mt-2">
              <Fact label="Topologi" value={topologyLabel(scenario.topology)} />
              <Fact label="Blok" value={formatNumber(scenario.blocks)} />
              <Fact
                label="Horizon"
                value={`${formatNumber(scenario.horizonDays)} hari`}
              />
              <Fact
                label="Debit suplai"
                value={`${formatNumber(scenario.supplyLps, 1)} L/s`}
              />
              <Fact label="Sensor" value={formatNumber(scenario.sensors)} />
              <Fact label="Seed" value={formatNumber(scenario.seed)} />
            </div>
          </section>
          <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-hair">
            <p className="label-caps text-water">Eksperimen</p>
            <p className="font-mono text-xs text-ink-2">{experimentId}</p>
            <p className="text-2xs text-ink-3">
              {sensors.length === 0
                ? "Tanpa titik ukur pada skenario ini."
                : `${formatNumber(sensors.length)} titik ukur: ${sensorSetLabel(scenario)}`}
            </p>
            <InfoDialog
              label="Konfigurasi eksperimen"
              eyebrow="Eksperimen"
              title="Konfigurasi YAML"
              variant="outline"
              className="w-[min(44rem,calc(100vw-2rem))]"
            >
              <div className="flex flex-col gap-3">
                <p className="text-xs text-ink-3">
                  Berkas ini dikirim apa adanya ke layanan eksperimen. Semua parameter
                  berasal dari halaman ini.
                </p>
                <textarea
                  readOnly
                  value={yaml}
                  rows={YAML_ROWS}
                  spellCheck={false}
                  onFocus={(event) => {
                    event.currentTarget.select();
                  }}
                  className={cn(textareaClass, "font-mono text-xs")}
                />
                <CopyConfigButton text={yaml} />
              </div>
            </InfoDialog>
            {canRun && (
              <Button
                variant="primary"
                pending={create.isPending}
                pendingLabel="Mengirim…"
                onClick={() => {
                  void run();
                }}
              >
                Jalankan eksperimen
              </Button>
            )}
            {create.isError && (
              <p role="alert" className="text-xs text-crit">
                {isApiError(create.error)
                  ? create.error.message
                  : "Pengiriman eksperimen gagal. Coba lagi."}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
