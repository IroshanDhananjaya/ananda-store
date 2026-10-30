"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker, inDateRange, type DateRange } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap, useLastInvoicePrices, useOrderMap } from "@/lib/store";
import type { Order, OrderItem } from "@/lib/types";
import { cn, formatDate, formatMoney, formatQty, includesText, round2 } from "@/lib/utils";

// Received orders checked against what was ordered: the items that didn't come (all or part of
// the qty), and the items that came without being ordered (or more than was ordered).

/** "short": ordered, didn't come; "extra": came, not ordered */
type Tab = "short" | "extra";
type Kind = "Missing" | "Short" | "Not ordered" | "Over";

const kindTone = { Missing: "red", Short: "amber", "Not ordered": "blue", Over: "blue" } as const;
const kindLabel: Record<Kind, string> = { Missing: "Missing", Short: "Came short", "Not ordered": "Not ordered", Over: "More than ordered" };

type Row = {
  line: OrderItem;
  order: Order;
  kind: Kind;
  /** Units that didn't come, or came without being ordered */
  qty: number;
  price: number;
  /** No price on the order line: the item's last Raigam invoice price */
  lastPrice: boolean;
  value: number;
};

const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;

export function OrderDifferencesPage() {
  const orders = useAppStore((s) => s.orders);
  const orderItems = useAppStore((s) => s.orderItems);
  const orderInvoices = useAppStore((s) => s.orderInvoices);
  const stock = useAppStore((s) => s.stock);
  const itemMap = useItemMap();
  const orderMap = useOrderMap();
  const lastPrices = useLastInvoicePrices();
  const [tab, setTab] = useState<Tab>("short");
  const [orderFilter, setOrderFilter] = useState("");
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  const [query, setQuery] = useState("");

  const invoiceMap = new Map(orderInvoices.map((i) => [i.id, i]));
  const received = orders.filter((o) => o.receivedDate && inDateRange(o.receivedDate, range) && (!orderFilter || o.orderId === orderFilter));

  // Every line of the received orders whose received qty isn't what was ordered, newest order first
  const all = useMemo(() => {
    const rows: Row[] = [];
    for (const line of orderItems) {
      const order = orderMap.get(line.orderId);
      if (!order?.receivedDate || line.receivedQty === line.orderedQty) continue;
      const diff = line.receivedQty - line.orderedQty;
      const kind: Kind = line.orderedQty === 0 ? "Not ordered" : line.receivedQty === 0 ? "Missing" : diff < 0 ? "Short" : "Over";
      const lastPrice = !(line.unitPrice > 0) && (lastPrices.get(line.itemCode) ?? 0) > 0;
      const price = lastPrice ? (lastPrices.get(line.itemCode) ?? 0) : line.unitPrice;
      rows.push({ line, order, kind, qty: Math.abs(diff), price, lastPrice, value: round2(Math.abs(diff) * price) });
    }
    return rows.sort((a, b) => b.order.orderId.localeCompare(a.order.orderId));
  }, [orderItems, orderMap, lastPrices]);

  const stockOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of stock) map.set(r.sapCode, (map.get(r.sapCode) ?? 0) + r.availableQty);
    return map;
  }, [stock]);

  const receivedIds = new Set(received.map((o) => o.orderId));
  const inView = all.filter((r) => receivedIds.has(r.order.orderId));
  const sideOf = (r: Row): Tab => (r.kind === "Missing" || r.kind === "Short" ? "short" : "extra");
  const side = (t: Tab) => {
    const rows = inView.filter((r) => sideOf(r) === t);
    const units = rows.reduce((n, r) => n + r.qty, 0);
    const value = round2(rows.reduce((n, r) => n + r.value, 0));
    // Items with no price on the order or any invoice aren't in the value
    const unpriced = rows.filter((r) => !(r.price > 0)).length;
    return { rows, units, value, worth: `${formatMoney(value)}${unpriced ? ` (${unpriced} without a price)` : ""}` };
  };
  const short = side("short");
  const extra = side("extra");
  const current = tab === "short" ? short : extra;
  const ordersWithGaps = new Set(inView.map((r) => r.order.orderId)).size;

  const shown = current.rows.filter((r) =>
    includesText([r.line.orderId, r.line.itemCode, itemMap.get(r.line.itemCode)?.description, r.line.remarks, invoiceMap.get(r.line.invoiceId)?.invoiceNumber], query),
  );

  const pager = usePagination(shown, [tab, orderFilter, range, query]);
  // Rows on other pages are hidden on screen but still printed
  const offPage = (i: number) => (i < pager.start || i >= pager.start + pager.pageSize) && "hidden print:table-row";

  const receivedOrders = orders.filter((o) => o.receivedDate).sort((a, b) => b.orderId.localeCompare(a.orderId));
  const title = tab === "short" ? "Ordered, didn't come" : "Came, not ordered";
  const summary = [
    title,
    orderFilter || "all received orders",
    range.from || range.to ? `received ${range.from ? formatDate(range.from) : "…"} – ${range.to ? formatDate(range.to) : "…"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title="Missing & Not Ordered"
        description={<span className="print:hidden">Items we ordered that didn&apos;t come, and items that came without being ordered.</span>}
        actions={
          <Button variant="outline" onClick={() => window.print()} className="print:hidden">
            <Printer /> Print
          </Button>
        }
      />
      <p className="mb-4 hidden text-sm font-medium text-slate-700 print:block">{summary}</p>

      <div className="grid gap-4 sm:grid-cols-3 print:hidden">
        <SummaryTile
          label="Ordered, didn't come"
          value={plural(short.units, "unit")}
          sub={`${plural(short.rows.length, "item")} · ${short.worth}`}
          tone={short.units ? "danger" : "good"}
        />
        <SummaryTile label="Came, not ordered" value={plural(extra.units, "unit")} sub={`${plural(extra.rows.length, "item")} · ${extra.worth}`} />
        <SummaryTile label="Orders with differences" value={formatQty(ordersWithGaps)} sub={`of ${plural(received.length, "received order")}`} />
      </div>

      <Card className="mt-6">
        <div className="print:hidden">
          <Toolbar>
            <FilterTabs<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "short", label: "Ordered, didn't come", count: short.rows.length },
                { value: "extra", label: "Came, not ordered", count: extra.rows.length },
              ]}
            />
            <SearchInput placeholder="Search item, order or invoice" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:ml-auto" />
          </Toolbar>
          <Toolbar>
            <Select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)} className="h-9 sm:w-44" aria-label="Filter by order">
              <option value="">All orders</option>
              {receivedOrders.map((o) => (
                <option key={o.id} value={o.orderId}>
                  {o.orderId}
                </option>
              ))}
            </Select>
            <DateRangePicker value={range} onChange={setRange} placeholder="Any received date" />
          </Toolbar>
        </div>

        <Table>
          <THead>
            <tr>
              <TH>Order</TH>
              <TH>Item</TH>
              <TH className="text-right">Ordered</TH>
              <TH className="text-right">Received</TH>
              <TH className="text-right">{tab === "short" ? "Didn't Come" : "Not Ordered"}</TH>
              {tab === "extra" && <TH>Invoice</TH>}
              <TH className="text-right">Price</TH>
              <TH className="text-right" title="Units × price, before discounts">
                Value
              </TH>
              <TH>Status</TH>
              <TH className={cn(tab === "short" && "text-right")} title={tab === "short" ? "Available in stock now, all locations" : undefined}>
                {tab === "short" ? "In Stock Now" : "Stock"}
              </TH>
              <TH>Remarks</TH>
            </tr>
          </THead>
          <TBody>
            {shown.length === 0 && (
              <EmptyRow colSpan={tab === "short" ? 10 : 11}>
                {current.rows.length
                  ? "No item matches the search."
                  : received.length === 0
                    ? "No received orders here."
                    : tab === "short"
                      ? "Every item ordered came."
                      : "Nothing came that wasn't ordered."}
              </EmptyRow>
            )}
            {shown.map((r, i) => {
              const { line, order } = r;
              const item = itemMap.get(line.itemCode);
              const invoice = invoiceMap.get(line.invoiceId);
              const inStock = stockOf.get(line.itemCode) ?? 0;
              return (
                <TR key={line.id} className={cn(offPage(i))}>
                  <TD>
                    <Link href={`/orders/${order.id}`} className="font-semibold text-brand-700 hover:underline">
                      {order.orderId}
                    </Link>
                    <span className="block text-xs text-slate-500">Received {formatDate(order.receivedDate)}</span>
                  </TD>
                  <TD className="min-w-48 whitespace-normal">
                    <span className="block font-semibold text-slate-900">{item?.description ?? "Deleted item"}</span>
                    <span className="block text-xs text-slate-500">
                      <span className="font-mono">{line.itemCode}</span>
                      {item?.packageDetails ? ` · ${item.packageDetails}` : ""}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{line.orderedQty ? formatQty(line.orderedQty) : <span className="text-slate-400">—</span>}</TD>
                  <TD className="text-right tabular-nums">{formatQty(line.receivedQty)}</TD>
                  <TD className={cn("text-right font-semibold tabular-nums", tab === "short" ? "text-red-600" : "text-sky-700")}>{formatQty(r.qty)}</TD>
                  {tab === "extra" && (
                    <TD>{invoice ? invoice.invoiceNumber || "No number yet" : <span className="text-slate-400">—</span>}</TD>
                  )}
                  <TD className="text-right tabular-nums">
                    {r.price > 0 ? (
                      <>
                        <span className="block">{formatMoney(r.price)}</span>
                        {r.lastPrice && <span className="block text-xs text-slate-500">last invoice</span>}
                      </>
                    ) : (
                      <span className="text-slate-400" title="No price on the order or any Raigam invoice">
                        —
                      </span>
                    )}
                  </TD>
                  <TD className="text-right font-medium text-slate-900 tabular-nums">{r.price > 0 ? formatMoney(r.value) : <span className="text-slate-400">—</span>}</TD>
                  <TD>
                    <Badge tone={kindTone[r.kind]}>{kindLabel[r.kind]}</Badge>
                  </TD>
                  {tab === "short" ? (
                    // Nothing left in stock: worth ordering again
                    <TD className={cn("text-right tabular-nums", inStock === 0 && "font-medium text-red-600")}>{formatQty(inStock)}</TD>
                  ) : (
                    <TD className="whitespace-nowrap">
                      {line.postedLocation ? (
                        <span className="text-emerald-700">In stock · {line.postedLocation}</span>
                      ) : (
                        <span className="text-amber-700">Not in stock yet</span>
                      )}
                    </TD>
                  )}
                  <TD className="max-w-48 min-w-32 whitespace-normal">{line.remarks || <span className="text-slate-400">—</span>}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {shown.length === current.rows.length ? plural(current.rows.length, "item") : `${shown.length} of ${plural(current.rows.length, "item")}`} ·{" "}
          <span className="font-medium text-slate-700">{plural(current.units, "unit")}</span> · {current.worth} · Value = units × price, before
          discounts; &quot;last invoice&quot; = no price on the order, so the item&apos;s last Raigam price
        </TableFooter>
      </Card>
    </>
  );
}
