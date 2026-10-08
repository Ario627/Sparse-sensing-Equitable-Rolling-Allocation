import type {
  PlanDecisionRequest,
  PlanOverrideItemChange,
} from "@sera/contracts";
import { useState } from "react";
import { isApiError } from "@/lib/api/client.ts";
import { usePlanDecision, usePlanExecute, usePlanOverride } from "./api.ts";

export type PlanActionName =
  | "approve"
  | "reject"
  | "request_changes"
  | "override"
  | "execute";

const EMPTY_REASON_ERROR = "Alasan wajib diisi sebelum mengirim.";
const GENERIC_ERROR = "Aksi gagal dikirim. Periksa koneksi lalu coba lagi.";

export interface PlanActions {
  readonly pendingAction: PlanActionName | null;
  readonly error: string | null;
  readonly clearError: () => void;
  readonly approve: (reason?: string) => Promise<boolean>;
  readonly reject: (reason: string) => Promise<boolean>;
  readonly requestChanges: (reason: string) => Promise<boolean>;
  readonly override: (
    reason: string,
    items: readonly PlanOverrideItemChange[],
  ) => Promise<boolean>;
  readonly execute: () => Promise<boolean>;
}

function messageFrom(cause: unknown): string {
  return isApiError(cause) ? cause.message : GENERIC_ERROR;
}

export function usePlanActions(planId: string): PlanActions {
  const decision = usePlanDecision(planId);
  const overrideMutation = usePlanOverride(planId);
  const executeMutation = usePlanExecute(planId);
  const [pendingAction, setPendingAction] = useState<PlanActionName | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function run(
    name: PlanActionName,
    task: () => Promise<unknown>,
  ): Promise<boolean> {
    setPendingAction(name);
    setError(null);
    try {
      await task();
      return true;
    } catch (cause) {
      setError(messageFrom(cause));
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function decide(
    request: PlanDecisionRequest,
    name: PlanActionName,
  ): Promise<boolean> {
    return run(name, () => decision.mutateAsync(request));
  }

  function requireReason(reason: string): string | null {
    const trimmed = reason.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  async function approve(reason?: string): Promise<boolean> {
    const trimmed = reason === undefined ? undefined : reason.trim();
    return decide(
      trimmed === undefined || trimmed.length === 0
        ? { action: "approve" }
        : { action: "approve", reason: trimmed },
      "approve",
    );
  }

  async function reject(reason: string): Promise<boolean> {
    const trimmed = requireReason(reason);
    if (trimmed === null) {
      setError(EMPTY_REASON_ERROR);
      return false;
    }
    return decide({ action: "reject", reason: trimmed }, "reject");
  }

  async function requestChanges(reason: string): Promise<boolean> {
    const trimmed = requireReason(reason);
    if (trimmed === null) {
      setError(EMPTY_REASON_ERROR);
      return false;
    }
    return decide(
      { action: "request_changes", reason: trimmed },
      "request_changes",
    );
  }

  async function override(
    reason: string,
    items: readonly PlanOverrideItemChange[],
  ): Promise<boolean> {
    const trimmed = requireReason(reason);
    if (trimmed === null) {
      setError(EMPTY_REASON_ERROR);
      return false;
    }
    return run("override", () =>
      overrideMutation.mutateAsync({ reason: trimmed, items: [...items] }),
    );
  }

  async function execute(): Promise<boolean> {
    return run("execute", () => executeMutation.mutateAsync());
  }

  return {
    pendingAction,
    error,
    clearError: () => {
      setError(null);
    },
    approve,
    reject,
    requestChanges,
    override,
    execute,
  };
}
