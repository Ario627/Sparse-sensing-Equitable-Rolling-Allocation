import type { UserRole } from "@sera/contracts";
import { useState } from "react";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { RoleGate } from "@/components/kit/role-gate.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill, type Tone } from "@/components/kit/status-pill.tsx";
import { activeUserCount, useAuditLog, useUsers } from "@/features/admin/api.ts";
import { roleLabel } from "@/lib/auth/roles.ts";
import { cn } from "@/lib/cn.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";

const ADMIN_ALLOW = ["ADMIN"] as const;
const USER_LIMIT = 50;
const AUDIT_LIMIT = 25;

const roleTones: Record<string, Tone> = {
  ADMIN: "info",
  OPERATOR: "ok",
  RESEARCHER: "warn",
  VIEWER: "neutral",
};

const roleOptions: readonly { readonly value: UserRole | ""; readonly label: string }[] =
  [
    { value: "", label: "Semua peran" },
    { value: "ADMIN", label: roleLabel("ADMIN") },
    { value: "OPERATOR", label: roleLabel("OPERATOR") },
    { value: "RESEARCHER", label: roleLabel("RESEARCHER") },
    { value: "VIEWER", label: roleLabel("VIEWER") },
  ];

interface AuditRow {
  readonly id: string;
  readonly action: string;
  readonly entity: string;
  readonly actor: string;
  readonly createdAt: string;
}

interface UserRow {
  readonly id: string;
  readonly full_name: string;
  readonly email: string;
  readonly role: UserRole;
  readonly is_active: boolean;
  readonly created_at: string;
}

function userColumns(): SeraColumnDef<UserRow>[] {
  return [
    {
      id: "name",
      accessorKey: "full_name",
      header: "Nama",
      cell: (info) => (
        <span className="text-sm font-medium text-ink">
          {info.row.original.full_name}
        </span>
      ),
    },
    {
      id: "email",
      accessorKey: "email",
      header: "Surel",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2">{info.row.original.email}</span>
      ),
    },
    {
      id: "role",
      accessorKey: "role",
      header: "Peran",
      cell: (info) => (
        <StatusPill
          tone={roleTones[info.row.original.role] ?? "neutral"}
          label={roleLabel(info.row.original.role)}
        />
      ),
    },
    {
      id: "active",
      accessorFn: (row) => row.is_active,
      header: "Status",
      cell: (info) => (
        <span
          className={cn(
            "text-xs",
            info.row.original.is_active ? "text-ok" : "text-ink-3",
          )}
        >
          {info.row.original.is_active ? "Aktif" : "Nonaktif"}
        </span>
      ),
    },
    {
      id: "created",
      accessorKey: "created_at",
      header: "Dibuat",
      cell: (info) => (
        <span className="font-mono text-2xs text-ink-3 tabular">
          {formatDateTime(info.row.original.created_at)}
        </span>
      ),
    },
  ];
}

function auditColumns(): SeraColumnDef<AuditRow>[] {
  return [
    {
      id: "action",
      accessorKey: "action",
      header: "Tindakan",
      cell: (info) => (
        <span className="font-mono text-xs text-ink">{info.row.original.action}</span>
      ),
    },
    {
      id: "entity",
      accessorKey: "entity",
      header: "Objek",
      cell: (info) => (
        <span className="text-xs text-ink-2">{info.row.original.entity}</span>
      ),
    },
    {
      id: "actor",
      accessorKey: "actor",
      header: "Pelaku",
      cell: (info) => (
        <span className="text-xs text-ink-2">{info.row.original.actor}</span>
      ),
    },
    {
      id: "time",
      accessorKey: "createdAt",
      header: "Waktu",
      cell: (info) => (
        <span className="font-mono text-2xs text-ink-3 tabular">
          {formatDateTime(info.row.original.createdAt)}
        </span>
      ),
    },
  ];
}

function StatCell({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
}) {
  return (
    <div className="flex flex-col px-5 py-3.5">
      <p className="label-caps text-ink-3">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink tabular">
        {value}
      </p>
      <p className="mt-1 truncate text-2xs text-ink-3">{note}</p>
    </div>
  );
}

