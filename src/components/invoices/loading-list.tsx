"use client";

import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { FilterTabs, TableFooter } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, GroupRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { categoryOf } from "@/lib/categories";
import { useAppStore, useCategoryRanks, useItemMap } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { lineValue } from "@/lib/ledger";
import { cn, formatMoney, formatQty, includesText, LOW_STOCK_LEVEL } from "@/lib/utils";

type ItemTotal = {
  sapCode: string;
  bills: number;
  /** Everything on the bills */
  booked: number;
  /** Given free: on bill lines priced 0 */
  free: number;
  /** On bills already loaded or delivered (out of stock) */
  loaded: number;
  /** Not in the store when those bills were loaded (not loaded, taken off the bills) */
  missing: number;
  /** On bills still waiting to load */
  toLoad: number;
  /** Booked qty × unit price, before bill discounts */
  value: number;
  /** Available now, all locations */
  inStock: number;
};

type SortKey = "sapCode" | "name" | "uom" | "bills" | "booked" | "free" | "loaded" | "toLoad" | "inStock" | "after" | "value";

/**
 * Stock for loading the bills still waiting (To Load): none in the store, not enough, enough but little left after,
 * or fine. Items with nothing to load are "none".
 */
type StockState = "missing" | "short" | "low" | "ok" | "none";
const stockState = (r: { toLoad: number; inStock: number }): StockState => {
  if (r.toLoad <= 0) return "none";
  if (r.inStock <= 0) return "missing";
  if (r.inStock < r.toLoad) return "short";
  return r.inStock - r.toLoad <= LOW_STOCK_LEVEL ? "low" : "ok";
};
/** Which items to list */
type Show = "all" | "toLoad" | "missing" | "short" | "low";
const SHOWS: Record<Show, (st: StockState) => boolean> = {
  all: () => true,
  toLoad: (st) => st !== "none",
  missing: (st) => st === "missing",
  short: (st) => st === "short",
  low: (st) => st === "low",
};

function StockStateBadge({ state }: { state: StockState }) {
  if (state === "missing") return <Badge tone="red">Not in store</Badge>;
  if (state === "short") return <Badge tone="amber">Short</Badge>;
  if (state === "low") return <Badge tone="blue">Low after loading</Badge>;
  if (state === "ok") return <Badge tone="green">Enough</Badge>;
  return <span className="text-slate-400">—</span>;
}
type Sort = { key: SortKey; dir: "asc" | "desc" };
const TEXT_KEYS: SortKey[] = ["sapCode", "name", "uom"];

/** Column heading that sorts the list; text columns start A–Z, numbers biggest first */
function SortTH({
  k,
  sort,
  onSort,
  right,
  title,
  children,
}: {
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  right?: boolean;
  title?: string;
  children: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TH className={cn(right && "text-right")} title={title} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-1 tracking-wide uppercase hover:text-brand-100 print:pointer-events-none", right && "flex-row-reverse")}
      >
        {children}
        <Icon className={cn("size-3.5 print:hidden", active ? "opacity-100" : "opacity-60")} aria-hidden />
      </button>
    </TH>
  );
}

