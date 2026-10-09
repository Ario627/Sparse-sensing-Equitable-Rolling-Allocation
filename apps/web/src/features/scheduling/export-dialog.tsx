import type { ExportPlansQuery } from "@sera/contracts";
import { type MouseEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconDownload } from "@/components/icons.tsx";
import { Button } from "@/components/kit/button.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { downloadCsvText, fetchPlansCsv } from "@/features/scheduling/api.ts";
import { isApiError } from "@/lib/api/client.ts";
import { cn } from "@/lib/cn.ts";
import { parseCsv } from "@/lib/csv.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";

const PREVIEW_ROWS = 8;
const EXPANDED_ROWS = 200;

interface ColumnSpec {
  readonly label: string;
  readonly format?: (value: string) => string;
  readonly align?: "left" | "right";
}

const statusLabels: Record<string, string> = {
  PROPOSED: "Diajukan",
  APPROVED: "Disetujui",
  EXECUTED: "Tereksekusi",
  SUPERSEDED: "Digantikan",
  FALLBACK: "Fallback",
};

const profileLabels: Record<string, string> = {
  EQUITY_FIRST: "Pemerataan dulu",
  SHORTAGE_FIRST: "Kekurangan dulu",
  BALANCED: "Seimbang",
};

function formatIso(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? formatDateTime(value) : value;
}

function formatMilliseconds(value: string): string {
  const parsed = Number(value);
  return value.length === 0 || !Number.isFinite(parsed)
    ? "—"
    : `${formatNumber(parsed)} ms`;
}

function formatGap(value: string): string {
  const parsed = Number(value);
  return value.length === 0 || !Number.isFinite(parsed)
    ? "—"
    : `${formatNumber(parsed * 100, 2)} %`;
}

const COLUMNS: Record<string, ColumnSpec> = {
  plan_id: { label: "ID rencana" },
  network_name: { label: "Jaringan" },
  status: { label: "Status", format: (value) => statusLabels[value] ?? value },
  profile: { label: "Profil", format: (value) => profileLabels[value] ?? value },
  horizon_from: { label: "Mulai", format: formatIso },
  horizon_to: { label: "Selesai", format: formatIso },
  item_count: { label: "Slot", align: "right" },
  override_count: { label: "Override", align: "right" },
  solver_name: { label: "Solver" },
  solver_time_ms: { label: "Waktu hitung", format: formatMilliseconds, align: "right" },
  mip_gap: { label: "MIP gap", format: formatGap, align: "right" },
  created_at: { label: "Dibuat", format: formatIso },
  updated_at: { label: "Diubah", format: formatIso },
};

function columnSpec(header: string): ColumnSpec {
  return COLUMNS[header] ?? { label: header };
}

function lockPageScroll(): () => void {
  const { documentElement } = document;
  const previous = documentElement.style.overflow;
  documentElement.style.overflow = "hidden";
  return () => {
    documentElement.style.overflow = previous;
  };
}

export interface PlanExportDialogProps {
  readonly query: ExportPlansQuery;
  readonly filename: string;
  readonly scope: string;
}

export function PlanExportDialog({ query, filename, scope }: PlanExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      return lockPageScroll();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || csv !== null) {
      return;
    }
    let cancelled = false;
    setError(null);
    fetchPlansCsv(query)
      .then((text) => {
        if (!cancelled) {
          setCsv(text);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(isApiError(cause) ? cause.message : "Pratinjau ekspor gagal dimuat.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, csv, query]);

  const table = useMemo(() => {
    if (csv === null) {
      return null;
    }
    const rows = parseCsv(csv, ",");
    const header = rows.at(0) ?? [];
    const body = rows.slice(1).filter((row) => row.some((cell) => cell.length > 0));
    return { header, body };
  }, [csv]);

  const visible = table === null ? 0 : expanded ? EXPANDED_ROWS : PREVIEW_ROWS;

  function close(): void {
    setOpen(false);
  }

  function handleCancel(event: MouseEvent<HTMLDialogElement>): void {
    event.preventDefault();
    close();
  }

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        <IconDownload size={14} />
        Ekspor CSV
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={handleCancel}
        onClose={close}
        className={cn(
          "w-[min(60rem,calc(100vw-2rem))] max-h-[min(85dvh,46rem)] overflow-y-auto",
          "motion-safe:-translate-y-3 motion-safe:opacity-0 motion-safe:transition-discrete motion-safe:transition-all motion-safe:duration-200",
          "motion-safe:open:translate-y-0 motion-safe:open:opacity-100",
          "motion-safe:starting:open:-translate-y-3 motion-safe:starting:open:opacity-0",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="label-caps text-water">Riwayat</p>
            <h2 id={titleId} className="mt-1 text-base font-semibold text-ink">
              Pratinjau ekspor
            </h2>
            <p className="mt-1 text-xs text-ink-3">{scope}</p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Tutup" onClick={close}>
            Tutup
          </Button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          {error !== null ? (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-xs text-crit">
                {error}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setCsv(null);
                }}
              >
                Muat ulang pratinjau
              </Button>
            </div>
          ) : table === null ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-ink-3">Menyiapkan pratinjau…</p>
              <Skeleton className="h-48" />
            </div>
          ) : table.body.length === 0 ? (
            <p className="text-sm text-ink-2">
              Tidak ada rencana yang cocok dengan saringan ini.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-2xs text-ink-3 tabular">
                  {formatNumber(table.body.length)} baris ·{" "}
                  {formatNumber(table.header.length)} kolom · menampilkan{" "}
                  {formatNumber(Math.min(visible, table.body.length))}
                </p>
                {table.body.length > PREVIEW_ROWS && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setExpanded((current) => !current);
                    }}
                  >
                    {expanded ? "Ringkas kembali" : "Tampilkan semua baris"}
                  </Button>
                )}
              </div>
              <div className="max-h-96 overflow-auto rounded-md border border-line">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-sunk">
                    <tr>
                      {table.header.map((cell) => {
                        const spec = columnSpec(cell);
                        return (
                          <th
                            key={cell}
                            scope="col"
                            className={cn(
                              "border-b border-line px-3 py-2 text-2xs font-medium whitespace-nowrap text-ink-2",
                              spec.align === "right" ? "text-right" : "text-left",
                            )}
                          >
                            {spec.label}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {table.body.slice(0, visible).map((row, rowIndex) => (
                      <tr
                        key={`row-${rowIndex}`}
                        className="border-b border-line/60 last:border-b-0 hover:bg-water-soft/30"
                      >
                        {table.header.map((column, columnIndex) => {
                          const spec = columnSpec(column);
                          const raw = row[columnIndex] ?? "";
                          const text = spec.format === undefined ? raw : spec.format(raw);
                          return (
                            <td
                              key={`${column}-${columnIndex}`}
                              className={cn(
                                "px-3 py-1.5 text-xs whitespace-nowrap text-ink-2",
                                column === "plan_id" || column === "network_name"
                                  ? "font-mono text-2xs"
                                  : "font-mono text-2xs tabular",
                                spec.align === "right" && "text-right",
                              )}
                            >
                              {text.length === 0 ? "—" : text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" onClick={close}>
            Batal
          </Button>
          <Button
            variant="primary"
            disabled={table === null || table.body.length === 0}
            onClick={() => {
              if (csv !== null) {
                downloadCsvText(csv, filename);
              }
            }}
          >
            <IconDownload size={15} />
            Unduh CSV
          </Button>
        </div>
      </dialog>
    </>
  );
}
