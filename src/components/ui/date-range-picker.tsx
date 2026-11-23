"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { addDays, cn, formatDate, todayISO } from "@/lib/utils";

export type DateRange = { from: string; to: string };

/** True when an ISO date is inside the range; with any limit set, a missing date is outside */
export function inDateRange(iso: string, { from, to }: DateRange) {
  if (!from && !to) return true;
  return !!iso && (!from || iso >= from) && (!to || iso <= to);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** A calendar month: year and month (0 = January) */
type Month = { y: number; m: number };

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO date of a day of a month; a day past its end (or before the 1st) rolls into the next (or last) month */
const isoOf = (y: number, m: number, d: number) => {
  const date = new Date(y, m, d);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const monthOf = (iso: string): Month => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1 });
const addMonths = ({ y, m }: Month, n: number): Month => {
  const date = new Date(y, m + n, 1);
  return { y: date.getFullYear(), m: date.getMonth() };
};
const monthsBetween = (a: Month, b: Month) => (b.y - a.y) * 12 + b.m - a.m;
const weekdayIndex = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8))).getDay();
const longDate = (iso: string) =>
  new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8))).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** The weeks a month's days fall in, Sunday first; the gaps are filled with days of the months either side */
function weeksOf({ y, m }: Month) {
  const lead = new Date(y, m, 1).getDay();
  const weeks = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => isoOf(y, m, w * 7 + d - lead + 1)));
}

/** The same day n months on (the month's last day when it's shorter) */
function shiftDay(iso: string, n: number) {
  const { y, m } = addMonths(monthOf(iso), n);
  return isoOf(y, m, Math.min(Number(iso.slice(8)), new Date(y, m + 1, 0).getDate()));
}

/** Two months side by side when the screen has room for them (and the quick choices), else one */
const monthsShown = () => (window.matchMedia("(min-width: 54rem)").matches ? 2 : 1);

/** Days from one ISO date to another, both counted */
const daysIn = (from: string, to: string) =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8))) / 86_400_000) + 1;

/** One-click ranges, worked out from today */
function presetsFor(today: string): { label: string; range: DateRange }[] {
  const { y, m } = monthOf(today);
  return [
    { label: "Today", range: { from: today, to: today } },
    { label: "Yesterday", range: { from: addDays(today, -1), to: addDays(today, -1) } },
    { label: "Last 7 days", range: { from: addDays(today, -6), to: today } },
    { label: "Last 30 days", range: { from: addDays(today, -29), to: today } },
    { label: "This month", range: { from: isoOf(y, m, 1), to: today } },
    { label: "Last month", range: { from: isoOf(y, m - 1, 1), to: isoOf(y, m, 0) } },
    { label: "This year", range: { from: isoOf(y, 0, 1), to: today } },
  ];
}

/**
 * From / to date filter (ISO dates) like Raigam SFA's: a box showing the dates that opens a
 * two-month calendar. Click the first day, then the last (the same day twice for one day).
 * An empty range means all dates. The calendar is position: fixed so cards and dialogs don't cut it off.
 */
