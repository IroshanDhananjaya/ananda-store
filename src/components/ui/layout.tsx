import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { X } from "lucide-react";
import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button, buttonClass } from "./button";
import { StickyHeader } from "./sticky-header";

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group mb-1 inline-flex items-center gap-1.5 rounded-md py-0.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-900 print:hidden"
    >
      <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" /> {children}
    </Link>
  );
}

export function NotFoundState({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-500">It may have been deleted.</p>
      <Link href={href} className={buttonClass("outline", "md", "mt-5")}>
        {linkLabel}
      </Link>
    </div>
  );
}

/** "Rs. 219,919.75" → a smaller, lighter "Rs." so the number itself stands out (also inside a wrapping span) */
function moneyParts(node: ReactNode): ReactNode {
  if (typeof node === "string") {
    const m = /^(−\s*)?(Rs\.)\s*(.*)$/.exec(node);
    if (!m) return node;
    return (
      <>
        {m[1]}
        <span className="mr-[0.3em] text-[0.62em] font-normal tracking-normal opacity-60">{m[2]}</span>
        {m[3]}
      </>
    );
  }
  if (isValidElement<{ children?: ReactNode }>(node) && typeof node.props.children === "string") {
    return cloneElement(node, undefined, moneyParts(node.props.children));
  }
  return node;
}

/**
 * A big figure (an amount or a count) that always stays on one line: it scales with the width of
 * the card it's in, so "Rs. 219,919.75" never breaks after "Rs.". Put it inside an `@container`.
 */
export function Figure({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("leading-tight font-semibold tracking-tight whitespace-nowrap tabular-nums", "text-[clamp(1.05rem,9cqi,1.75rem)]", className)}>
      {moneyParts(children)}
    </p>
  );
}

/** Small figure used in summary rows on detail pages */
export function SummaryTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "danger" | "good";
}) {
  return (
    <div
      className={cn(
        "@container relative min-w-0 overflow-hidden rounded-2xl bg-white px-5 py-4 shadow-card ring-1 ring-slate-200/60",
        // A coloured accent down the left: blue, green for good news, red for money owed
        "before:absolute before:inset-y-4 before:left-0 before:w-1 before:rounded-r-full",
        tone === "danger" ? "before:bg-red-500" : tone === "good" ? "before:bg-emerald-500" : "before:bg-brand-500",
      )}
    >
      <p className="truncate text-[13px] font-medium text-slate-500">{label}</p>
      <Figure className={cn("mt-2", tone === "danger" ? "text-red-600" : tone === "good" ? "text-emerald-700" : "text-slate-900")}>{value}</Figure>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Label / value pair for detail cards */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-slate-500">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

/** A page's title and buttons, pinned to the top of the screen while the page scrolls (StickyHeader) */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return <StickyHeader title={title} description={description} actions={actions} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // scroll-mt clears the sticky mobile header when paging scrolls back to the table top
    <section className={cn("scroll-mt-20 overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200/60", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Search + filters row above a table */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-slate-100 bg-white px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
    </div>
  );
}

export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm shadow-[0_1px_2px_rgb(16_18_27/0.04)] transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none pointer-coarse:h-11"
        {...props}
      />
    </div>
  );
}

/** Small pill-style toggle used for status filters */
export function FilterTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-medium transition-[background-color,border-color,color] pointer-coarse:h-10",
              on
                ? "border-brand-600 bg-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(36_73_216/0.6)]"
                : "border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-800",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  "ml-2 rounded-full px-1.5 text-xs leading-5 tabular-nums",
                  on ? "bg-white/20 font-semibold text-white" : "bg-slate-100 text-slate-500",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Shown in a Toolbar while any filter is on: one click puts every filter back */
export function ClearFilters({ active, onClear }: { active: boolean; onClear: () => void }) {
  if (!active) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onClear} className="text-brand-700 hover:bg-brand-50 hover:text-brand-800" title="Show everything again">
      <X /> Clear filters
    </Button>
  );
}

/** Summary line under a table; `pager` (page buttons) sits on the right */
export function TableFooter({ children, pager }: { children: ReactNode; pager?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 bg-white px-5 py-2.5 text-[13px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <div>{children}</div>
      {pager}
    </div>
  );
}
