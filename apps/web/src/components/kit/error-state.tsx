import type { ReactNode } from "react";
import { isApiError } from "@/lib/api/client.ts";
import { cn } from "@/lib/cn.ts";

const FALLBACK_TITLE = "Data gagal dimuat";
const FALLBACK_MESSAGE =
  "Terjadi kesalahan yang tidak terduga. Muat ulang halaman, lalu coba lagi.";
const MAX_DETAIL_LINES = 4;
const REQUEST_ID_CHARS = 8;

export interface ErrorStateProps {
  readonly error: unknown;
  readonly title?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

interface ErrorDiagnosticsProps {
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string;
}

function detailLines(details: unknown): readonly string[] {
  if (!Array.isArray(details)) {
    return [];
  }
  const texts = details.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return Array.from(new Set(texts)).slice(0, MAX_DETAIL_LINES);
}

function ErrorDiagnostics({ code, status, requestId }: ErrorDiagnosticsProps) {
  return (
    <p className="font-mono text-2xs text-ink-3 tabular">
      {code} · {status ?? "—"} · req {requestId.slice(0, REQUEST_ID_CHARS)}
    </p>
  );
}

export function ErrorState({
  error,
  title = FALLBACK_TITLE,
  action,
  className,
}: ErrorStateProps) {
  const apiError = isApiError(error) ? error : null;
  const lines = apiError === null ? [] : detailLines(apiError.details);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-md border border-crit/25 bg-crit-soft/60 px-6 py-10 text-center",
        className,
      )}
    >
      <p className="label-caps text-crit">Gangguan</p>
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="max-w-md text-sm text-ink-2">
        {apiError?.message ?? FALLBACK_MESSAGE}
      </p>
      {lines.length > 0 && (
        <ul className="mt-1 space-y-1 text-left">
          {lines.map((line) => (
            <li key={line} className="font-mono text-xs text-ink-2">
              {line}
            </li>
          ))}
        </ul>
      )}
      {apiError !== null && (
        <ErrorDiagnostics
          code={apiError.code}
          status={apiError.status}
          requestId={apiError.requestId}
        />
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}