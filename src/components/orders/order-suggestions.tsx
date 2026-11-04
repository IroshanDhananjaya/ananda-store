"use client";

import { ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { orderSuggestions, type OrderSuggestion, type SuggestionReason } from "@/lib/order-suggestions";
import { useAppStore, useItemMap, useLastInvoicePrices } from "@/lib/store";
import { cn, formatDate, formatMoney, formatQty, LOW_STOCK_LEVEL, round2, todayISO } from "@/lib/utils";

const LOOKBACK = [14, 30, 60, 90];
const COVER = [7, 14, 21, 30];
type Show = "suggested" | "all";

const REASONS: Record<SuggestionReason, { label: string; className: string }> = {
  short: { label: "Short for bills", className: "bg-red-50 text-red-700 ring-red-200" },
  out: { label: "Out of stock", className: "bg-red-50 text-red-700 ring-red-200" },
  low: { label: "Low stock", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  selling: { label: "Selling", className: "bg-brand-50 text-brand-700 ring-brand-200" },
};

const daysText = (d: number) => (d === Infinity ? "—" : d < 1 ? "Out" : `${Math.floor(d)} day${Math.floor(d) === 1 ? "" : "s"}`);

/**
 * Recommended order quantities above the goods order sheet, from past bills (delivered or not),
 * bills still to deliver, stock and orders not received yet. "Use" puts the quantity in the sheet.
 */
export function OrderSuggestions({
  exceptOrderId,
  qtyOf,
  onUse,
}: {
  exceptOrderId?: string;
  qtyOf: (sapCode: string) => number;
  onUse: (picks: { sapCode: string; qty: number }[]) => void;
}) {
  const items = useAppStore((s) => s.items);
  const sales = useAppStore((s) => s.sales);
  const stock = useAppStore((s) => s.stock);
  const orders = useAppStore((s) => s.orders);
  const orderItems = useAppStore((s) => s.orderItems);
  const itemMap = useItemMap();
  const lastPrice = useLastInvoicePrices();
  const [open, setOpen] = useState(true);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [coverDays, setCoverDays] = useState(14);
  const [roundToPack, setRoundToPack] = useState(true);
  const [restockLow, setRestockLow] = useState(true);
  const [countOnOrder, setCountOnOrder] = useState(true);
  // Purchase orders sent but not received yet (not the one being edited)
  const pendingOrders = orders.filter((o) => !o.receivedDate && o.orderId !== exceptOrderId).sort((a, b) => a.orderId.localeCompare(b.orderId));
  const [show, setShow] = useState<Show>("suggested");

  const all = useMemo(
    () => orderSuggestions({ items, sales, stock, orders, orderItems, today: todayISO(), lookbackDays, coverDays, roundToPack, restockLow, countOnOrder, exceptOrderId }),
    [items, sales, stock, orders, orderItems, lookbackDays, coverDays, roundToPack, restockLow, countOnOrder, exceptOrderId],
  );
  // Most urgent first: runs out soonest, then sells fastest
  const rank = (r: OrderSuggestion) => (r.reason === "short" ? 0 : r.reason === "out" ? 1 : 2);
  const byUrgency = (a: OrderSuggestion, b: OrderSuggestion) =>
    rank(a) - rank(b) || a.daysLeft - b.daysLeft || b.perDay - a.perDay || a.sapCode.localeCompare(b.sapCode);
  const suggested = all.filter((r) => r.suggest > 0).sort(byUrgency);
  const moving = all.filter((r) => r.sold > 0 || r.toLoad > 0 || r.onLorry > 0).sort(byUrgency);
  const rows = show === "suggested" ? suggested : moving;
  const notFilled = suggested.filter((r) => qtyOf(r.sapCode) === 0);
  const value = round2(suggested.reduce((sum, r) => sum + r.suggest * (lastPrice.get(r.sapCode) ?? 0), 0));
  const toDeliver = (r: OrderSuggestion) => r.toLoad + r.onLorry;
  // Selling items left off To order only because an order not received yet covers them
  const coveredByOrder = countOnOrder ? moving.filter((r) => r.suggest === 0 && r.onOrder > 0 && r.stock - r.toLoad < r.perDay * coverDays).length : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm print:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-brand-50/60 px-4 py-3 text-left sm:px-6"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-4 text-slate-500" /> : <ChevronRight className="size-4 text-slate-500" />}
        <Lightbulb className="size-4 text-brand-600" />
        <span className="font-semibold text-slate-900">Recommended to order</span>
        <span className="text-sm text-slate-600">
          · {suggested.length} item{suggested.length === 1 ? "" : "s"}
          {value > 0 && ` · about ${formatMoney(value)}`}
        </span>
      </button>

      {open && (
        <>
          <div className="flex flex-col gap-3 border-t border-brand-100 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Sales of the last
              <Select value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))} className="h-8 w-24" aria-label="Look-back days">
                {LOOKBACK.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Enough for
              <Select value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))} className="h-8 w-24" aria-label="Days to cover">
                {COVER.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="size-4 accent-brand-600" checked={roundToPack} onChange={(e) => setRoundToPack(e.target.checked)} />
              Round up to full packs
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600" title={`Selling items (or on bills not delivered) with ${LOW_STOCK_LEVEL} or fewer left get at least a pack`}>
              <input type="checkbox" className="size-4 accent-brand-600" checked={restockLow} onChange={(e) => setRestockLow(e.target.checked)} />
              Restock low selling items
            </label>
            {pendingOrders.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-600" title="Untick if those orders won't come, or to see what to order without them">
                <input type="checkbox" className="size-4 accent-brand-600" checked={countOnOrder} onChange={(e) => setCountOnOrder(e.target.checked)} />
                Count orders not received ({pendingOrders.map((o) => `${o.orderId}, ${formatDate(o.orderDate)}`).join(" · ")})
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <FilterTabs<Show>
                value={show}
                onChange={setShow}
                options={[
                  { value: "suggested", label: "To order", count: suggested.length },
                  { value: "all", label: "All selling items", count: moving.length },
                ]}
              />
              <Button
                size="sm"
                onClick={() => onUse(notFilled.map((r) => ({ sapCode: r.sapCode, qty: r.suggest })))}
                disabled={notFilled.length === 0}
                title="Puts the recommended qty in every Order Qty box that's still empty"
              >
                Fill {notFilled.length || ""} empty
              </Button>
            </div>
          </div>

          {show === "suggested" && coveredByOrder > 0 && (
            <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-6">
              {coveredByOrder} selling item{coveredByOrder === 1 ? " isn't" : "s aren't"} here because {pendingOrders.map((o) => o.orderId).join(", ")} (not received yet)
              covers {coveredByOrder === 1 ? "it" : "them"}.{" "}
              <button type="button" onClick={() => setShow("all")} className="font-medium underline">
                See all selling items
              </button>{" "}
              or untick Count orders not received.
            </p>
          )}

          <div className="max-h-[28rem] overflow-auto border-t border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 sm:pl-6">Item</th>
                  <th className="px-3 py-2 text-right" title={`Units on bills dated in the last ${lookbackDays} days, delivered or not`}>
                    Sold {lookbackDays}d
                  </th>
                  <th className="px-3 py-2 text-right" title="Bills not delivered yet: to load (still in the store) + on the lorry">
                    To deliver
                  </th>
                  <th className="px-3 py-2 text-right">In stock</th>
                  <th className="px-3 py-2 text-right" title="On purchase orders not received yet">
                    On order
                  </th>
                  <th className="px-3 py-2 text-right" title="How long the stock lasts at this rate, after the bills to load">
                    Lasts
                  </th>
                  <th className="px-3 py-2 text-right" title={`Bills to load + ${coverDays} days of sales − stock − on order`}>
                    Suggest
                  </th>
                  <th className="px-3 py-2 text-right sm:pr-6">On sheet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      {show === "suggested" ? `Stock and orders cover the next ${coverDays} days at the current rate.` : `No items on bills in the last ${lookbackDays} days.`}
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const item = itemMap.get(r.sapCode);
                  const onSheet = qtyOf(r.sapCode);
                  const urgent = r.daysLeft < 3;
                  return (
                    <tr key={r.sapCode} className={cn(urgent && r.suggest > 0 && "bg-red-50/50")}>
                      <td className="px-4 py-2 sm:pl-6">
                        <span className="block font-medium text-slate-900">{item?.description ?? r.sapCode}</span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-slate-500">
                          {r.sapCode}
                          {r.pack ? ` · pack ${r.pack}` : ""}
                          {r.reason && (
                            <span className={cn("rounded-full px-1.5 py-px font-sans text-[11px] font-medium ring-1", REASONS[r.reason].className)}>{REASONS[r.reason].label}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatQty(r.sold)}
                        <span className="block text-xs text-slate-500">{r.perDay >= 0.05 ? `${r.perDay.toFixed(1)}/day` : "—"}</span>
                        {r.short > 0 && (
                          <span className="block text-xs text-amber-700" title="Reduced on bills because the store didn't have them; counted as sold">
                            incl. {formatQty(r.short)} short
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {toDeliver(r) ? formatQty(toDeliver(r)) : "—"}
                        {toDeliver(r) > 0 && (
                          <span className="block text-xs text-slate-500">
                            {formatQty(r.toLoad)} to load · {formatQty(r.onLorry)} on lorry
                          </span>
                        )}
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", r.stock < r.toLoad && "font-semibold text-red-600")}>{formatQty(r.stock)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", r.onOrder > 0 && "font-medium text-brand-700")}>{r.onOrder ? formatQty(r.onOrder) : "—"}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", urgent ? "font-semibold text-red-600" : r.daysLeft < coverDays ? "text-amber-700" : "text-slate-600")}>
                        {daysText(r.daysLeft)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900 tabular-nums">{r.suggest ? formatQty(r.suggest) : "—"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap sm:pr-6">
                        {onSheet > 0 && <span className="mr-2 font-semibold text-brand-700 tabular-nums">{formatQty(onSheet)}</span>}
                        {r.suggest > 0 && onSheet !== r.suggest && (
                          <Button variant="outline" size="sm" onClick={() => onUse([{ sapCode: r.sapCode, qty: r.suggest }])}>
                            Use {formatQty(r.suggest)}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 sm:px-6">
            Suggest = bills still to load + {coverDays} days of sales at the last {lookbackDays} days&apos; rate (units reduced for no stock count as sold) − stock
            {countOnOrder ? " − on order" : ""}
            {roundToPack ? ", rounded up to full packs" : ""}
            {restockLow ? `. Selling items with ${LOW_STOCK_LEVEL} or fewer left get at least a pack` : ""}. Items not selling and not on any bill aren&apos;t suggested. Bills on the lorry have already left the store, so they only count in the rate.
          </p>
        </>
      )}
    </div>
  );
}
