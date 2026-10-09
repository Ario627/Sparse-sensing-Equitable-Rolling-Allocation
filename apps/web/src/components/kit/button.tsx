import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn.ts";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends Omit<ComponentPropsWithoutRef<"button">, "className"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly pending?: boolean;
  readonly pendingLabel?: string;
  readonly className?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-water text-surface hover:bg-water-deep active:translate-y-px",
  outline:
    "border border-line-2 bg-surface text-ink hover:border-ink-3/60 hover:bg-sunk active:translate-y-px",
  ghost:
    "border border-transparent bg-transparent text-ink-2 hover:bg-sunk hover:text-ink",
  danger:
    "border border-transparent bg-crit text-surface hover:bg-crit-deep active:translate-y-px",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-9 gap-1.5 px-3 text-xs",
  md: "min-h-11 gap-2 px-4 text-sm",
};

export function Button({
  variant = "outline",
  size = "md",
  pending = false,
  pendingLabel,
  disabled,
  type = "button",
  children,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || pending;
  return (
    <button
      {...rest}
      type={type}
      disabled={isDisabled}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex min-h-10 select-none items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,color,border-color,transform] duration-200 active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
