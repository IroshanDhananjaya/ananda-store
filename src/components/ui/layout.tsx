import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonClass } from "./button";

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 print:hidden">
      <ArrowLeft className="size-4" /> {children}
    </Link>
  );
}

export function NotFoundState({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-500">It may have been deleted.</p>
      <Link href={href} className={buttonClass("outline", "md", "mt-5")}>
        {linkLabel}
      </Link>
    </div>
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
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-xl font-semibold tracking-tight tabular-nums",
          tone === "danger" ? "text-red-600" : tone === "good" ? "text-emerald-700" : "text-slate-900",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Label / value pair for detail cards */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      {/* flex-1 + min-w-0: a long description wraps instead of squeezing the buttons onto two lines */}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // scroll-mt clears the sticky mobile header when paging scrolls back to the table top
    <section className={cn("scroll-mt-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Search + filters row above a table */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
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
        className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
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
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 text-slate-400 tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Summary line under a table; `pager` (page buttons) sits on the right */
export function TableFooter({ children, pager }: { children: ReactNode; pager?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <div>{children}</div>
      {pager}
    </div>
  );
}
