"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BillStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { chargedQty, freeGiven } from "@/lib/ledger";
import { useAppStore, useItemMap, useSaleDues, useShopMap } from "@/lib/store";
import type { Sale, SaleLine } from "@/lib/types";
import { addDays, cn, formatDate, formatMoney, formatQty, includesText, monthStartISO, round2, todayISO, weekdayOf, weekStartISO } from "@/lib/utils";

// Free issue given on bills (Raigam's scheme: not charged, Raigam pays it back) for a date range:
// totals per item (what to claim) and each bill line with free issue (to check).

type Preset = "today" | "yesterday" | "week" | "month" | "custom";
/** Which date puts a bill in the range: when it was written, or when it was delivered */
type DateBy = "bill" | "delivered";
type View = "items" | "bills";
type Which = "all" | "delivered";

function presetRange(preset: Exclude<Preset, "custom">) {
  const today = todayISO();
  if (preset === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (preset === "week") return { from: weekStartISO(today), to: today };
  if (preset === "month") return { from: monthStartISO(), to: today };
  return { from: today, to: today };
}

/**
 * Units given free on a line: its free issue (a free item is a line with only free issue), plus a line priced 0
 * (as on the loading list), less what was missing at loading or the store didn't take
 */
const freeOf = (l: SaleLine) => freeGiven(l) + (l.unitPrice === 0 ? chargedQty(l) : 0);
/** Free issue at the bill's price (what it would have cost the store) */
const freeValueOf = (l: SaleLine) => round2(freeGiven(l) * l.unitPrice);
const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;

type BillLine = { sale: Sale; line: SaleLine; date: string; free: number; value: number };
type ItemTotal = { sapCode: string; bills: number; sold: number; free: number; value: number };

export function FreeIssuesPage() {
  const sales = useAppStore((s) => s.sales);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const dues = useSaleDues();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [dateBy, setDateBy] = useState<DateBy>("bill");
  const [which, setWhich] = useState<Which>("all");
  const [view, setView] = useState<View>("items");
  const [query, setQuery] = useState("");

  // A From date after the To date is read the other way round
  const [from, to] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  // Every bill line with free issue in the range (cancelled bills don't count)
  const lines: BillLine[] = useMemo(() => {
    const out: BillLine[] = [];
    for (const s of sales) {
      if (s.status === "Cancelled" || (which === "delivered" && s.status !== "Delivered")) continue;
      const date = dateBy === "bill" ? s.date : s.deliveredDate;
      if (!date || date < from || date > to) continue;
      for (const l of s.lines) {
        const free = freeOf(l);
        if (free > 0) out.push({ sale: s, line: l, date, free, value: freeValueOf(l) });
      }
    }
    return out;
  }, [sales, which, dateBy, from, to]);

  const matching = lines.filter((x) =>
    includesText([x.line.sapCode, itemMap.get(x.line.sapCode)?.description, x.sale.saleNo, x.sale.invoiceNo, shopMap.get(x.sale.shopId)?.shopName], query),
  );

  const items: ItemTotal[] = [
    ...matching
      .reduce((map, x) => {
        const row = map.get(x.line.sapCode) ?? { sapCode: x.line.sapCode, bills: 0, sold: 0, free: 0, value: 0 };
        row.bills += 1; // an item is on a bill once
        row.sold += x.line.unitPrice === 0 ? 0 : chargedQty(x.line);
        row.free += x.free;
        row.value = round2(row.value + x.value);
        return map.set(x.line.sapCode, row);
      }, new Map<string, ItemTotal>())
      .values(),
  ].sort((a, b) => b.free - a.free || (itemMap.get(a.sapCode)?.description ?? "").localeCompare(itemMap.get(b.sapCode)?.description ?? ""));
  const bills = [...matching].sort((a, b) => b.date.localeCompare(a.date) || b.sale.saleNo.localeCompare(a.sale.saleNo));

  const itemPager = usePagination(items, [query, from, to, dateBy, which]);
  const billPager = usePagination(bills, [query, from, to, dateBy, which]);
  // Rows on other pages are hidden on screen but still printed
  const offPage = (pager: { start: number; pageSize: number }, i: number) => (i < pager.start || i >= pager.start + pager.pageSize) && "hidden print:table-row";

  const totalFree = matching.reduce((n, x) => n + x.free, 0);
  const totalValue = round2(matching.reduce((n, x) => n + x.value, 0));
  const billCount = new Set(matching.map((x) => x.sale.id)).size;
  const summary = [
    from === to ? `${weekdayOf(from)} ${formatDate(from)}` : `${formatDate(from)} – ${formatDate(to)}`,
    dateBy === "bill" ? "by bill date" : "by delivered date",
    which === "delivered" ? "delivered bills" : "all bills",
  ].join(" · ");

  return (
    <>
      <PageHeader
        title="Free Issues"
        description={`Free issue given on bills (Raigam pays it back) · ${summary}`}
        actions={
          <Button variant="outline" onClick={() => window.print()} className="print:hidden">
            <Printer /> Print
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Free issue" value={plural(totalFree, "unit")} sub={`${plural(items.length, "item")}`} />
        <SummaryTile label="Free issue value" value={formatMoney(totalValue)} sub="At the price on each bill" />
        <SummaryTile label="Bills with free issue" value={formatQty(billCount)} sub={plural(bills.length, "line")} />
        <SummaryTile
          label="Delivered"
          value={plural(matching.filter((x) => x.sale.status === "Delivered").reduce((n, x) => n + x.free, 0), "unit")}
          sub="Given to the stores already"
        />
      </div>

      <div className="mt-6 print:hidden">
        <FilterTabs<View>
          value={view}
          onChange={setView}
          options={[
            { value: "items", label: "By item (to claim)", count: items.length },
            { value: "bills", label: "By bill", count: bills.length },
          ]}
        />
      </div>

      <Card className="mt-3">
        <div className="print:hidden">
          <Toolbar>
            <FilterTabs<Preset>
              value={preset}
              onChange={choosePreset}
              options={[
                { value: "today", label: "Today" },
                { value: "yesterday", label: "Yesterday" },
                { value: "week", label: "This week" },
                { value: "month", label: "This month" },
                { value: "custom", label: "Custom" },
              ]}
            />
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Input
                type="date"
                value={range.from}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, from: e.target.value || r.from }));
                }}
                className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none"
                aria-label="From date"
              />
              <span className="text-sm text-slate-500">to</span>
              <Input
                type="date"
                value={range.to}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, to: e.target.value || r.to }));
                }}
                className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none"
                aria-label="To date"
              />
            </div>
            <Select value={dateBy} onChange={(e) => setDateBy(e.target.value as DateBy)} className="h-9 sm:ml-auto sm:w-44" aria-label="Which date to use">
              <option value="bill">By bill date</option>
              <option value="delivered">By delivered date</option>
            </Select>
          </Toolbar>
          <Toolbar>
            <FilterTabs<Which>
              value={which}
              onChange={setWhich}
              options={[
                { value: "all", label: "All bills" },
                { value: "delivered", label: "Delivered only" },
              ]}
            />
            <SearchInput placeholder="Search item, store or bill…" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:ml-auto" />
          </Toolbar>
        </div>

        {view === "items" ? (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-right">Bills</TH>
                  <TH className="text-right">Sold Qty</TH>
                  <TH className="text-right">Free Qty</TH>
                  <TH className="text-right">Free Value</TH>
                </tr>
              </THead>
              <TBody>
                {items.length === 0 && <EmptyRow colSpan={5}>{lines.length ? "No free issue matches the search." : "No free issue on bills for these dates."}</EmptyRow>}
                {items.map((r, i) => {
                  const item = itemMap.get(r.sapCode);
                  return (
                    <TR key={r.sapCode} className={cn(offPage(itemPager, i))}>
                      <TD className="whitespace-normal">
                        <span className="block font-semibold text-slate-900">{item?.description ?? "Deleted item"}</span>
                        <span className="block font-mono text-xs text-slate-500">
                          {r.sapCode}
                          {item?.packageDetails ? ` · ${item.packageDetails}` : ""}
                        </span>
                      </TD>
                      <TD className="text-right tabular-nums">{formatQty(r.bills)}</TD>
                      <TD className="text-right tabular-nums">{formatQty(r.sold)}</TD>
                      <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.free)}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(r.value)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <TableFooter pager={<Pagination pager={itemPager} />}>
              {plural(items.length, "item")} · <span className="font-medium text-slate-700">{plural(totalFree, "unit")} free</span> · {formatMoney(totalValue)}
            </TableFooter>
          </>
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Bill No.</TH>
                  <TH>Store</TH>
                  <TH>Item</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Free Qty</TH>
                  <TH className="text-right">Free Value</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {bills.length === 0 && <EmptyRow colSpan={8}>{lines.length ? "No free issue matches the search." : "No free issue on bills for these dates."}</EmptyRow>}
                {bills.map((x, i) => {
                  const item = itemMap.get(x.line.sapCode);
                  const d = dues.get(x.sale.id);
                  return (
                    <TR key={`${x.sale.id}|${x.line.id}`} className={cn(offPage(billPager, i))}>
                      <TD className="tabular-nums">{formatDate(x.date)}</TD>
                      <TD>
                        <Link href={`/sales/${x.sale.id}`} className="font-medium text-brand-700 hover:underline">
                          {x.sale.saleNo}
                        </Link>
                        {x.sale.invoiceNo && <span className="block text-xs text-slate-500">{x.sale.invoiceNo}</span>}
                      </TD>
                      <TD className="whitespace-normal">{shopMap.get(x.sale.shopId)?.shopName ?? "—"}</TD>
                      <TD className="whitespace-normal">
                        <span className="block font-semibold text-slate-900">{item?.description ?? "Deleted item"}</span>
                        <span className="block font-mono text-xs text-slate-500">{x.line.sapCode}</span>
                        {x.line.qty === 0 && <span className="block text-xs font-medium text-emerald-700">Free item</span>}
                      </TD>
                      <TD className="text-right tabular-nums">{formatQty(chargedQty(x.line))}</TD>
                      <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(x.free)}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(x.value)}</TD>
                      <TD>{d && <BillStatusBadge status={d.status} late={x.sale.late} />}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <TableFooter pager={<Pagination pager={billPager} />}>
              {plural(bills.length, "line")} on {plural(billCount, "bill")} · <span className="font-medium text-slate-700">{plural(totalFree, "unit")} free</span> ·{" "}
              {formatMoney(totalValue)}
            </TableFooter>
          </>
        )}
      </Card>
    </>
  );
}
