import { Link, Outlet } from "@tanstack/react-router";
import { Button } from "@/components/kit/button.tsx";

const linkButtonClass =
  "inline-flex h-9 items-center justify-center rounded-sm border border-transparent bg-water px-3.5 text-sm font-medium text-surface transition-colors hover:bg-water-deep";

export function NotFoundView() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span aria-hidden="true" className="rule-staff w-16" />
        <p className="label-caps text-ink-3">404</p>
        <h1 className="text-lg font-semibold text-ink">
          Halaman tidak ditemukan
        </h1>
        <p className="max-w-sm text-sm text-ink-2">
          Alamat yang dituju tidak ada atau sudah dipindahkan.
        </p>
        <Link to="/operations" className={linkButtonClass}>
          Kembali ke Operasi
        </Link>
      </div>
    </div>
  );
}

export function RootError({
  error,
  reset,
}: {
  readonly error: unknown;
  readonly reset: () => void;
}) {
  const detail =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "kesalahan tidak dikenal";
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <span aria-hidden="true" className="rule-staff w-16" />
        <p className="label-caps text-crit">Gangguan</p>
        <h1 className="text-lg font-semibold text-ink">
          Aplikasi gagal ditampilkan
        </h1>
        <p className="text-sm text-ink-2">
          Terjadi kesalahan yang tidak terduga. Coba muat ulang tampilan; bila
          berulang, catat langkah yang dilakukan dan laporkan ke tim SERA.
        </p>
        <p className="max-w-full wrap-break-word font-mono text-2xs text-ink-3">
          {detail}
        </p>
        <Button size="sm" variant="primary" onClick={reset}>
          Muat ulang tampilan
        </Button>
      </div>
    </div>
  );
}

export function RootLayout() {
  return <Outlet />;
}