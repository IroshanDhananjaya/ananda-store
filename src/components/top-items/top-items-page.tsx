"use client";

import { Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { categoryOf } from "@/lib/categories";
import { chargedQty, freeGiven, lineValue } from "@/lib/ledger";
import { useAppStore, useCategoryRanks, useItemMap } from "@/lib/store";
import { addDays, cn, formatDate, formatMoney, formatQty, includesText, monthStartISO, round2, todayISO, weekdayOf, weekStartISO } from "@/lib/utils";

// The items sold most in a date range: units charged on bills (less what was reduced or cancelled)
// and their value after the item and bill discounts, ranked by qty or by value.

/** Quick date tabs; "custom" is dates picked on the calendar that aren't one of them */
type Preset = "today" | "week" | "month" | "lastMonth" | "year" | "custom";
const PRESETS = ["today", "week", "month", "lastMonth", "year"] as const;
/** Which date puts a bill in the range: when it was written, or when it was delivered */
type DateBy = "bill" | "delivered";
type Which = "all" | "delivered";
type RankBy = "qty" | "value";

function presetRange(preset: Exclude<Preset, "custom">) {
  const today = todayISO();
  if (preset === "week") return { from: weekStartISO(today), to: today };
  if (preset === "month") return { from: monthStartISO(), to: today };
  if (preset === "lastMonth") {
    const end = addDays(monthStartISO(), -1);
    return { from: `${end.slice(0, 8)}01`, to: end };
  }
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: today, to: today };
}

const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;

type ItemSales = { sapCode: string; qty: number; free: number; value: number; bills: number; stores: number };

