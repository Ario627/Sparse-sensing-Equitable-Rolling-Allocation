import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export type LinkButtonVariant = "primary" | "outline" | "ghost";
export type LinkButtonSize = "sm" | "md";

const variantClasses: Record<LinkButtonVariant, string> = {
  primary:
    "border border-transparent bg-water text-surface hover:bg-water-deep",
  outline:
    "border border-line-2 bg-surface text-ink hover:border-ink-3/60 hover:bg-sunk",
  ghost: "border border-transparent text-ink-2 hover:bg-sunk hover:text-ink",
};

const sizeClasses: Record<LinkButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-1.5 px-3.5 text-sm",
};

export function linkButtonClass(
  variant: LinkButtonVariant = "outline",
  size: LinkButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex select-none items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors",
    sizeClasses[size],
    variantClasses[variant],
    className,
  );
}

export interface LinkButtonProps {
  readonly to: NonNullable<LinkProps["to"]>;
  readonly variant?: LinkButtonVariant;
  readonly size?: LinkButtonSize;
  readonly className?: string;
  readonly children: ReactNode;
}

export function LinkButton({
  to,
  variant = "outline",
  size = "md",
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link to={to} className={linkButtonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
