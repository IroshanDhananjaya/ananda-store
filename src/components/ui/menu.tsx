"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonClass } from "./button";

export type MenuEntry =
  | {
      label: string;
      /** Second line, smaller */
      description?: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      /** Only listed below this screen width: for a button that's hidden there */
      until?: Breakpoint;
    }
  /** A small heading over the entries after it; "" is just a line */
  | { heading: string; until?: Breakpoint };

type Breakpoint = "sm" | "xl";
const hiddenFrom: Record<Breakpoint, string> = { sm: "sm:hidden", xl: "xl:hidden" };

/**
 * A button that opens a short list of actions. Falsy entries are skipped, so entries can be listed
 * conditionally; with none left the button isn't shown. The list is position: fixed so cards and
 * table scroll boxes don't cut it off.
 */
export function Menu({
  children,
  entries,
  variant = "outline",
  className,
  "aria-label": ariaLabel,
  title,
}: {
  /** The button's content */
  children: ReactNode;
  entries: (MenuEntry | false | null | undefined)[];
  variant?: "primary" | "secondary" | "outline" | "ghost";
  className?: string;
  "aria-label"?: string;
  title?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const list = entries.filter((e): e is MenuEntry => !!e);

  /** The entries shown (`until` ones are hidden on wider screens) */
  function items() {
    return [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].filter((el) => el.offsetParent !== null);
  }

  // A tap or focus anywhere else closes it, and so does Esc (capture: before a Modal's Esc, which then skips it)
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Under the button, lined up with its right edge, or above it when there's more room there; follows scrolling
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      const menu = listRef.current;
      if (!button || !menu) return;
      const r = button.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const up = below < menu.offsetHeight && r.top - 8 > below;
      Object.assign(menu.style, {
        left: `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`,
        top: `${up ? Math.max(8, r.top - menu.offsetHeight - 4) : r.bottom + 4}px`,
      });
    };
    place();
    items()[0]?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function onListKey(e: KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown" ? (at + 1) % all.length : e.key === "ArrowUp" ? (at - 1 + all.length) % all.length : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
    if (e.key === "Tab") setOpen(false);
    if (next === -1) return;
    e.preventDefault();
    all[next]?.focus();
  }

  if (list.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={buttonClass(variant, "md", className)}
      >
        {children}
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onListKey}
          className="fixed z-[60] w-max max-w-[min(20rem,calc(100vw-1rem))] min-w-52 rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {list.map((e, i) =>
            "heading" in e ? (
              <div
                key={i}
                role="presentation"
                className={cn(
                  i > 0 && "mt-1 border-t border-slate-100",
                  e.heading && "px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase",
                  e.until && hiddenFrom[e.until],
                )}
              >
                {e.heading}
              </div>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  e.onSelect();
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-100 focus:outline-none",
                  "[&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
                  e.danger ? "text-red-600" : "text-slate-800 [&_svg]:text-slate-500",
                  e.until && hiddenFrom[e.until],
                )}
              >
                {e.icon}
                <span className="min-w-0">
                  <span className="block font-medium">{e.label}</span>
                  {e.description && <span className={cn("block text-xs", e.danger ? "text-red-500" : "text-slate-500")}>{e.description}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
