import {
  type MouseEvent,
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useId,
  useRef,
} from "react";
import { cn } from "@/lib/cn.ts";
import { Button } from "./button.tsx";

export type ConfirmTone = "default" | "danger";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly pendingLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: ConfirmTone;
  readonly pending?: boolean;
  readonly onConfirm: () => void;
  readonly children?: ReactNode;
  readonly className?: string;
}

const DEFAULT_CANCEL_LABEL = "Batal";

const toneConfirmVariant: Record<ConfirmTone, "primary" | "danger"> = {
  default: "primary",
  danger: "danger",
};

function lockPageScroll(): () => void {
  const { documentElement } = document;
  const previous = documentElement.style.overflow;
  documentElement.style.overflow = "hidden";
  return () => {
    documentElement.style.overflow = previous;
  };
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = DEFAULT_CANCEL_LABEL,
  tone = "default",
  pending = false,
  onConfirm,
  children,
  className,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

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

  function handleCancel(event: MouseEvent<HTMLDialogElement>): void {
    event.preventDefault();
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>): void {
    if (event.target !== event.currentTarget || pending) {
      return;
    }
    onOpenChange(false);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    onConfirm();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      onClose={() => {
        onOpenChange(false);
      }}
      className={cn(
        "w-[min(26rem,calc(100vw-2rem))] max-h-[min(85dvh,40rem)] overflow-y-auto",
        "motion-safe:-translate-y-3 motion-safe:opacity-0 motion-safe:transition-discrete motion-safe:transition-all motion-safe:duration-200",
        "motion-safe:open:translate-y-0 motion-safe:open:opacity-100",
        "motion-safe:starting:open:-translate-y-3 motion-safe:starting:open:opacity-0",
        className,
      )}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {description !== undefined && (
            <p id={descriptionId} className="text-sm text-ink-2">
              {description}
            </p>
          )}
        </div>
        {children}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={toneConfirmVariant[tone]}
            pending={pending}
            {...(pendingLabel === undefined ? {} : { pendingLabel })}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}