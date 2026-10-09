import type { Topology } from "@sera/contracts";
import { type ChangeEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { Field, inputClass } from "@/components/kit/field.tsx";
import { cn } from "@/lib/cn.ts";
import {
  randomSeed,
  type ScenarioPresetKey,
  type SimulationScenario,
  scenarioBounds,
  scenarioPresets,
} from "./scenario.ts";

const TOPOLOGY_OPTIONS: readonly { readonly value: Topology; readonly label: string }[] =
  [
    { value: "CHAIN", label: "Rantai" },
    { value: "BRANCHED", label: "Bercabang" },
    { value: "MIXED", label: "Campuran" },
  ];

function TopologySelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: Topology;
  readonly onChange: (next: Topology) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => {
        const next = TOPOLOGY_OPTIONS.find(
          (option) => option.value === event.target.value,
        );
        if (next !== undefined) {
          onChange(next.value);
        }
      }}
      className={inputClass}
    >
      {TOPOLOGY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function topologyLabel(topology: Topology): string {
  return TOPOLOGY_OPTIONS.find((option) => option.value === topology)?.label ?? topology;
}

interface NumberInputProps {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly integer?: boolean;
  readonly action?: ReactNode;
  readonly onCommit: (value: number) => void;
}

function normalizeDraft(
  raw: string,
  min: number,
  max: number,
  integer: boolean,
): number | null {
  const parsed = integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  if (raw.trim().length === 0 || !Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function NumberInput({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  integer = true,
  action,
  onCommit,
}: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const raw = event.target.value;
    setDraft(raw);
    const normalized = normalizeDraft(raw, min, max, integer);
    if (normalized !== null) {
      onCommit(normalized);
    }
  }

  function handleBlur(): void {
    const normalized = normalizeDraft(draft, min, max, integer);
    const final = normalized ?? value;
    onCommit(final);
    setDraft(String(final));
  }

  const input = (
    <input
      id={id}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={handleChange}
      onBlur={handleBlur}
      className={inputClass}
    />
  );

  return (
    <Field label={label} htmlFor={id}>
      {action === undefined ? (
        input
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1">{input}</span>
          {action}
        </div>
      )}
    </Field>
  );
}

interface PresetPickerProps {
  readonly value: ScenarioPresetKey;
  readonly onChange: (preset: ScenarioPresetKey) => void;
}

export function PresetPicker({ value, onChange }: PresetPickerProps) {
  return (
    <fieldset>
      <legend className="label-caps text-ink-3">Preset skenario</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {scenarioPresets.map((preset) => {
          const active = preset.key === value;
          return (
            <button
              key={preset.key}
              type="button"
              title={preset.description}
              aria-pressed={active}
              onClick={() => {
                onChange(preset.key);
              }}
              className={cn(
                "rounded-xs border px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-water/50 bg-water-soft text-water-deep"
                  : "border-line-2 bg-surface text-ink-2 hover:border-ink-3/50 hover:text-ink",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface ScenarioFieldsProps {
  readonly value: SimulationScenario;
  readonly onChange: (next: SimulationScenario) => void;
  readonly className?: string;
}

export function ScenarioFields({ value, onChange, className }: ScenarioFieldsProps) {
  const sensorsId = useId();
  const seedId = useId();
  const supplyId = useId();
  const blocksId = useId();
  const horizonId = useId();
  const topologyId = useId();

  function patch(partial: Partial<SimulationScenario>): void {
    onChange({ ...value, ...partial });
  }

  return (
    <div className={cn("grid gap-3 xs:grid-cols-2", className)}>
      <NumberInput
        id={blocksId}
        label="Jumlah blok"
        value={value.blocks}
        min={scenarioBounds.blocks.min}
        max={scenarioBounds.blocks.max}
        onCommit={(blocks) => {
          patch({ blocks });
        }}
      />
      <NumberInput
        id={horizonId}
        label="Horizon (hari)"
        value={value.horizonDays}
        min={scenarioBounds.horizonDays.min}
        max={scenarioBounds.horizonDays.max}
        onCommit={(horizonDays) => {
          patch({ horizonDays });
        }}
      />
      <NumberInput
        id={sensorsId}
        label="Jumlah sensor"
        value={value.sensors}
        min={scenarioBounds.sensors.min}
        max={scenarioBounds.sensors.max}
        onCommit={(sensors) => {
          patch({ sensors });
        }}
      />
      <NumberInput
        id={supplyId}
        label="Debit suplai (L/s)"
        value={value.supplyLps}
        min={scenarioBounds.supplyLps.min}
        max={scenarioBounds.supplyLps.max}
        step={scenarioBounds.supplyLps.step}
        integer={false}
        onCommit={(supplyLps) => {
          patch({ supplyLps });
        }}
      />
      <NumberInput
        id={seedId}
        label="Seed"
        value={value.seed}
        min={0}
        max={1_000_000_000}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              patch({ seed: randomSeed() });
            }}
          >
            Acak
          </Button>
        }
        onCommit={(seed) => {
          patch({ seed });
        }}
      />
      <Field label="Topologi" htmlFor={topologyId}>
        <TopologySelect
          id={topologyId}
          value={value.topology}
          onChange={(topology) => {
            patch({ topology });
          }}
        />
      </Field>
    </div>
  );
}
