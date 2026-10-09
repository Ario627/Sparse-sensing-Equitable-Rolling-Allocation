import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { Field, inputClass } from "@/components/kit/field.tsx";
import { BrandMark } from "@/components/shell/brand.tsx";
import { isApiError } from "@/lib/api/client.ts";
import { login } from "@/lib/auth/auth-api.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { readSearchString } from "@/lib/search.ts";

const FALLBACK_TARGET = "/operations";
const MIN_PASSWORD_LENGTH = 8;
const THESIS =
  "Keputusan alokasi air yang layak, adil, dan aman — dengan sensor seminimal mungkin.";
const SUBTITLE =
  "SERA menyambungkan estimasi kondisi jaringan, memori pelayanan blok, dan optimasi bergulir untuk operator P3A.";

function safeRedirect(target: string | null): string {
  if (
    target === null ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.startsWith("/\\")
  ) {
    return FALLBACK_TARGET;
  }
  return target;
}

export function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const target = safeRedirect(readSearchString(search, "redirect"));
  const user = useSessionStore((snapshot) => snapshot.user);
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    !pending;

  useEffect(() => {
    if (user !== null) {
      void navigate({ to: target, replace: true });
    }
  }, [user, navigate, target]);

  async function submit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
    } catch (cause) {
      setError(
        isApiError(cause)
          ? cause.message
          : "Masuk gagal. Periksa koneksi lalu coba lagi.",
      );
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <section className="hidden flex-col justify-between border-r border-line bg-surface px-10 py-10 pt-safe lg:flex">
        <BrandMark />
        <div>
          <span aria-hidden="true" className="rule-staff block w-24" />
          <p className="mt-6 max-w-md text-2xl leading-snug font-semibold text-ink">
            {THESIS}
          </p>
          <p className="mt-3 max-w-md text-sm text-ink-2">{SUBTITLE}</p>
        </div>
        <p className="font-mono text-2xs text-ink-3">
          Sparse-sensing Equitable Rolling Allocation
        </p>
      </section>
      <main className="flex flex-col justify-center px-5 py-10 pt-safe pb-safe sm:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
          <div className="lg:hidden">
            <BrandMark />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              Masuk
            </h1>
            <p className="text-sm text-ink-2">
              Gunakan akun yang diberikan admin P3A.
            </p>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Email" htmlFor={emailId} required>
              <input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Kata sandi" htmlFor={passwordId} required>
              <input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                className={inputClass}
              />
            </Field>
            {error !== null && (
              <p role="alert" className="text-xs text-crit">
                {error}
              </p>
            )}
            <Button
              type="submit"
              size="md"
              variant="primary"
              disabled={!canSubmit}
              pending={pending}
              pendingLabel="Masuk…"
            >
              Masuk
            </Button>
          </form>
          <p className="text-xs text-ink-3">
            Lupa kata sandi? Hubungi admin untuk pengaturan ulang.
          </p>
          <p className="text-xs text-ink-3">
            <Link to="/" className="text-water hover:text-water-deep">
              Kembali ke halaman muka
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}