export function AccessPage() {
  return (
    <RoleGate
      allow={ADMIN_ALLOW}
      title="Halaman khusus admin"
      description="Daftar pengguna dan jejak audit sistem hanya terbuka untuk peran admin."
    >
      <AccessContent />
    </RoleGate>
  );
}

function AccessContent() {
  const [role, setRole] = useState<UserRole | "">("");
  const [search, setSearch] = useState("");
  const usersQuery = useUsers({
    limit: USER_LIMIT,
    q: search.trim() === "" ? undefined : search.trim(),
    ...(role === "" ? {} : { role }),
  });
  const auditQuery = useAuditLog({ limit: AUDIT_LIMIT });
  const users: UserRow[] = (usersQuery.data?.items ?? []).map((user) => ({
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    created_at: user.created_at,
  }));
  const audit: AuditRow[] = (auditQuery.data?.items ?? []).map((entry) => ({
    id: entry.id,
    action: entry.action,
    entity: entry.entity,
    actor: entry.actor?.full_name ?? "Sistem",
    createdAt: entry.created_at,
  }));
  const active = activeUserCount(users);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Sistem"
        title="Akses"
        description="Daftar pengguna, perannya, dan jejak tindakan yang tercatat."
        actions={
          <InfoDialog
            label="Cakupan halaman"
            eyebrow="Kewenangan admin"
            title="Apa yang tercatat di sini"
            triggerClassName="border border-line-2 bg-surface"
          >
            <div className="flex flex-col gap-3">
              <p>
                Halaman ini menampilkan keadaan akses apa adanya: siapa memegang peran
                apa, apakah akunnya aktif, dan tindakan apa yang tercatat pada jejak
                audit.
              </p>
              <p>
                Jejak audit memuat perubahan pengguna, keanggotaan P3A, topologi, sensor,
                dan penutupan neraca. Catatan bersifat tambah saja, sehingga urutannya
                menjadi riwayat yang tidak dapat disunting dari antarmuka.
              </p>
            </div>
          </InfoDialog>
        }
      />
      <section className="grid grid-cols-1 divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-hair sm:grid-cols-3 sm:divide-x">
        <StatCell
          label="Pengguna aktif"
          value={formatNumber(active)}
          note={`dari ${formatNumber(users.length)} pada tampilan ini`}
        />
        <StatCell
          label="Total pengguna"
          value={formatNumber(usersQuery.data?.total ?? 0)}
          note="seluruh peran terdaftar"
        />
        <StatCell
          label="Catatan audit"
          value={formatNumber(auditQuery.data?.total ?? 0)}
          note="sejak sistem dijalankan"
        />
      </section>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            aria-label="Cari pengguna"
            placeholder="Cari nama atau surel"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className={cn(inputClass, "w-auto min-w-56 flex-1 sm:flex-none")}
          />
          <select
            aria-label="Saring peran"
            value={role}
            onChange={(event) => {
              const next = roleOptions.find(
                (option) => option.value === event.target.value,
              );
              setRole(next?.value ?? "");
            }}
            className={cn(inputClass, "w-auto")}
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {usersQuery.isError ? (
          <ErrorState error={usersQuery.error} />
        ) : usersQuery.isPending ? (
          <Skeleton className="h-56" />
        ) : (
          <DataTable
            columns={userColumns()}
            data={users}
            getRowId={(row) => row.id}
            emptyTitle="Tidak ada pengguna"
            emptyDescription="Tidak ada pengguna yang cocok dengan saringan ini."
          />
        )}
      </div>
      <section className="flex flex-col gap-3">
        <p className="label-caps text-water">Jejak audit terakhir</p>
        {auditQuery.isError ? (
          <ErrorState error={auditQuery.error} />
        ) : auditQuery.isPending ? (
          <Skeleton className="h-48" />
        ) : (
          <DataTable
            columns={auditColumns()}
            data={audit}
            pageSize={10}
            getRowId={(row) => row.id}
            emptyTitle="Belum ada catatan"
            emptyDescription="Jejak audit muncul setelah ada perubahan tercatat."
          />
        )}
      </section>
    </div>
  );
}
