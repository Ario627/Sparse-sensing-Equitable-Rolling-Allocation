import { useNavigate, useSearch } from "@tanstack/react-router";
import { useId } from "react";
import { Button } from "@/components/kit/button.tsx";
import { CopyConfigButton } from "@/components/kit/copy-config-button.tsx";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { RoleGate } from "@/components/kit/role-gate.tsx";
import { useCreateExperiment } from "@/features/experiments/api.ts";
import {
  buildExperimentYaml,
  defaultSensorSet,
  type ExperimentMethod,
  generateExperimentId,
} from "@/features/simulation/run.ts";
import {
  defaultScenario,
  randomSeed,
  type ScenarioPresetKey,
  scenarioPresets,
} from "@/features/simulation/scenario.ts";
import { NumberInput } from "@/features/simulation/scenario-form.tsx";
import { isApiError } from "@/lib/api/client.ts";
import { labRoles } from "@/lib/auth/roles.ts";
import { formatNumber } from "@/lib/format.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const BLOCK_OPTIONS = [6, 8, 10, 12, 16, 20] as const;
const SENSOR_CEILING = 12;
const DEFAULT_BLOCKS = 10;
const DEFAULT_SENSOR_MAX = 6;
const DEFAULT_SEED = 1042;
const SEED_MAX = 1_000_000_000;
const BUDGET_METHODS: readonly ExperimentMethod[] = ["sera", "oracle"];

export interface BudgetRow {
  readonly k: number;
  readonly sensorSet: string;
  readonly runs: number;
}

const budgetColumns: SeraColumnDef<BudgetRow>[] = [
  {
    id: "k",
    accessorKey: "k",
    header: "Sensor (k)",
    cell: (info) => (
      <span className="font-mono text-xs text-ink tabular">
        {formatNumber(info.row.original.k)}
      </span>
    ),
  },
  {
    id: "set",
    accessorKey: "sensorSet",
    header: "Titik ukur",
    cell: (info) => (
      <span className="font-mono text-xs text-ink-2">{info.row.original.sensorSet}</span>
    ),
  },
  {
    id: "runs",
    accessorKey: "runs",
    header: "Run",
    cell: (info) => (
      <span className="font-mono text-xs text-ink-2 tabular">
        {formatNumber(info.row.original.runs)}
      </span>
    ),
  },
];

function parseBlocks(raw: string | null): number {
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return BLOCK_OPTIONS.find((option) => option === parsed) ?? DEFAULT_BLOCKS;
}

function parseSensorMax(raw: string | null, blocks: number): number {
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return Math.min(DEFAULT_SENSOR_MAX, blocks, SENSOR_CEILING);
  }
  return Math.min(Math.max(0, parsed), blocks, SENSOR_CEILING);
}

function parseSeed(raw: string | null): number {
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SEED;
  }
  return Math.min(Math.max(0, parsed), SEED_MAX);
}

function parsePreset(raw: string | null): ScenarioPresetKey {
  const found = scenarioPresets.find((preset) => preset.key === raw);
  return found?.key ?? "nominal";
}

function presetLabel(preset: ScenarioPresetKey): string {
  return scenarioPresets.find((entry) => entry.key === preset)?.label ?? preset;
}

function budgetRows(blocks: number, sensorMax: number): BudgetRow[] {
  return Array.from({ length: sensorMax + 1 }, (_, k) => {
    const set = defaultSensorSet(k, blocks);
    return {
      k,
      sensorSet: set.length === 0 ? "tanpa sensor" : set.join(", "),
      runs: BUDGET_METHODS.length,
    };
  });
}

export function SensorBudgetPage() {
  return (
    <RoleGate
      allow={labRoles}
      title="Halaman riset khusus peneliti"
      description="Pengujian jumlah sensor hanya terbuka untuk peran peneliti atau admin."
    >
      <SensorBudgetContent />
    </RoleGate>
  );
}

