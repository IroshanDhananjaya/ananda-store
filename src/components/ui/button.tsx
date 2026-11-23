"use client";

import type { ComponentProps } from "react";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

// Clear and calm: 14px text, comfortable height, soft depth; a press visibly sinks. Touch screens get taller buttons.
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap select-none " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 " +
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(16_26_69/0.2),0_6px_14px_-6px_rgb(36_73_216/0.6)] ring-1 ring-white/10 ring-inset hover:from-brand-600 hover:to-brand-700",
  secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200/80",
  outline: "border border-slate-200 bg-white text-slate-800 shadow-[0_1px_2px_rgb(16_26_69/0.05)] hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-800",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-red-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_18_27/0.12)] hover:bg-red-700",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] pointer-coarse:h-10",
  md: "h-9 px-4 pointer-coarse:h-11",
  icon: "size-9 pointer-coarse:size-11",
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
