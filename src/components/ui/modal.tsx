"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const widths = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  // Opens like a page: the whole screen, no rounded edges
  full: "h-dvh max-h-dvh max-w-none rounded-none sm:rounded-none",
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Rendered inline (not portalled) on purpose: when Next.js hides a route with
 * <Activity>, a modal inside that route is hidden with it.
 *
 * Typing is never lost by accident: once something has been typed in the dialog, a tap on
 * the shade behind it does nothing, and Esc / the X ask before closing. (The dialog's own
 * Cancel button still closes straight away: that is a clear choice.)
 * The keyboard stays inside the dialog, and goes back to where it was when it closes.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: keyof typeof widths;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Something was typed or picked in the dialog since it opened
  const dirty = useRef(false);

  // Callers often pass a new onClose on every render: keep the latest without re-running the effect below
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /** Close, asking first when something was typed */
  const tryClose = useCallback(() => {
    if (dirty.current && !window.confirm("Close without saving? What you typed will be lost.")) return;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    dirty.current = false;
    const before = document.activeElement as HTMLElement | null;
    // Start inside the dialog, unless a field in it already took the focus (autoFocus)
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    });
    // defaultPrevented: something inside (e.g. an open search list) already used this Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) tryClose();
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.dataset.modalOpen = "true";
    return () => {
      document.removeEventListener("keydown", onKey);
      delete document.documentElement.dataset.modalOpen;
      // Back to the button that opened it
      if (before?.isConnected) before.focus();
    };
  }, [open, tryClose]);

  // Tab and Shift+Tab go round the dialog's own buttons and boxes, not the page behind it
  const keepFocusInside = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const all = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
    if (all.length === 0) return;
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div className={cn("fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center", size !== "full" && "sm:p-4")}>
      {/* A stray tap here only closes a dialog nothing was typed into */}
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => !dirty.current && onCloseRef.current()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onInput={() => (dirty.current = true)}
        onChange={() => (dirty.current = true)}
        onKeyDown={keepFocusInside}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-slate-200 bg-white shadow-[0_16px_48px_-12px_rgb(0_0_0/0.25)] outline-none sm:rounded-xl",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={tryClose}
            className="-m-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 pointer-coarse:-m-2 pointer-coarse:p-2.5"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
