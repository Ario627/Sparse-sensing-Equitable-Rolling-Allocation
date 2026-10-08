import type { PlanDetailResponse } from "@sera/contracts";
import { useId, useState } from "react";
import { Button, type ButtonVariant } from "@/components/kit/button.tsx";
import {
  ConfirmDialog,
  type ConfirmTone,
} from "@/components/kit/confirm-dialog.tsx";
import { Field, textareaClass } from "@/components/kit/field.tsx";
import { cn } from "@/lib/cn.ts";
import { OverrideDialog } from "./override-dialog.tsx";
import { usePlanActions, type PlanActionName } from "./use-plan-actions.ts";

const REASON_MAX = 160;
const REASON_HINT = `Alasan tercatat di jejak audit, maksimum ${REASON_MAX} karakter`;
const EMPTY_REASON_ERROR = "Alasan wajib diisi sebelum mengirim.";

type DecisionDialog = Extract<
  PlanActionName,
  "approve" | "reject" | "request_changes" | "execute"
>;

export interface ApprovalActionsProps {
  readonly plan: PlanDetailResponse;
  readonly show: readonly PlanActionName[];
  readonly className?: string;
}

interface DialogCopy {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
  readonly tone: ConfirmTone;
}

const dialogCopy: Record<DecisionDialog, DialogCopy> = {
  approve: {
    title: "Setujui plan ini?",
    description:
      "Plan siap dieksekusi setelah disetujui. Keputusan tercatat di jejak audit.",
    confirmLabel: "Setujui",
    pendingLabel: "Menyetujui…",
    tone: "default",
  },
  reject: {
    title: "Tolak plan ini?",
    description:
      "Plan ditolak dan tidak akan dieksekusi. Alasan wajib diisi untuk audit.",
    confirmLabel: "Tolak",
    pendingLabel: "Menolak…",
    tone: "danger",
  },
  request_changes: {
    title: "Minta perubahan plan?",
    description:
      "Solver akan menyusun ulang plan. Jelaskan bagian yang perlu diubah.",
    confirmLabel: "Kirim permintaan",
    pendingLabel: "Mengirim…",
    tone: "default",
  },
  execute: {
    title: "Eksekusi plan ini?",
    description:
      "Perintah pintu dikirim ke perangkat melalui antrean perintah. Pastikan kondisi lapangan sudah sesuai.",
    confirmLabel: "Eksekusi",
    pendingLabel: "Mengirim perintah…",
    tone: "default",
  },
};

const actionLabels: Record<PlanActionName, string> = {
  approve: "Setujui",
  reject: "Tolak",
  request_changes: "Minta ubah",
  override: "Ubah pintu",
  execute: "Eksekusi",
};

const actionVariants: Record<PlanActionName, ButtonVariant> = {
  approve: "primary",
  reject: "danger",
  request_changes: "outline",
  override: "outline",
  execute: "primary",
};

function isDecisionDialog(action: PlanActionName): action is DecisionDialog {
  return action !== "override";
}

export function ApprovalActions({
  plan,
  show,
  className,
}: ApprovalActionsProps) {
  const actions = usePlanActions(plan.id);
  const [dialog, setDialog] = useState<DecisionDialog | null>(null);
  const [shownDialog, setShownDialog] = useState<DecisionDialog>("approve");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const reasonId = useId();
  const copy = dialogCopy[shownDialog];
  const reasonRequired =
    shownDialog === "reject" || shownDialog === "request_changes";
  const errorText = localError ?? actions.error;
  const busy = actions.pendingAction !== null;

  function openDialog(action: PlanActionName): void {
    if (!isDecisionDialog(action)) {
      setOverrideOpen(true);
      return;
    }
    setDialog(action);
    setShownDialog(action);
    setReason("");
    setLocalError(null);
    actions.clearError();
  }

  function closeDialog(): void {
    setDialog(null);
    actions.clearError();
  }

  function runDecision(
    action: DecisionDialog,
    trimmed: string,
  ): Promise<boolean> {
    switch (action) {
      case "approve":
        return actions.approve();
      case "reject":
        return actions.reject(trimmed);
      case "request_changes":
        return actions.requestChanges(trimmed);
      case "execute":
        return actions.execute();
    }
  }

  async function confirmDialogAction(): Promise<void> {
    if (dialog === null) {
      return;
    }
    const trimmed = reason.trim();
    if (reasonRequired && trimmed.length === 0) {
      setLocalError(EMPTY_REASON_ERROR);
      return;
    }
    const ok = await runDecision(dialog, trimmed);
    if (ok) {
      closeDialog();
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {show.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={actionVariants[action]}
          disabled={busy}
          pending={actions.pendingAction === action}
          onClick={() => {
            openDialog(action);
          }}
        >
          {actionLabels[action]}
        </Button>
      ))}
      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        pendingLabel={copy.pendingLabel}
        tone={copy.tone}
        pending={actions.pendingAction === dialog}
        onConfirm={() => {
          void confirmDialogAction();
        }}
      >
        {reasonRequired && (
          <div className="flex flex-col gap-1">
            <Field
              label="Alasan"
              htmlFor={reasonId}
              required
              hint={REASON_HINT}
              {...(errorText !== null ? { error: errorText } : {})}
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
          </div>
        )}
      </ConfirmDialog>
      <OverrideDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        plan={plan}
      />
    </div>
  );
}