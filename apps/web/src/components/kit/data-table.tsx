import {
  type ColumnDef,
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "@/components/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { formatNumber } from "@/lib/format.ts";
import { Button } from "./button.tsx";
import { EmptyState } from "./empty-state.tsx";
import { Skeleton } from "./skeleton.tsx";

const DEFAULT_PAGE_SIZE = 20;
const SKELETON_ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6"] as const;
const EMPTY_TITLE = "Belum ada data";
const EMPTY_DESCRIPTION = "Data akan muncul setelah tersedia dari server.";

const seraTableFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

export type SeraTableFeatures = typeof seraTableFeatures;
export type SeraColumnDef<TData extends object> = ColumnDef<
  SeraTableFeatures,
  TData
>;

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

const SORT_ICON_CLASS = {
  asc: "rotate-180 text-ink",
  desc: "text-ink",
} as const;

function ariaSortFor(
  sorted: false | "asc" | "desc",
): "ascending" | "descending" | undefined {
  return sorted === false ? undefined : ARIA_SORT[sorted];
}

export interface DataTableProps<TData extends object> {
  readonly columns: SeraColumnDef<TData>[];
  readonly data: TData[];
  readonly isLoading?: boolean;
  readonly pageSize?: number;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: ReactNode;
  readonly getRowId?: (row: TData, index: number) => string;
  readonly className?: string;
}

interface PagerProps {
  readonly pageIndex: number;
  readonly pageSize: number;
  readonly rowCount: number;
  readonly visibleCount: number;
  readonly pageCount: number;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

function Pager({
  pageIndex,
  pageSize,
  rowCount,
  visibleCount,
  pageCount,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: PagerProps) {
  const first = pageIndex * pageSize + 1;
  const last = Math.min(rowCount, pageIndex * pageSize + visibleCount);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
      <p className="font-mono text-xs text-ink-3 tabular">
        {formatNumber(first)}–{formatNumber(last)} / {formatNumber(rowCount)}
      </p>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-ink-3">
          Hal {formatNumber(pageIndex + 1)}/{formatNumber(pageCount)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canPrevious}
          onClick={onPrevious}
          aria-label="Halaman sebelumnya"
        >
          <IconChevronRight size={14} className="rotate-180" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canNext}
          onClick={onNext}
          aria-label="Halaman berikutnya"
        >
          <IconChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

interface EmptyRowProps {
  readonly colSpan: number;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

function EmptyRow({ colSpan, title, description, action }: EmptyRowProps) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState
          compact
          title={title}
          {...(description !== undefined ? { description } : {})}
          {...(action !== undefined ? { action } : {})}
        />
      </td>
    </tr>
  );
}

export function DataTable<TData extends object>({
  columns,
  data,
  isLoading = false,
  pageSize = DEFAULT_PAGE_SIZE,
  emptyTitle = EMPTY_TITLE,
  emptyDescription = EMPTY_DESCRIPTION,
  emptyAction,
  getRowId,
  className,
}: DataTableProps<TData>) {
  const table = useTable({
    features: seraTableFeatures,
    columns,
    data,
    initialState: { pagination: { pageIndex: 0, pageSize } },
    ...(getRowId === undefined ? {} : { getRowId }),
  });
  const { pagination } = table.state;
  const headerGroups = table.getHeaderGroups();
  const leafHeaders = headerGroups.at(0)?.headers ?? [];
  const rows = table.getRowModel().rows;
  const rowCount = table.getRowCount();
  const pageCount = table.getPageCount();
  const showSkeleton = isLoading && data.length === 0;
  const showEmpty = !isLoading && data.length === 0;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-line bg-surface",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            {headerGroups.map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-sunk/50">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      aria-sort={ariaSortFor(sorted)}
                      scope="col"
                      className="border-b border-line px-3 py-2 text-left"
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="group inline-flex items-center gap-1 label-caps text-ink-3 hover:text-ink"
                        >
                          <table.FlexRender header={header} />
                          <IconChevronDown
                            size={12}
                            className={cn(
                              "shrink-0 transition-transform",
                              sorted === false
                                ? "opacity-40 group-hover:opacity-80"
                                : SORT_ICON_CLASS[sorted],
                            )}
                          />
                        </button>
                      ) : (
                        <span className="label-caps text-ink-3">
                          <table.FlexRender header={header} />
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {showSkeleton &&
              SKELETON_ROWS.map((rowKey) => (
                <tr key={rowKey} className="border-b border-line/70 last:border-b-0">
                  {leafHeaders.map((header, columnIndex) => (
                    <td key={header.id} className="px-3 py-2.5">
                      <Skeleton
                        className={cn("h-3.5", columnIndex === 0 ? "w-36" : "w-24")}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            {showEmpty && (
              <EmptyRow
                colSpan={Math.max(leafHeaders.length, 1)}
                title={emptyTitle}
                description={emptyDescription}
                action={emptyAction}
              />
            )}
            {!showEmpty &&
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-water-soft/35"
                >
                  {row.getVisibleCells().map(
                    (cell: ReturnType<typeof row.getVisibleCells>[number]) => (
                      <td key={cell.id} className="px-3 py-2 align-middle text-ink-2">
                        <table.FlexRender cell={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {rowCount > 0 && (
        <Pager
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          rowCount={rowCount}
          visibleCount={rows.length}
          pageCount={pageCount}
          canPrevious={table.getCanPreviousPage()}
          canNext={table.getCanNextPage()}
          onPrevious={() => {
            table.previousPage();
          }}
          onNext={() => {
            table.nextPage();
          }}
        />
      )}
    </div>
  );
}