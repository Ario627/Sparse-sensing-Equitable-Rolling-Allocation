import type { ChangePasswordRequest } from "@sera/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { Field, inputClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import { changePassword } from "@/lib/auth/auth-api.ts";
import { roleLabel } from "@/lib/auth/roles.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { isApiError } from "@/lib/api/client.ts";
import { cn } from "@/lib/cn.ts";

const PASSWORD_MIN_LENGTH = 12;
const MIN_CLASSES = 3;

interface PasswordCheck {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
}

function passwordChecks(password: string): readonly PasswordCheck[] {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(
    (pattern) => pattern.test(password),
  ).length;
  return [
    {
      id: "length",
      label: `Minimal ${PASSWORD_MIN_LENGTH} karakter`,
      passed: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: "case",
      label: "Memuat huruf kecil dan huruf besar",
      passed: /[a-z]/.test(password) && /[A-Z]/.test(password),
    },
    {
      id: "digit",
      label: "Memuat angka",
      passed: /[0-9]/.test(password),
    },
    {
      id: "classes",
      label: `Minimal ${MIN_CLASSES} jenis karakter`,
      passed: classes >= MIN_CLASSES,
    },
  ];
}

function allPassed(checks: readonly PasswordCheck[]): boolean {
  return checks.every((check) => check.passed);
}

function CheckList({ checks }: { readonly checks: readonly PasswordCheck[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {checks.map((check) => (
        <li
          key={check.id}
          className={cn("text-xs", check.passed ? "text-ok" : "text-ink-3")}
        >
          {check.label}
          <span className="sr-only">
            {check.passed ? ": terpenuhi" : ": belum terpenuhi"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps text-ink-3">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function ProfileCard() {
  const user = useSessionStore((snapshot) => snapshot.user);
  if (user === null) {
    return null;
  }
  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="label-caps text-ink-3">Profil sesi</p>
        <StatusPill tone="info" label={roleLabel(user.role)} />
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label="Nama">{user.full_name}</Fact>
        <Fact label="Email">
          <span className="font-mono text-xs">{user.email}</span>
        </Fact>
      </dl>
      <p className="text-xs text-ink-3">
        Perubahan peran dan akses dikelola admin pada modul pengguna; halaman ini
        hanya menampilkan sesi yang sedang aktif.
      </p>
    </section>
  );
}

function PolicyCard() {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <p className="label-caps text-ink-3">Profil kebijakan alokasi</p>
      <dl className="flex flex-col gap-3">
        <Fact label="Pemerataan dulu">
          Prioritas pemerataan pelayanan antar-blok; dipakai saat konflik atau
          kelangkaan sosial.
        </Fact>
        <Fact label="Kekurangan dulu">
          Prioritas menekan kekurangan total; dipakai saat produksi kritis.
        </Fact>
        <Fact label="Seimbang">
          Trade-off terukur untuk operasi normal.
        </Fact>
      </dl>
      <p className="text-xs text-ink-3">
        Pemilihan profil per plan diatur saat pengajuan plan dan tercatat di
        jejak audit. Tidak ada bobot tersembunyi: perbandingan profil disajikan
        sebagai kurva Pareto di halaman Hasil.
      </p>
    </section>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const currentId = useId();
  const newId = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const checks = passwordChecks(next);
  const policyOk = allPassed(checks);
  const different = next.length > 0 && next !== current;
  const canSubmit =
    current.length > 0 && policyOk && different && !pending;

  async function submit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setPending(true);
    setError(null);
    const request: ChangePasswordRequest = {
      current_password: current,
      new_password: next,
    };
    try {
      await changePassword(request);
      setChanged(true);
      setCurrent("");
      setNext("");
    } catch (cause) {
      setError(
        isApiError(cause) ? cause.message : "Penggantian gagal. Coba lagi.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Sistem"
        title="Pengaturan"
        description="Profil sesi aktif dan penggantian kata sandi."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard />
        <PolicyCard />
      </div>
      <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
        <p className="label-caps text-ink-3">Ganti kata sandi</p>
        {changed ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              Kata sandi diperbarui. Semua sesi berakhir sebagai tindakan
              keamanan — masuk kembali dengan kata sandi baru.
            </p>
            <div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  void navigate({ to: "/login" });
                }}
              >
                Masuk kembali
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kata sandi saat ini" htmlFor={currentId} required>
                <input
                  id={currentId}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => {
                    setCurrent(event.target.value);
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="Kata sandi baru" htmlFor={newId} required>
                <input
                  id={newId}
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(event) => {
                    setNext(event.target.value);
                  }}
                  className={inputClass}
                />
              </Field>
            </div>
            <CheckList checks={checks} />
            {next.length > 0 && !different && (
              <p className="text-xs text-warn">
                Kata sandi baru harus berbeda dari kata sandi saat ini.
              </p>
            )}
            {error !== null && (
              <p role="alert" className="text-xs text-crit">
                {error}
              </p>
            )}
            <div>
              <Button
                type="submit"
                size="md"
                variant="primary"
                disabled={!canSubmit}
                pending={pending}
                pendingLabel="Menyimpan…"
              >
                Simpan kata sandi
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}