import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Splits table rows into pages. Goes back to page 1 when `filters` change (search
 * text, dropdowns), and stays in range when rows are deleted.
 */
export function usePagination<T>(rows: T[], filters: unknown[] = [], initialSize = 25) {
  const [pageSize, setPageSize] = useState(initialSize);
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(filters);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    pageRows: rows.slice(start, start + pageSize),
    page: current,
    pageCount,
    pageSize,
    start,
    total: rows.length,
    setPage,
    /** Keeps the first row on screen in view */
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(Math.floor(start / size) + 1);
    },
  };
}

export type Pager = ReturnType<typeof usePagination>;

/** Page numbers to show: first, last, and the ones around the current page */
function pageList(page: number, count: number): (number | "gap")[] {
  const pages: (number | "gap")[] = [];
  for (let p = 1; p <= count; p++) {
    if (p === 1 || p === count || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages.at(-1) !== "gap") pages.push("gap");
  }
  return pages;
}

/** Rows-per-page and page buttons, for the right side of a TableFooter */
export function Pagination({ pager }: { pager: Pager }) {
  const { page, pageCount, pageSize, start, total } = pager;
  // A short list fits on one page whatever the page size
  if (total <= PAGE_SIZES[0]) return null;

  const go = (p: number) => (e: MouseEvent<HTMLButtonElement>) => {
    pager.setPage(p);
    e.currentTarget.closest("section")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
      <label className="flex items-center gap-2">
        Rows
        <select
          value={pageSize}
          onChange={(e) => pager.setPageSize(Number(e.target.value))}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <span className="tabular-nums">
        {start + 1}–{Math.min(start + pageSize, total)} of {total}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={go(page - 1)} disabled={page === 1} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          {pageList(page, pageCount).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-slate-400">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "secondary" : "ghost"}
                size="icon"
                onClick={go(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                className={cn("text-xs tabular-nums", p === page && "font-semibold")}
              >
                {p}
              </Button>
            ),
          )}
          <Button variant="ghost" size="icon" onClick={go(page + 1)} disabled={page === pageCount} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      )}
    </nav>
  );
}
