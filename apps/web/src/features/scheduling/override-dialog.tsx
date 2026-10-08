import type { PlanDetailResponse, PlanItemResponse } from "@sera/contracts";
import { useEffect, useId, useState } from "react";
import { ConfirmDialog } from "@/components/kit/confirm-dialog.tsx";
import { Field, textareaClass } from "@/components/kit/field.tsx";
import { cn } from "@/lib/cn.ts";
import { formatClockRange } from "@/lib/format.ts";
import { usePlanActions } from "./use-plan-actions.ts";

const REASON_MAX = 160;
const REASON_HINT = `Alasan perubahan, maksimum ${REASON_MAX} karakter`;
const NO_CHANGES_ERROR = "Pilih minimal satu perubahan pintu.";
const EMPTY_PLAN_ERROR = "Plan ini belum memiliki item untuk diubah.";

export interface OverrideDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly plan: PlanDetailResponse;
}

function gateStateOf(item: PlanItemResponse, changed: ReadonlySet<string>): boolean {
  return changed.has(item.id) ? !item.gate_open : item.gate_open;
}

interface OverrideRowProps {
  readonly item: PlanItemResponse;
  readonly gateOpen: boolean;
  readonly onToggle: () => void;
}

function OverrideRow({ item, gateOpen, onToggle }: OverrideRowProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xs border border-line px-2.5 py-2">
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink">
          {item.block_name}
        </span>
        <span className="block font-mono text-2xs text-ink-3 tabular">
          {formatClockRange(item.slot_start, item.slot_end)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "label-caps",
            gateOpen ? "text-water" : "text-ink-3",
          )}
        >
          {gateOpen ? "Dibuka" : "Ditutup"}
        </span>
        <input
          type="checkbox"
          checked={gateOpen}
          onChange={onToggle}
          className="size-4 accent-water"
        />
      </span>
    </label>
  );
}

export function OverrideDialog({ open, onOpenChange, plan }: OverrideDialogProps) {
  const actions = usePlanActions(plan.id);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const reasonId = useId();
  const pending = actions.pendingAction === "override";

  useEffect(() => {
    if (!open) {
      setChanged(new Set());
      setReason("");
      setLocalError(null);
    }
  }, [open]);

  function toggle(itemId: string): void {
    setLocalError(null);
    setChanged((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (changed.size === 0) {
      setLocalError(NO_CHANGES_ERROR);
      return;
    }
    if (reason.trim().length === 0) {
      setLocalError(null);
      return;
    }
    const items = plan.items
      .filter((item) => changed.has(item.id))
      .map((item) => ({ item_id: item.id, gate_open: !item.gate_open }));
    const ok = await actions.override(reason, items);
    if (ok) {
      onOpenChange(false);
    }
  }

  const errorText = localError ?? actions.error;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ubah perintah pintu"
      description="Perubahan dicatat sebagai override operator pada jejak audit."
      confirmLabel="Simpan override"
      pendingLabel="Menyimpan…"
      tone="danger"
      pending={pending}
      onConfirm={() => {
        void submit();
      }}
    >
      {plan.items.length === 0 ? (
        <p className="text-xs text-ink-2">{EMPTY_PLAN_ERROR}</p>
      ) : (
        <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
          {plan.items.map((item) => (
            <OverrideRow
              key={item.id}
              item={item}
              gateOpen={gateStateOf(item, changed)}
              onToggle={() => {
                toggle(item.id);
              }}
            />
          ))}
        </div>
      )}
      <Field
        label="Alasan"
        htmlFor={reasonId}
        required
        hint={REASON_HINT}
        {...(errorText === null ? {} : { error: errorText })}
      >
        <textarea
          id={reasonId}
          value={reason}
          maxLength={REASON_MAX}
          rows={3}
          onChange={(event) => {
            setReason(event.target.value);
            setLocalError(null);
            actions.clearError();
          }}
          className={cn(textareaClass, errorText !== null && "border-crit")}
        />
      </Field>
      <p className="text-right font-mono text-2xs text-ink-3 tabular">
        {reason.length}/{REASON_MAX}
      </p>
    </ConfirmDialog>
  );
}