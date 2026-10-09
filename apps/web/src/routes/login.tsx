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

const SCALE_STEPS = Array.from({ length: 12 }, (_, index) => ({
  index,
  tall: index % 4 === 3,
  active: index === 8,
}));

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

function GaugeBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-12 right-4 hidden w-16 md:block xl:right-6 xl:w-20"
    >
      <div className="absolute inset-y-0 left-0 w-px bg-surface/30" />
      <div className="absolute inset-y-0 left-0 w-full bg-gauge-y" />
      <div className="absolute top-[54%] right-0 left-0 flex items-center gap-1">
        <span className="h-px flex-1 bg-[#55b5ba]" />
        <span className="size-1.5 rotate-45 bg-[#55b5ba]" />
      </div>
    </div>
  );
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
    <div className="grid min-h-dvh bg-paper md:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink px-10 py-10 pt-safe text-surface md:flex lg:px-12 xl:px-16">
        <div aria-hidden="true" className="absolute inset-0 bg-ruled-light" />
        <GaugeBackdrop />
        <div className="relative">
          <BrandMark inverse />
        </div>
        <div className="relative max-w-2xl pr-20 xl:pr-24">
          <p className="label-caps text-[#8fd0d4]">
            Sparse-sensing Equitable Rolling Allocation
          </p>
          <p className="mt-4 max-w-[13ch] font-display text-4xl leading-[0.98] font-semibold tracking-tight text-surface lg:text-5xl xl:text-6xl">
            {THESIS}
          </p>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-surface/72">
            {SUBTITLE}
          </p>
          
        </div>
        <p className="relative font-mono text-2xs text-surface/48">
          Purwarupa riset — belum divalidasi lapangan
        </p>
      </section>
      <main className="relative flex flex-col justify-center bg-grid px-5 py-10 pt-safe pb-safe sm:px-8 lg:px-10">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
          <div className="md:hidden">
            <BrandMark />
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="label-caps text-ink-3">Autentikasi operator</p>
            <div aria-hidden="true" className="flex items-end gap-0.5">
              {SCALE_STEPS.map((step) => (
                <span
                  key={step.index}
                  className={`w-1.5 ${step.tall ? "h-2.5" : "h-1"} ${
                    step.active ? "bg-water" : "bg-line-2"
                  }`}
                />
              ))}
            </div>
            <h1 className="font-display text-4xl leading-none font-semibold tracking-tight text-ink">
              Masuk
            </h1>
            <p className="text-sm leading-relaxed text-ink-2">
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