function SensorBudgetContent() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const presetId = useId();
  const blocksId = useId();
  const sensorId = useId();
  const seedId = useId();
  const blocks = parseBlocks(readSearchString(search, "blocks"));
  const sensorMax = parseSensorMax(readSearchString(search, "max"), blocks);
  const seed = parseSeed(readSearchString(search, "seed"));
  const preset = parsePreset(readSearchString(search, "preset"));
  const create = useCreateExperiment();
  const rows = budgetRows(blocks, sensorMax);
  const totalRuns = rows.length * BUDGET_METHODS.length;

  function apply(next: {
    readonly preset?: ScenarioPresetKey;
    readonly blocks?: number;
    readonly max?: number;
    readonly seed?: number;
  }): void {
    const merged = {
      preset: next.preset ?? preset,
      blocks: next.blocks ?? blocks,
      max: next.max ?? sensorMax,
      seed: next.seed ?? seed,
    };
    navigate({
      to: "/lab/sensor-budget",
      search: buildSearch({
        preset: merged.preset,
        blocks: String(merged.blocks),
        max: String(merged.max),
        seed: String(merged.seed),
      }),
      replace: true,
    });
  }

  const sensorOptions = Array.from(
    { length: Math.min(blocks, SENSOR_CEILING) + 1 },
    (_, index) => index,
  );

  const yaml = buildExperimentYaml({
    experimentId: generateExperimentId(seed),
    scenario: {
      ...defaultScenario,
      preset,
      blocks,
      sensors: sensorMax,
      seed,
    },
    methods: BUDGET_METHODS,
    sensorSets: rows.map((row) => defaultSensorSet(row.k, blocks)),
  });

  async function run(): Promise<void> {
    const created = await create
      .mutateAsync({
        name: `Anggaran sensor ${sensorMax} · ${blocks} blok · ${presetLabel(preset)} · seed ${seed}`,
        description: null,
        config_yaml: yaml,
        seed_base: seed,
      })
      .catch(() => null);
    if (created === null) {
      return;
    }
    navigate({
      to: "/lab/experiments",
      search: buildSearch({ experiment: created.id }),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Riset"
        title="Anggaran Sensor"
        description="Jalankan kurva jumlah sensor k = 0…m pada skenario dan seed yang sama, lalu bandingkan kualitas keputusan di halaman Hasil."
      />
      <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={presetId} className="text-sm font-medium text-ink">
              Skenario
            </label>
            <select
              id={presetId}
              value={preset}
              onChange={(event) => {
                apply({ preset: parsePreset(event.target.value) });
              }}
              className={inputClass}
            >
              {scenarioPresets.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={blocksId} className="text-sm font-medium text-ink">
              Jumlah blok
            </label>
            <select
              id={blocksId}
              value={blocks}
              onChange={(event) => {
                const next = parseBlocks(event.target.value);
                apply({ blocks: next, max: Math.min(sensorMax, next) });
              }}
              className={inputClass}
            >
              {BLOCK_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={sensorId} className="text-sm font-medium text-ink">
              Sensor maksimum
            </label>
            <select
              id={sensorId}
              value={sensorMax}
              onChange={(event) => {
                apply({ max: parseSensorMax(event.target.value, blocks) });
              }}
              className={inputClass}
            >
              {sensorOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <NumberInput
            id={seedId}
            label="Seed"
            value={seed}
            min={0}
            max={SEED_MAX}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  apply({ seed: randomSeed() });
                }}
              >
                Acak
              </Button>
            }
            onCommit={(value) => {
              apply({ seed: value });
            }}
          />
        </div>
        <p className="text-xs text-ink-3">
          Dijalankan pada faktor K = 1 (nominal) dengan {BUDGET_METHODS.length} metode per
          titik — {formatNumber(totalRuns)} run total. Oracle = penginderaan penuh sebagai
          referensi atas.
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
            Jalankan kurva anggaran
          </Button>
          <CopyConfigButton text={yaml} />
          {create.isError && (
            <p role="alert" className="text-xs text-crit">
              {isApiError(create.error)
                ? create.error.message
                : "Pengiriman gagal. Coba lagi."}
            </p>
          )}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <p className="label-caps text-ink-3">Rencana run</p>
        <DataTable
          columns={budgetColumns}
          data={[...rows]}
          getRowId={(row) => `k-${row.k}`}
          emptyTitle="Tidak ada titik"
          emptyDescription="Naikkan sensor maksimum untuk membentuk kurva."
        />
      </section>
    </div>
  );
}
