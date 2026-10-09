import {
  cloneElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { IconClose, IconInfo } from "@/components/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { Button, type ButtonSize, type ButtonVariant } from "./button.tsx";

function lockPageScroll(): () => void {
  const { documentElement } = document;
  const previous = documentElement.style.overflow;
  documentElement.style.overflow = "hidden";
  return () => {
    documentElement.style.overflow = previous;
  };
}

interface TriggerProps {
  readonly onClick?: () => void;
  readonly "aria-haspopup"?: string;
}

export interface InfoDialogProps {
  readonly label?: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly eyebrow?: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly triggerClassName?: string;
  readonly trigger?: ReactElement<TriggerProps>;
  readonly className?: string;
}

export function InfoDialog({
  label,
  title,
  children,
  eyebrow,
  variant = "ghost",
  size = "sm",
  triggerClassName,
  trigger,
  className,
}: InfoDialogProps) {
  const [open, setOpen] = useState(false);
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

  function close(): void {
    setOpen(false);
  }

  function openDialog(): void {
    setOpen(true);
  }

  function handleCancel(event: MouseEvent<HTMLDialogElement>): void {
    event.preventDefault();
    close();
  }

  const triggerNode =
    trigger === undefined ? (
      <Button
        variant={variant}
        size={size}
        aria-haspopup="dialog"
        onClick={openDialog}
        {...(triggerClassName === undefined ? {} : { className: triggerClassName })}
      >
        <IconInfo size={14} />
        {label ?? "Selengkapnya"}
      </Button>
    ) : (
      cloneElement(trigger, { onClick: openDialog, "aria-haspopup": "dialog" })
    );

  return (
    <>
      {triggerNode}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={handleCancel}
        onClose={close}
        className={cn(
          "w-[min(34rem,calc(100vw-2rem))] max-h-[min(85dvh,44rem)] overflow-y-auto",
          "motion-safe:-translate-y-3 motion-safe:opacity-0 motion-safe:transition-discrete motion-safe:transition-all motion-safe:duration-200",
          "motion-safe:open:translate-y-0 motion-safe:open:opacity-100",
          "motion-safe:starting:open:-translate-y-3 motion-safe:starting:open:opacity-0",
          className,
        )}
      >
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {eyebrow !== undefined && (
                <p className="label-caps text-water">{eyebrow}</p>
              )}
              <h2 id={titleId} className="mt-1 text-base font-semibold text-ink">
                {title}
              </h2>
            </div>
            <Button variant="ghost" size="sm" aria-label="Tutup" onClick={close}>
              <IconClose size={15} />
            </Button>
          </div>
          <div className="px-5 py-4 text-sm text-ink-2">{children}</div>
        </div>
      </dialog>
    </>
  );
}
