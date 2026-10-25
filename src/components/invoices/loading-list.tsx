"use client";

import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { TableFooter } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { lineValue } from "@/lib/ledger";
import { cn, formatMoney, formatQty, includesText } from "@/lib/utils";

type ItemTotal = {
  sapCode: string;
  bills: number;
  /** Everything on the bills */
  booked: number;
  /** Given free: on bill lines priced 0 */
  free: number;
  /** On bills already loaded or delivered (out of stock) */
  loaded: number;
  /** On bills still waiting to load */
  toLoad: number;
  /** Booked qty × unit price, before bill discounts */
  value: number;
  /** Available now, all locations */
  inStock: number;
};

type SortKey = "sapCode" | "name" | "uom" | "bills" | "booked" | "free" | "loaded" | "toLoad" | "inStock" | "value";
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
  const [sort, setSort] = useState<Sort>({ key: "sapCode", dir: "asc" });

  const rows = useMemo(() => {
    const map = new Map<string, ItemTotal & { saleIds: Set<string> }>();
    for (const s of sales) {
      // An item taken off the bill on Raigam (nothing left) isn't loaded
      for (const l of s.lines.filter((x) => x.qty + x.freeQty > 0)) {
        const row =
          map.get(l.sapCode) ?? { sapCode: l.sapCode, bills: 0, booked: 0, free: 0, loaded: 0, toLoad: 0, value: 0, inStock: 0, saleIds: new Set() };
        row.saleIds.add(s.id);
        // Booking = qty sold; free issue (and lines priced 0) go on the lorry too but aren't charged
        const free = l.freeQty + (l.unitPrice === 0 ? l.qty : 0);
        row.booked += l.qty;
        row.free += free;
        if (s.status === "Ordered") row.toLoad += l.qty + l.freeQty;
        else row.loaded += l.qty + l.freeQty;
        row.value += lineValue({ ...l, cancelQty: 0 });
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
    return r[sort.key];
  };
  const visible = rows
    .filter((r) => {
      const item = itemMap.get(r.sapCode);
      return includesText([r.sapCode, item?.description, item?.packageDetails], query);
    })
    .sort((a, b) => {
      const x = sortValue(a);
      const y = sortValue(b);
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (sort.dir === "asc" ? order : -order) || a.sapCode.localeCompare(b.sapCode);
    });
  const pager = usePagination(visible, [query, sort, sales.length]);
  const onPage = (i: number) => i >= pager.start && i < pager.start + pager.pageSize;
  const sum = (fn: (r: ItemTotal) => number) => visible.reduce((acc, r) => acc + fn(r), 0);
  const short = visible.filter((r) => r.toLoad > r.inStock);

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: TEXT_KEYS.includes(key) ? "asc" : "desc" }));
  }
  const th = { sort, onSort: sortBy };

  return (
    <>
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
            <SortTH k="value" right {...th} title="Booking qty × price less item discounts, before bill discounts">
              Booking Value
            </SortTH>
          </tr>
        </THead>
        <TBody>
          {visible.length === 0 && <EmptyRow colSpan={10}>{rows.length ? "No items match the search." : "No items on bills for these dates."}</EmptyRow>}
          {visible.map((r, i) => {
            const item = itemMap.get(r.sapCode);
            const isShort = r.toLoad > r.inStock;
            return (
              // Rows on other pages are hidden on screen but still printed
              <TR key={r.sapCode} className={cn(isShort && "bg-red-50/40", !onPage(i) && "hidden print:table-row")}>
                <TD className="font-mono text-xs text-slate-900">{r.sapCode}</TD>
                <TD className="whitespace-normal">
                  <span className="block font-medium text-slate-900">{item?.description ?? "Deleted item"}</span>
                  {item?.packageDetails && <span className="block text-xs text-slate-500">{item.packageDetails}</span>}
                </TD>
                <TD>{item?.uom ?? "—"}</TD>
                <TD className="text-right tabular-nums">{formatQty(r.bills)}</TD>
                <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.booked)}</TD>
                <TD className="text-right tabular-nums">{r.free ? formatQty(r.free) : "—"}</TD>
                <TD className="text-right tabular-nums">{r.loaded ? formatQty(r.loaded) : "—"}</TD>
                <TD className={cn("text-right tabular-nums", r.toLoad > 0 && "font-semibold text-slate-900")}>{r.toLoad ? formatQty(r.toLoad) : "—"}</TD>
                <TD className={cn("text-right tabular-nums", isShort && "font-semibold text-red-600")}>
                  {formatQty(r.inStock)}
                  {isShort && <span className="block text-xs font-medium">short {formatQty(r.toLoad - r.inStock)}</span>}
                </TD>
                <TD className="text-right tabular-nums">{formatMoney(r.value)}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <TableFooter pager={<Pagination pager={pager} />}>
        {formatQty(visible.length)} item{visible.length === 1 ? "" : "s"} · Booking {formatQty(sum((r) => r.booked))} units
        {sum((r) => r.free) > 0 && ` (${formatQty(sum((r) => r.free))} free)`} · Loading{" "}
        {formatQty(sum((r) => r.loaded))} · To load {formatQty(sum((r) => r.toLoad))} ·{" "}
        <span className="font-medium text-slate-700">Booking value {formatMoney(sum((r) => r.value))}</span> (before bill discounts)
        {short.length > 0 && <span className="font-medium text-red-600"> · {short.length} short of stock</span>}
      </TableFooter>
    </>
  );
}
