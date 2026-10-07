import type { ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

const fieldBase =
  "w-full rounded-sm border border-input bg-surface text-sm text-ink transition-colors placeholder:text-ink-3/80 disabled:cursor-not-allowed disabled:bg-sunk disabled:text-ink-3";

export const inputClass = cn(fieldBase, "h-9 px-2.5");

export const textareaClass = cn(fieldBase, "min-h-24 resize-y px-2.5 py-2");

export function fieldHintId(controlId: string): string {
  return `${controlId}-hint`;
}

export function fieldErrorId(controlId: string): string {
  return `${controlId}-error`;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-ink-3"> (wajib)</span>}
      </label>
      {children}
      {error !== undefined ? (
        <p
          id={fieldErrorId(htmlFor)}
          role="alert"
          className="text-xs text-crit"
        >
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p id={fieldHintId(htmlFor)} className="text-xs text-ink-3">
            {hint}
          </p>
        )
      )}
    </div>
  );
}