"use client";

import type { ComponentProps } from "react";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

// Compact, Linear-style: small radius, 13px text, quiet borders. Touch screens get taller buttons.
const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 " +
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.08)] hover:bg-brand-700",
  secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200",
  outline: "border border-slate-200 bg-white text-slate-700 shadow-[0_1px_1px_rgb(0_0_0/0.03)] hover:bg-slate-50 hover:text-slate-900",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-red-600 text-white shadow-[0_1px_2px_rgb(0_0_0/0.08)] hover:bg-red-700",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 pointer-coarse:h-9",
  md: "h-8 px-3 pointer-coarse:h-10",
  icon: "size-8 pointer-coarse:size-10",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

/**
 * A Save (type="submit") button greys out and shows a spinner while a change is being saved,
 * so it's clear something is happening and a second tap can't save it twice.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  const saving = useAppStore((s) => s.saving);
  const busy = type === "submit" && saving;
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {busy && <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" aria-hidden />}
      {children}
    </button>
  );
}