export function DateRangePicker({
  id,
  value,
  onChange,
  placeholder = "All dates",
  clearable = true,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Shown in the box when no dates are picked */
  placeholder?: string;
  /** Offer Clear (back to all dates); off where a range is always needed */
  clearable?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Move focus to the `focused` day after the next render (opening, arrow keys) */
  const focusDay = useRef(false);
  const [open, setOpen] = useState(false);
  // Today and the first month shown are set on opening: Next stops a render that reads the clock
  const [today, setToday] = useState("");
  const [view, setView] = useState<Month>({ y: 0, m: 0 });
  /** First day clicked; the next click picks the last */
  const [anchor, setAnchor] = useState("");
  const [hover, setHover] = useState("");
  /** Day the arrow keys move from: the one day button in the tab order */
  const [focused, setFocused] = useState("");
  /** Months side by side: 2 when the screen has room, set on opening */
  const [shown, setShown] = useState(2);

  // Day first, as on every table and paper bill (not 2026-11-01)
  const text =
    value.from && value.from === value.to
      ? formatDate(value.from)
      : value.from || value.to
        ? `${value.from ? formatDate(value.from) : "…"} – ${value.to ? formatDate(value.to) : "…"}`
        : placeholder;

  function show() {
    const now = todayISO();
    const start = value.from || value.to || now;
    setToday(now);
    setShown(monthsShown());
    setView(monthOf(start));
    setFocused(start);
    setAnchor("");
    setHover("");
    setOpen(true);
    focusDay.current = true;
  }

  function hide(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  // A tap or focus anywhere else closes it, and so does Esc
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture: runs before Modal's Esc, which then skips it (defaultPrevented), so only the calendar closes
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
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

  // Under the box, or above it when there's more room there; follows scrolling
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const r = trigger.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const up = below < panel.offsetHeight && r.top - 8 > below;
      Object.assign(panel.style, {
        left: `${Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8))}px`,
        top: `${up ? Math.max(8, r.top - panel.offsetHeight - 6) : r.bottom + 6}px`,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, view]);

  useEffect(() => {
    if (!open || !focusDay.current) return;
    focusDay.current = false;
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus({ preventScroll: true });
  });

  function pick(day: string) {
    setFocused(day);
    if (!anchor) {
      // The first day on its own already filters, so closing here keeps just that day
      setAnchor(day);
      onChange({ from: day, to: day });
    } else {
      onChange(anchor <= day ? { from: anchor, to: day } : { from: day, to: anchor });
      hide(true);
    }
  }

  function choose(range: DateRange) {
    onChange(range);
    hide(true);
  }

  function moveTo(day: string) {
    const ahead = monthsBetween(view, monthOf(day));
    if (ahead < 0) setView(monthOf(day));
    else if (ahead >= shown) setView(addMonths(monthOf(day), 1 - shown));
    setFocused(day);
    if (anchor) setHover(day);
    focusDay.current = true;
  }

  function onGridKey(e: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string;
    if (e.key in steps) next = addDays(focused, steps[e.key]);
    else if (e.key === "Home") next = addDays(focused, -weekdayIndex(focused));
    else if (e.key === "End") next = addDays(focused, 6 - weekdayIndex(focused));
    else if (e.key === "PageUp" || e.key === "PageDown") next = shiftDay(focused, (e.key === "PageUp" ? -1 : 1) * (e.shiftKey ? 12 : 1));
    else return;
    e.preventDefault();
    moveTo(next);
  }

  // While picking the last day, the range runs from the first day to the one under the pointer
  const [lo, hi] = anchor ? [anchor, hover || anchor].sort() : [value.from, value.to || value.from];
  const thisYear = Number(today.slice(0, 4));
  // The arrow-key day, or the 1st of the first month when that day is scrolled out of view
  const ahead = focused ? monthsBetween(view, monthOf(focused)) : -1;
  const tabDay = ahead >= 0 && ahead < shown ? focused : isoOf(view.y, view.m, 1);
  const presets = today ? presetsFor(today) : [];
  const activePreset = presets.find((p) => p.range.from === value.from && p.range.to === value.to)?.label;

  function renderMonth(i: number) {
    const month = addMonths(view, i);
    const key = `${month.y}-${pad(month.m + 1)}`;
    const firstYear = Math.min(thisYear - 5, month.y);
    const years = Array.from({ length: Math.max(thisYear + 1, month.y) - firstYear + 1 }, (_, n) => firstYear + n);
    // The second month's boxes move the first month too, so the two stay side by side
    const goTo = (m: Month) => setView(addMonths(m, -i));
    const last = i === shown - 1;

    return (
      // Fixed width: 7 columns of 40px, so days never squeeze into each other
      <div key={i} className="w-[17.5rem] shrink-0">
        <div className="mb-2 flex h-9 items-center gap-1">
          {i === 0 ? <NavButton dir="prev" onClick={() => setView(addMonths(view, -1))} /> : <span className="size-8 shrink-0" />}
          <div className="flex flex-1 items-center justify-center">
            <MiniSelect label="Month" value={month.m} options={MONTHS.map((name, m) => [m, name])} onChange={(m) => goTo({ y: month.y, m })} />
            <MiniSelect label="Year" value={month.y} options={years.map((y) => [y, String(y)])} onChange={(y) => goTo({ y, m: month.m })} />
          </div>
          {last ? <NavButton dir="next" onClick={() => setView(addMonths(view, 1))} /> : <span className="size-8 shrink-0" />}
        </div>
        <div role="grid" aria-label={`${MONTHS[month.m]} ${month.y}`} onKeyDown={onGridKey}>
          <div role="row" className="grid grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div key={d} role="columnheader" className="grid h-8 place-items-center text-[11px] font-medium text-slate-400">
                {d}
              </div>
            ))}
          </div>
          {weeksOf(month).map((week) => (
            <div key={week[0]} role="row" className="grid grid-cols-7">
              {week.map((day, col) => {
                const outside = !day.startsWith(key);
                const inRange = !!lo && day >= lo && day <= hi && !outside;
                const isEnd = inRange && (day === lo || day === hi);
                const band = inRange && lo !== hi;
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-selected={inRange}
                    className={cn(
                      "relative grid h-10 place-items-center",
                      // The light band joining the first and last day (rounded where a week or the range ends)
                      band && "bg-brand-50",
                      band && (day === lo || col === 0 || day.endsWith("-01")) && "rounded-l-full",
                      band && (day === hi || col === 6 || addDays(day, 1).slice(0, 7) !== key) && "rounded-r-full",
                    )}
                  >
                    {outside ? (
                      <span className="text-sm text-slate-300 tabular-nums" aria-hidden>
                        {Number(day.slice(8))}
                      </span>
                    ) : (
                      <button
                        type="button"
                        tabIndex={day === tabDay ? 0 : -1}
                        data-day={day}
                        aria-label={longDate(day)}
                        aria-current={day === today ? "date" : undefined}
                        onClick={() => pick(day)}
                        onMouseEnter={() => anchor && setHover(day)}
                        className={cn(
                          "relative grid size-9 place-items-center rounded-full text-sm tabular-nums transition-colors",
                          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400",
                          isEnd
                            ? "bg-brand-600 font-semibold text-white hover:bg-brand-700"
                            : inRange
                              ? "font-medium text-brand-900 hover:bg-brand-100"
                              : "text-slate-700 hover:bg-slate-100",
                          day === today && !isEnd && "font-semibold text-slate-900",
                        )}
                      >
                        {Number(day.slice(8))}
                        {/* Today: a small dot under the number */}
                        {day === today && <span className={cn("absolute bottom-1 size-1 rounded-full", isEnd ? "bg-white" : "bg-accent-500")} aria-hidden />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    // Full width on phones (toolbars stack), its own width from sm up; stretches in a form Field
    <div ref={rootRef} className="relative w-full sm:w-auto">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${text}` : undefined}
        onClick={() => (open ? hide(false) : show())}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm whitespace-nowrap shadow-[0_1px_2px_rgb(16_18_27/0.04)] transition-[border-color,box-shadow] hover:border-slate-300 pointer-coarse:h-11",
          "focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15 focus-visible:outline-none",
          open && "border-brand-500 ring-4 ring-brand-500/15",
          className,
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-slate-500" />
        <span className={cn("truncate tabular-nums", value.from || value.to ? "text-slate-900" : "text-slate-500")}>{text}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose dates"
          className="fixed z-[60] max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-2xl border border-slate-200/80 bg-white shadow-raised"
        >
          <div className="flex flex-col sm:flex-row">
            {/* Quick choices: a list beside the calendar, chips above it on a phone */}
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-3 sm:w-40 sm:flex-col sm:flex-nowrap sm:gap-0.5 sm:border-r sm:border-b-0">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => choose(p.range)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-left text-[13px] font-medium whitespace-nowrap transition-colors max-sm:border",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400",
                    p.label === activePreset
                      ? "bg-brand-600 text-white max-sm:border-brand-600"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 max-sm:border-slate-200",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-6 p-4">{Array.from({ length: shown }, (_, i) => renderMonth(i))}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <p className="text-[13px] text-slate-500">
              {anchor ? (
                "Now click the last day"
              ) : lo ? (
                <>
                  <span className="font-medium text-slate-900 tabular-nums">{lo === hi ? formatDate(lo) : `${formatDate(lo)} – ${formatDate(hi)}`}</span>
                  <span className="ml-1.5">
                    · {daysIn(lo, hi)} day{daysIn(lo, hi) === 1 ? "" : "s"}
                  </span>
                </>
              ) : (
                "Click the first day, then the last"
              )}
            </p>
            <div className="flex items-center gap-2">
              {clearable && (
                <button
                  type="button"
                  onClick={() => choose({ from: "", to: "" })}
                  className="h-8 rounded-lg px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => hide(true)}
                className="h-8 rounded-lg bg-brand-600 px-4 text-[13px] font-medium text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavButton({ dir, onClick, className }: { dir: "prev" | "next"; onClick: () => void; className?: string }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function MiniSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: [number, string][];
  onChange: (value: number) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 cursor-pointer appearance-none rounded-lg bg-transparent pr-6 pl-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-400"
      >
        {options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
