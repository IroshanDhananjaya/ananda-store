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
      {/* The blue band behind the title: a rounded panel the first row of cards rests on */}
      <div aria-hidden className="relative h-0 print:hidden">
        <div className="absolute -inset-x-2 -top-2 -z-10 h-52 rounded-3xl [background:var(--band)] shadow-[0_18px_40px_-20px_rgb(16_26_69/0.55)] sm:-inset-x-3 lg:-inset-x-4" />
      </div>
      <div ref={markRef} aria-hidden />
      <div
        ref={barRef}
        className={cn(
          "sticky top-[57px] z-20 -mx-4 border-b px-4 py-3 transition-[background-color,border-color,box-shadow] duration-200 sm:-mx-5 sm:px-5 lg:top-0 lg:-mx-8 lg:px-8",
          "print:static print:mx-0 print:border-0 print:bg-transparent print:px-0 print:shadow-none",
          stuck ? "border-transparent [background:var(--band)] shadow-[0_10px_24px_-12px_rgb(16_26_69/0.6)]" : "border-transparent",
        )}
      >
        {/* The buttons share the title's row when they fit (and fill their own row on a phone when they don't) */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h1
            className={cn(
              "min-w-0 font-semibold tracking-tight text-white transition-[font-size] duration-200 print:text-black",
              stuck ? "text-lg" : "text-[26px] leading-9",
            )}
          >
            {title}
          </h1>
          {actions && <div className="flex grow flex-wrap items-center justify-end gap-2 print:hidden">{actions}</div>}
        </div>
      </div>
      {/* Under the bar, so it scrolls away and the stuck bar stays one or two rows */}
      {description ? (
        <p className="mb-6 text-sm text-white/75 lg:truncate print:text-slate-600" title={typeof description === "string" ? description : undefined}>
          {description}
        </p>
      ) : (
        <div className="mb-6" />
      )}
    </>
  );
}