/** Total quantity of each item across the given bills (the loading list) */
export function LoadingList({ sales, query }: { sales: Sale[]; query: string }) {
  const stock = useAppStore((s) => s.stock);
  const itemMap = useItemMap();
  const ranks = useCategoryRanks();
  const [sort, setSort] = useState<Sort>({ key: "sapCode", dir: "asc" });
  const [show, setShow] = useState<Show>("all");

  const rows = useMemo(() => {
    const map = new Map<string, ItemTotal & { saleIds: Set<string> }>();
    for (const s of sales) {
      // An item taken off the bill on Raigam (nothing left) isn't loaded
      for (const l of s.lines.filter((x) => x.qty + x.freeQty > 0)) {
        const row =
          map.get(l.sapCode) ??
          { sapCode: l.sapCode, bills: 0, booked: 0, free: 0, loaded: 0, missing: 0, toLoad: 0, value: 0, inStock: 0, saleIds: new Set() };
        row.saleIds.add(s.id);
        // Booking = qty sold; free issue (and lines priced 0) go on the lorry too but aren't charged
        const free = l.freeQty + (l.unitPrice === 0 ? l.qty : 0);
        row.booked += l.qty;
        row.free += free;
        if (s.status === "Ordered") row.toLoad += l.qty + l.freeQty;
        else {
          row.loaded += l.qty + l.freeQty - l.missingQty;
          row.missing += l.missingQty;
        }
        row.value += lineValue({ ...l, cancelQty: 0, missingQty: 0 });
        map.set(l.sapCode, row);
      }
    }
    return [...map.values()].map(({ saleIds, ...r }) => ({
      ...r,
      bills: saleIds.size,
      inStock: stock.filter((x) => x.sapCode === r.sapCode).reduce((n, x) => n + x.availableQty, 0),
    }));
  }, [sales, stock]);

  const sortValue = (r: ItemTotal): string | number => {
    if (sort.key === "name") return itemMap.get(r.sapCode)?.description ?? "";
    if (sort.key === "uom") return itemMap.get(r.sapCode)?.uom ?? "";
    if (sort.key === "after") return r.inStock - r.toLoad;
    return r[sort.key];
  };
  const categoryOfRow = (r: ItemTotal) => categoryOf(itemMap.get(r.sapCode));
  const rankOf = (r: ItemTotal) => ranks.get(categoryOfRow(r)) ?? ranks.size;
  // Under their item categories (Raigam's sheet order); the chosen column sorts within each category
  const searched = rows.filter((r) => {
    const item = itemMap.get(r.sapCode);
    return includesText([r.sapCode, item?.description, item?.packageDetails, categoryOf(item)], query);
  });
  const countOf = (sh: Show) => searched.filter((r) => SHOWS[sh](stockState(r))).length;
  const visible = rows
    .filter((r) => SHOWS[show](stockState(r)))
    .filter((r) => {
      const item = itemMap.get(r.sapCode);
      return includesText([r.sapCode, item?.description, item?.packageDetails, categoryOf(item)], query);
    })
    .sort((a, b) => {
      const x = sortValue(a);
      const y = sortValue(b);
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return rankOf(a) - rankOf(b) || (sort.dir === "asc" ? order : -order) || a.sapCode.localeCompare(b.sapCode);
    });
  const pager = usePagination(visible, [query, sort, sales.length, show]);
  const onPage = (i: number) => i >= pager.start && i < pager.start + pager.pageSize;
  const sum = (fn: (r: ItemTotal) => number) => visible.reduce((acc, r) => acc + fn(r), 0);
  const short = visible.filter((r) => r.toLoad > r.inStock);

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: TEXT_KEYS.includes(key) ? "asc" : "desc" }));
  }
  const th = { sort, onSort: sortBy };

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center print:hidden">
        <FilterTabs<Show>
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: "All items", count: countOf("all") },
            { value: "toLoad", label: "To load", count: countOf("toLoad") },
            { value: "missing", label: "Not in store", count: countOf("missing") },
            { value: "short", label: "Short", count: countOf("short") },
            { value: "low", label: `Low after loading (≤ ${LOW_STOCK_LEVEL})`, count: countOf("low") },
          ]}
        />
        <p className="text-xs text-slate-500 sm:ml-auto">To load = qty + free on bills not loaded yet, compared with stock now.</p>
      </div>
      <Table>
        <THead>
          <tr>
            <SortTH k="sapCode" {...th}>
              SAP Code
            </SortTH>
            <SortTH k="name" {...th}>
              Item Name
            </SortTH>
            <SortTH k="uom" {...th}>
              UOM
            </SortTH>
            <SortTH k="bills" right {...th}>
              Bills
            </SortTH>
            <SortTH k="booked" right {...th} title="Everything on the bills">
              Booking Qty
            </SortTH>
            <SortTH k="free" right {...th} title="Free issue (Raigam scheme), not charged">
              Free Qty
            </SortTH>
            <SortTH k="loaded" right {...th} title="Qty + free on bills already loaded on a lorry or delivered">
              Loading Qty
            </SortTH>
            <SortTH k="toLoad" right {...th} title="Qty + free on bills still waiting to be loaded">
              To Load
            </SortTH>
            <SortTH k="inStock" right {...th} title="Available in the warehouse now, all locations">
              In Stock
            </SortTH>
            <SortTH k="after" right {...th} title="In stock less To load: what's left in the store once these bills are loaded">
              Left After Load
            </SortTH>
            <TH>Stock</TH>
            <SortTH k="value" right {...th} title="Booking qty × price less item discounts, before bill discounts">
              Booking Value
            </SortTH>
          </tr>
        </THead>
        <TBody>
          {visible.length === 0 && (
            <EmptyRow colSpan={12}>{rows.length ? (show === "all" ? "No items match the search." : "No items here.") : "No items on bills for these dates."}</EmptyRow>
          )}
          {visible.map((r, i) => {
            const item = itemMap.get(r.sapCode);
            const isShort = r.toLoad > r.inStock;
            const state = stockState(r);
            const startsCategory = i === 0 || categoryOfRow(r) !== categoryOfRow(visible[i - 1]);
            return (
              // Rows on other pages are hidden on screen but still printed
              <Fragment key={r.sapCode}>
                {startsCategory ? (
                  <GroupRow colSpan={12} className={cn(!onPage(i) && "hidden print:table-row")}>
                    {categoryOfRow(r)}
                  </GroupRow>
                ) : (
                  // A page that starts inside a category repeats its heading on screen
                  i === pager.start && (
                    <GroupRow colSpan={12} className="print:hidden">
                      {categoryOfRow(r)} <span className="font-normal text-slate-500 normal-case">(continued)</span>
                    </GroupRow>
                  )
                )}
                <TR className={cn(state === "missing" ? "bg-red-50/70" : isShort && "bg-amber-50/50", !onPage(i) && "hidden print:table-row")}>
                  <TD className="font-mono text-xs text-slate-900">{r.sapCode}</TD>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{item?.description ?? "Deleted item"}</span>
                    {item?.packageDetails && <span className="block text-xs text-slate-500">{item.packageDetails}</span>}
                  </TD>
                  <TD>{item?.uom ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{formatQty(r.bills)}</TD>
                  <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.booked)}</TD>
                  <TD className="text-right tabular-nums">{r.free ? formatQty(r.free) : "—"}</TD>
                  <TD className="text-right tabular-nums">
                    {r.loaded ? formatQty(r.loaded) : "—"}
                    {r.missing > 0 && <span className="block text-xs font-medium text-amber-700">{formatQty(r.missing)} reduced</span>}
                  </TD>
                  <TD className={cn("text-right tabular-nums", r.toLoad > 0 && "font-semibold text-slate-900")}>{r.toLoad ? formatQty(r.toLoad) : "—"}</TD>
                  <TD className={cn("text-right tabular-nums", isShort && "font-semibold text-red-600")}>
                    {formatQty(r.inStock)}
                    {isShort && <span className="block text-xs font-medium">short {formatQty(r.toLoad - r.inStock)}</span>}
                  </TD>
                  <TD className={cn("text-right tabular-nums", r.toLoad > 0 && r.inStock - r.toLoad <= LOW_STOCK_LEVEL && "font-medium text-amber-700")}>
                    {r.toLoad > 0 ? formatQty(Math.max(0, r.inStock - r.toLoad)) : "—"}
                  </TD>
                  <TD>
                    <StockStateBadge state={state} />
                  </TD>
                  <TD className="text-right tabular-nums">{formatMoney(r.value)}</TD>
                </TR>
              </Fragment>
            );
          })}
        </TBody>
      </Table>
      <TableFooter pager={<Pagination pager={pager} />}>
        {formatQty(visible.length)} item{visible.length === 1 ? "" : "s"} · Booking {formatQty(sum((r) => r.booked))} units
        {sum((r) => r.free) > 0 && ` (${formatQty(sum((r) => r.free))} free)`} · Loading{" "}
        {formatQty(sum((r) => r.loaded))}
        {sum((r) => r.missing) > 0 && ` (${formatQty(sum((r) => r.missing))} reduced)`} · To load {formatQty(sum((r) => r.toLoad))} ·{" "}
        <span className="font-medium text-slate-700">Booking value {formatMoney(sum((r) => r.value))}</span> (before bill discounts)
        {short.length > 0 && (
          <span className="font-medium text-red-600">
            {" "}
            · {visible.filter((r) => stockState(r) === "missing").length} not in store, {visible.filter((r) => stockState(r) === "short").length} short
          </span>
        )}
      </TableFooter>
    </>
  );
}