export function TopItemsPage() {
  const sales = useAppStore((s) => s.sales);
  const stock = useAppStore((s) => s.stock);
  const itemMap = useItemMap();
  const ranks = useCategoryRanks();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState<DateRange>(() => presetRange("month"));
  const [dateBy, setDateBy] = useState<DateBy>("bill");
  const [which, setWhich] = useState<Which>("all");
  const [rankBy, setRankBy] = useState<RankBy>("qty");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  const { from, to } = range;

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  // Dates picked on the calendar light up their tab when they match one
  function chooseRange(r: DateRange) {
    setRange(r);
    setPreset(PRESETS.find((p) => presetRange(p).from === r.from && presetRange(p).to === r.to) ?? "custom");
  }

  // Per item over the bills in the range (cancelled bills don't count)
  const { rows, billCount, storeCount } = useMemo(() => {
    const map = new Map<string, ItemSales & { billIds: Set<string>; shopIds: Set<string> }>();
    const billIds = new Set<string>();
    const shopIds = new Set<string>();
    for (const s of sales) {
      if (s.status === "Cancelled" || (which === "delivered" && s.status !== "Delivered")) continue;
      const date = dateBy === "bill" ? s.date : s.deliveredDate;
      if (!date || date < from || date > to) continue;
      const keep = 1 - s.discountPercent / 100;
      for (const l of s.lines) {
        const qty = chargedQty(l);
        const free = freeGiven(l);
        if (qty <= 0 && free <= 0) continue;
        const row = map.get(l.sapCode) ?? { sapCode: l.sapCode, qty: 0, free: 0, value: 0, bills: 0, stores: 0, billIds: new Set(), shopIds: new Set() };
        row.qty += Math.max(0, qty);
        row.free += Math.max(0, free);
        row.value += lineValue(l) * keep;
        row.billIds.add(s.id);
        row.shopIds.add(s.shopId);
        map.set(l.sapCode, row);
        if (qty > 0) {
          billIds.add(s.id);
          shopIds.add(s.shopId);
        }
      }
    }
    // Only items sold (an item only given free isn't a sale)
    const rows: ItemSales[] = [...map.values()]
      .filter((r) => r.qty > 0)
      .map(({ billIds: b, shopIds: sh, ...r }) => ({ ...r, value: round2(r.value), bills: b.size, stores: sh.size }));
    return { rows, billCount: billIds.size, storeCount: shopIds.size };
  }, [sales, which, dateBy, from, to]);

  const stockOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of stock) map.set(r.sapCode, (map.get(r.sapCode) ?? 0) + r.availableQty);
    return map;
  }, [stock]);

  const categories = [...new Set(rows.map((r) => categoryOf(itemMap.get(r.sapCode))))].sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0));
  const metric = (r: ItemSales) => (rankBy === "qty" ? r.qty : r.value);
  // Ranked within the category picked; the search only hides rows, so each keeps its place
  const ranked = rows
    .filter((r) => !category || categoryOf(itemMap.get(r.sapCode)) === category)
    .sort((a, b) => metric(b) - metric(a) || (rankBy === "qty" ? b.value - a.value : b.qty - a.qty))
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const totalQty = ranked.reduce((n, r) => n + r.qty, 0);
  const totalValue = round2(ranked.reduce((n, r) => n + r.value, 0));
  const totalMetric = rankBy === "qty" ? totalQty : totalValue;
  const shown = ranked.filter((r) => includesText([r.sapCode, itemMap.get(r.sapCode)?.description], query));
  const top = ranked[0];

  const pager = usePagination(shown, [query, from, to, dateBy, which, rankBy, category]);
  // Rows on other pages are hidden on screen but still printed
  const offPage = (i: number) => (i < pager.start || i >= pager.start + pager.pageSize) && "hidden print:table-row";

  const summary = [
    from === to ? `${weekdayOf(from)} ${formatDate(from)}` : `${formatDate(from)} – ${formatDate(to)}`,
    dateBy === "bill" ? "by bill date" : "by delivered date",
    which === "delivered" ? "delivered bills" : "all bills",
    category ? category : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title="Top Selling Items"
        description={`The items sold most · ${summary}`}
        actions={
          <Button variant="outline" onClick={() => window.print()} className="print:hidden">
            <Printer /> Print
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Units sold" value={formatQty(totalQty)} sub={plural(ranked.length, "item")} />
        <SummaryTile label="Sales value" value={formatMoney(totalValue)} sub="After item and bill discounts" />
        <SummaryTile label="Bills" value={formatQty(billCount)} sub={plural(storeCount, "store")} />
        <SummaryTile
          label={rankBy === "qty" ? "Most sold" : "Highest value"}
          value={<span className="block truncate">{top ? (itemMap.get(top.sapCode)?.description ?? top.sapCode) : "—"}</span>}
          sub={top ? `${plural(top.qty, "unit")} · ${formatMoney(top.value)}` : "Nothing sold in these dates"}
        />
      </div>

      <Card className="mt-6">
        <div className="print:hidden">
          <Toolbar>
            <FilterTabs<Preset>
              value={preset}
              onChange={choosePreset}
              options={[
                { value: "today", label: "Today" },
                { value: "week", label: "This week" },
                { value: "month", label: "This month" },
                { value: "lastMonth", label: "Last month" },
                { value: "year", label: "This year" },
              ]}
            />
            <DateRangePicker value={range} onChange={chooseRange} clearable={false} />
            <Select value={dateBy} onChange={(e) => setDateBy(e.target.value as DateBy)} className="h-9 sm:ml-auto sm:w-44" aria-label="Which date to use">
              <option value="bill">By bill date</option>
              <option value="delivered">By delivered date</option>
            </Select>
          </Toolbar>
          <Toolbar>
            <FilterTabs<RankBy>
              value={rankBy}
              onChange={setRankBy}
              options={[
                { value: "qty", label: "Most units" },
                { value: "value", label: "Most value" },
              ]}
            />
            <FilterTabs<Which>
              value={which}
              onChange={setWhich}
              options={[
                { value: "all", label: "All bills" },
                { value: "delivered", label: "Delivered only" },
              ]}
            />
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 sm:w-56" aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <SearchInput placeholder="Search item…" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:ml-auto" />
          </Toolbar>
        </div>

        <Table>
          <THead>
            <tr>
              <TH className="w-12 text-right">#</TH>
              <TH>Item</TH>
              <TH className="text-right">Bills</TH>
              <TH className="text-right">Stores</TH>
              <TH className="text-right">Qty Sold</TH>
              <TH className="text-right">Free Qty</TH>
              <TH className="text-right">Sales Value</TH>
              <TH className="text-right" title={rankBy === "qty" ? "Share of the units sold" : "Share of the sales value"}>
                Share
              </TH>
              <TH className="text-right" title="Available in stock now, all locations">
                In Stock
              </TH>
            </tr>
          </THead>
          <TBody>
            {shown.length === 0 && <EmptyRow colSpan={9}>{rows.length ? "No item matches the search." : "Nothing sold in these dates."}</EmptyRow>}
            {shown.map((r, i) => {
              const item = itemMap.get(r.sapCode);
              const share = totalMetric > 0 ? (metric(r) / totalMetric) * 100 : 0;
              const inStock = stockOf.get(r.sapCode) ?? 0;
              return (
                <TR key={r.sapCode} className={cn(offPage(i))}>
                  <TD className={cn("text-right tabular-nums", r.rank <= 3 ? "font-semibold text-brand-700" : "text-slate-500")}>{r.rank}</TD>
                  <TD className="whitespace-normal">
                    <span className="block font-semibold text-slate-900">{item?.description ?? "Deleted item"}</span>
                    <span className="block text-xs text-slate-500">
                      <span className="font-mono">{r.sapCode}</span>
                      {item?.packageDetails ? ` · ${item.packageDetails}` : ""} · {categoryOf(item)}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{formatQty(r.bills)}</TD>
                  <TD className="text-right tabular-nums">{formatQty(r.stores)}</TD>
                  <TD className={cn("text-right tabular-nums", rankBy === "qty" ? "font-semibold text-slate-900" : undefined)}>{formatQty(r.qty)}</TD>
                  <TD className="text-right tabular-nums text-slate-500">{r.free ? formatQty(r.free) : "—"}</TD>
                  <TD className={cn("text-right tabular-nums", rankBy === "value" ? "font-semibold text-slate-900" : undefined)}>{formatMoney(r.value)}</TD>
                  <TD className="text-right tabular-nums text-slate-600">{share.toFixed(1)}%</TD>
                  {/* Less in stock than sold in these dates: worth ordering */}
                  <TD
                    className={cn("text-right tabular-nums", inStock === 0 ? "font-medium text-red-600" : inStock < r.qty ? "font-medium text-amber-700" : undefined)}
                    title={inStock < r.qty ? "Less in stock than sold in these dates" : undefined}
                  >
                    {formatQty(inStock)}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {shown.length === ranked.length ? plural(ranked.length, "item") : `${shown.length} of ${plural(ranked.length, "item")}`} ·{" "}
          <span className="font-medium text-slate-700">{plural(totalQty, "unit")}</span> · {formatMoney(totalValue)} · In stock in amber: less than sold in these dates
        </TableFooter>
      </Card>
    </>
  );
}
