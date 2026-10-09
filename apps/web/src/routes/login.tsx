import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { Field, inputClass } from "@/components/kit/field.tsx";
import { BrandMark } from "@/components/shell/brand.tsx";
import { CanalProfile } from "@/components/viz/canal-profile.tsx";
import { isApiError } from "@/lib/api/client.ts";
import { login } from "@/lib/auth/auth-api.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { readSearchString } from "@/lib/search.ts";

const FALLBACK_TARGET = "/operations";
const MIN_PASSWORD_LENGTH = 8;
const TAGLINE = "Aliran satu, giliran banyak.";
const NOTE = "Purwarupa riset — belum divalidasi lapangan";

function safeRedirect(target: string | null): string {
  if (
    target === null ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.startsWith("\\")
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
    email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH && !pending;

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
    <div className="grid min-h-dvh bg-paper md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,29rem)]">
      <section
        data-surface="deep"
        className="reservoir-face relative hidden flex-col justify-between overflow-hidden px-10 pt-safe pb-0 md:flex lg:px-12 xl:px-16"
      >
        <div className="relative pt-10">
          <BrandMark inverse />
        </div>
        <div className="relative flex flex-col gap-4">
          <p className="max-w-[15ch] font-display text-4xl leading-[1.02] font-semibold tracking-tight text-surface xl:text-5xl">
            {TAGLINE}
          </p>
          <p className="max-w-sm text-sm text-surface/60">
            Peta aliran tetap terbaca walau sensornya sedikit. Keputusan akhir tetap pada
            operator.
          </p>
        </div>
        <div className="relative flex flex-col gap-5">
          <p className="font-mono text-2xs text-surface/45">{NOTE}</p>
          <div
            aria-hidden="true"
            className="-mx-10 aspect-[10/3] w-[calc(100%+5rem)] lg:-mx-12 lg:w-[calc(100%+6rem)] xl:-mx-16 xl:w-[calc(100%+8rem)]"
          >
            <CanalProfile variant="deep" />
          </div>
        </div>
      </section>
      <main className="relative flex flex-col justify-center px-5 py-10 pt-safe pb-safe sm:px-8 lg:px-10">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-7">
          <div className="md:hidden">
            <BrandMark />
          </div>
          <div className="flex flex-col gap-2">
            <p className="label-caps text-water">Autentikasi</p>
            <h1 className="font-display text-3xl leading-none font-semibold tracking-tight text-ink">
              Masuk
            </h1>
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <Link to="/" className="text-xs text-water hover:text-water-deep">
              Halaman muka
            </Link>
            <p className="text-xs text-ink-3">Lupa kata sandi? Hubungi admin.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
