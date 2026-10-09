import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { CopyConfigButton } from "@/components/kit/copy-config-button.tsx";
import { textareaClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { ReliefCanvas } from "@/components/viz/relief-canvas.tsx";
import { useCreateExperiment } from "@/features/experiments/api.ts";
import { buildTerrainPreview } from "@/features/simulation/preview.ts";
import { ScenarioForm } from "@/features/simulation/scenario-form.tsx";
import {
  buildExperimentYaml,
  defaultSensorSet,
  generateExperimentId,
} from "@/features/simulation/run.ts";
import {
  parseSimulationSearch,
  scenarioPresets,
  toSimulationSearch,
  type SimulationScenario,
} from "@/features/simulation/scenario.ts";
import { isApiError } from "@/lib/api/client.ts";
import { cn } from "@/lib/cn.ts";
import { asSearchRecord, buildSearch } from "@/lib/search.ts";

const CANVAS_HEIGHT = 320;
const YAML_ROWS = 14;

function presetLabel(scenario: SimulationScenario): string {
  const preset = scenarioPresets.find((entry) => entry.key === scenario.preset);
  return preset?.label ?? scenario.preset;
}

function experimentName(scenario: SimulationScenario): string {
  return `Simulasi ${presetLabel(scenario)} · ${scenario.blocks} blok · ${scenario.topology.toLowerCase()} · seed ${scenario.seed}`;
}

function sensorSetLabel(scenario: SimulationScenario): string {
  const set = defaultSensorSet(scenario.sensors, scenario.blocks);
  return set.length === 0 ? "tanpa sensor" : set.join(", ");
}

export function SimulationPage() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const scenario = parseSimulationSearch(asSearchRecord(search));
  const [experimentId, setExperimentId] = useState(() =>
    generateExperimentId(scenario.seed),
  );
  const create = useCreateExperiment();
  const preview = buildTerrainPreview(scenario.topology, scenario.blocks);
  const yaml = buildExperimentYaml({ experimentId, scenario });

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
        description="Susun skenario, periksa struktur, lalu kirim sebagai eksperimen. Seluruh parameter tersimpan di tautan halaman."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
          <ScenarioForm value={scenario} onChange={applyScenario} />
          <p className="font-mono text-2xs text-ink-3 tabular">
            Titik ukur: {sensorSetLabel(scenario)} 
          </p>
          <div className="flex flex-col gap-2.5">
            <Button
              size="md"
              variant="primary"
              pending={create.isPending}
              pendingLabel="Mengirim…"
              onClick={() => {
                void run();
              }}
            >
              Jalankan eksperimen
            </Button>
            <CopyConfigButton text={yaml} />
            {create.isError && (
              <p role="alert" className="text-xs text-crit">
                {isApiError(create.error)
                  ? create.error.message
                  : "Pengiriman eksperimen gagal. Coba lagi."}
              </p>
            )}
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <ReliefCanvas
            blocks={preview.blocks}
            flow={preview.flow}
            height={CANVAS_HEIGHT}
            label={`Pratinjau struktur jaringan ${scenario.topology.toLowerCase()} dengan ${scenario.blocks} blok`}
          />
          <p className="text-xs text-ink-3">
            Pratinjau struktur deterministik dari skenario — bukan hasil
            simulasi. Blok ditampilkan seragam tanpa warna karena belum ada
            data; hasil nyata muncul di halaman Eksperimen setelah solver
            berjalan.
          </p>
          <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3.5">
            <p className="label-caps text-ink-3">
              Konfigurasi eksperimen (YAML)
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
          </div>
        </section>
      </div>
    </div>
  );
}