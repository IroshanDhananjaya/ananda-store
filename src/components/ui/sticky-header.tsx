"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A page's title and buttons, kept at the top of the screen while the page scrolls, so its
 * buttons never need scrolling back to. On phones it sits under the app's top bar (57px tall).
 * It turns white with a shadow once it sticks. No backdrop blur: that would make the menus'
 * position: fixed lists place themselves inside the bar instead of the screen.
 */
export function StickyHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  const markRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    // Stuck once the spot it started from has scrolled above where it sticks
    const check = () => {
      const mark = markRef.current;
      const bar = barRef.current;
      if (mark && bar) setStuck(mark.getBoundingClientRect().top < parseFloat(getComputedStyle(bar).top) - 0.5);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <>
      <div ref={markRef} aria-hidden />
      <div
        ref={barRef}
        className={cn(
          "sticky top-[57px] z-20 -mx-4 border-b px-4 py-3 transition-[background-color,border-color,box-shadow] sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8",
          "print:static print:mx-0 print:border-0 print:bg-transparent print:px-0 print:shadow-none",
          stuck ? "border-slate-200 bg-white shadow-[0_6px_16px_-10px_rgb(15_23_42/0.25)]" : "border-transparent",
        )}
      >
        {/* The buttons share the title's row when they fit (and fill their own row on a phone when they don't) */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {actions && <div className="flex grow flex-wrap items-center justify-end gap-2 print:hidden">{actions}</div>}
        </div>
      </div>
      {/* Under the bar, so it scrolls away and the stuck bar stays one or two rows */}
      {description ? <p className="mb-6 text-sm text-slate-500">{description}</p> : <div className="mb-3" />}
    </>
  );
}
