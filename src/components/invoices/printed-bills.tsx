"use client";

import { Fragment } from "react";
import { categoryOf, compareByCategory } from "@/lib/categories";
import { chargedQty, freeGiven, isFreeItem, isRemoved, itemsTotal, lineValue, returnsTotal, saleSubtotal } from "@/lib/ledger";
import { useAppStore, useCategoryRanks, useItemMap, useRouteMap, useSaleDues, useShopMap } from "@/lib/store";
import { formatPct, returnRate, returnSplit } from "@/lib/returns";
import type { Sale, SaleLine } from "@/lib/types";
import { cn, formatDate, formatMoney, formatQty, round2 } from "@/lib/utils";

// Several bills printed together (Daily Invoices > Print bills), one bill per A4 page, laid out like the
// printed bill on a bill's own page. Hidden on screen; "Save as PDF" in the print window makes the PDF.

const cell = "border border-slate-400 px-1.5 py-1";
const head = cn(cell, "bg-slate-100 text-left text-[11px] font-semibold uppercase");

export function PrintedBills({ sales }: { sales: Sale[] }) {
  return (
    <div className="hidden text-[12px] text-black print:block">
      <style>{"@page { size: A4 portrait; margin: 10mm; }"}</style>
      {sales.map((s, i) => (
        <div key={s.id} style={i < sales.length - 1 ? { breakAfter: "page" } : undefined}>
          <PrintedBill sale={s} />
        </div>
      ))}
    </div>
  );
}

function PrintedBill({ sale }: { sale: Sale }) {
  const itemMap = useItemMap();
  const ranks = useCategoryRanks();
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const dues = useSaleDues();
  const payments = useAppStore((s) => s.payments);

  const shop = shopMap.get(sale.shopId);
  const route = shop ? routeMap.get(shop.routeId) : undefined;
  const d = dues.get(sale.id)!;
  const byCategory = (a: SaleLine, b: SaleLine) => compareByCategory(ranks, itemMap.get(a.sapCode), itemMap.get(b.sapCode));
  const soldLines = sale.lines.filter((l) => !isFreeItem(l)).sort(byCategory);
  const freeLines = sale.lines.filter(isFreeItem).sort(byCategory);
  const categoryOfLine = (l: SaleLine) => categoryOf(itemMap.get(l.sapCode));
  const startsCategory = (list: SaleLine[], i: number) => i === 0 || categoryOfLine(list[i]) !== categoryOfLine(list[i - 1]);
  const units = sale.lines.reduce((n, l) => n + chargedQty(l), 0);
  const hasCancel = soldLines.some((l) => l.cancelQty > 0);

  // Mode of payment as on Raigam's bill: how it was paid, plus Credit for a delivered bill's unpaid balance
  const methods = [...new Set(d.payments.map((p) => payments.find((x) => x.id === p.paymentId)?.method).filter(Boolean))].join(", ");
  const left = d.delivered ? d.due : round2(d.total - d.paid);
  const paymentMode = [methods, d.delivered && left > 0.004 ? "Credit" : ""].filter(Boolean).join(", ");

  const name = (sapCode: string) => itemMap.get(sapCode)?.description ?? "Unknown item";

  return (
    <article>
      <header className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-2">
        <div>
          <h1 className="text-lg font-bold">Ananda Stores</h1>
          <p className="text-sm font-semibold">Invoice{sale.status === "Cancelled" ? " · CANCELLED" : ""}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase">Raigam Invoice No.</p>
          <p className="text-base font-bold tabular-nums">{sale.invoiceNo || "—"}</p>
          <p className="text-[11px]">Bill No. {sale.saleNo}</p>
        </div>
      </header>

      <section className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5">
        <p>
          <span className="font-semibold">Dealer (Store):</span> {shop?.shopName ?? "Deleted store"}
          {shop?.shopCode && ` (${shop.shopCode})`}
        </p>
        <p>
          <span className="font-semibold">Booking date:</span> {formatDate(sale.date)}
        </p>
        <p>
          <span className="font-semibold">Address:</span> {[shop?.address, shop?.town].filter(Boolean).join(", ") || "—"}
        </p>
        <p>
          <span className="font-semibold">Actual date:</span> {sale.deliveredDate ? formatDate(sale.deliveredDate) : "—"}
        </p>
        <p>
          <span className="font-semibold">Route:</span> {route ? `${route.routeCode} · ${route.routeName}` : "—"}
        </p>
        <p>
          <span className="font-semibold">Rep:</span> {sale.repName || "—"}
          {sale.vehicleNumber && ` · Lorry ${sale.vehicleNumber}`}
        </p>
      </section>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr>
            <th className={head}>#</th>
            <th className={head}>Item Description</th>
            <th className={cn(head, "text-right")}>Qty</th>
            <th className={cn(head, "text-right")}>Free</th>
            <th className={cn(head, "text-right")}>Unit Price</th>
            <th className={cn(head, "text-right")}>Disc. %</th>
            {hasCancel && <th className={cn(head, "text-right")}>Cancelled</th>}
            <th className={cn(head, "text-right")}>Value</th>
          </tr>
        </thead>
        <tbody>
          {soldLines.length === 0 && (
            <tr>
              <td colSpan={7 + Number(hasCancel)} className={cn(cell, "text-center")}>
                No items on this bill.
              </td>
            </tr>
          )}
          {soldLines.map((l, i) => (
            <Fragment key={l.id}>
              {startsCategory(soldLines, i) && (
                <tr>
                  <td colSpan={7 + Number(hasCancel)} className={cn(cell, "bg-slate-50 text-[11px] font-semibold")}>
                    {categoryOfLine(l)}
                  </td>
                </tr>
              )}
              <tr className={cn(isRemoved(l) && "line-through")}>
                <td className={cn(cell, "tabular-nums")}>{i + 1}</td>
                <td className={cell}>
                  {name(l.sapCode)} <span className="font-mono text-[10px]">{l.sapCode}</span>
                </td>
                <td className={cn(cell, "text-right tabular-nums")}>{formatQty(chargedQty(l) + (l.cancelQty ?? 0))}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{l.freeQty ? formatQty(freeGiven(l)) : "—"}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{formatMoney(l.unitPrice)}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{l.discountPct ? `${l.discountPct}%` : "—"}</td>
                {hasCancel && <td className={cn(cell, "text-right tabular-nums")}>{l.cancelQty ? formatQty(l.cancelQty) : "—"}</td>}
                <td className={cn(cell, "text-right font-medium tabular-nums")}>{formatMoney(lineValue(l))}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>

      {freeLines.length > 0 && (
        <>
          <p className="mt-3 font-semibold">Free issue items (not charged)</p>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>#</th>
                <th className={head}>Item Description</th>
                <th className={cn(head, "text-right")}>Free Qty</th>
                <th className={cn(head, "text-right")}>Unit Price</th>
                <th className={cn(head, "text-right")}>Free Value</th>
              </tr>
            </thead>
            <tbody>
              {freeLines.map((l, i) => (
                <tr key={l.id} className={cn(isRemoved(l) && "line-through")}>
                  <td className={cn(cell, "tabular-nums")}>{i + 1}</td>
                  <td className={cell}>
                    {name(l.sapCode)} <span className="font-mono text-[10px]">{l.sapCode}</span>
                    {l.freeWith && <span className="text-[10px]"> · free with {name(l.freeWith)}</span>}
                  </td>
                  <td className={cn(cell, "text-right tabular-nums")}>{formatQty(freeGiven(l))}</td>
                  <td className={cn(cell, "text-right tabular-nums")}>{formatMoney(l.unitPrice)}</td>
                  <td className={cn(cell, "text-right tabular-nums")}>{formatMoney(round2(freeGiven(l) * l.unitPrice))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {sale.returns.length > 0 && (
        <>
          <p className="mt-3 font-semibold">Return items (credited on this bill)</p>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Type</th>
                <th className={head}>Item Description</th>
                <th className={cn(head, "text-right")}>Qty</th>
                <th className={cn(head, "text-right")}>Unit Price</th>
                <th className={cn(head, "text-right")}>Value</th>
              </tr>
            </thead>
            <tbody>
              {sale.returns.map((r) => (
                <tr key={r.id}>
                  <td className={cell}>{r.kind}</td>
                  <td className={cell}>
                    {name(r.sapCode)} <span className="font-mono text-[10px]">{r.sapCode}</span>
                  </td>
                  <td className={cn(cell, "text-right tabular-nums")}>{formatQty(r.qty)}</td>
                  <td className={cn(cell, "text-right tabular-nums")}>{formatMoney(r.unitPrice)}</td>
                  <td className={cn(cell, "text-right tabular-nums")}>− {formatMoney(round2(r.qty * r.unitPrice))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mt-3 flex justify-end" style={{ breakInside: "avoid" }}>
        <dl className="grid w-72 grid-cols-2 gap-y-0.5">
          <dt>Items total ({formatQty(units)} units)</dt>
          <dd className="text-right tabular-nums">{formatMoney(itemsTotal(sale))}</dd>
          {sale.returns.length > 0 && (
            <>
              <dt>Returns</dt>
              <dd className="text-right tabular-nums">− {formatMoney(returnsTotal(sale))}</dd>
              <dt className="text-[11px]">Return % ({returnSplit(returnRate([sale]))})</dt>
              <dd className="text-right text-[11px] tabular-nums">{formatPct(returnRate([sale]).pct, returnRate([sale]).sold)}</dd>
              <dt>Gross value</dt>
              <dd className="text-right tabular-nums">{formatMoney(saleSubtotal(sale))}</dd>
            </>
          )}
          <dt>Bill discount ({sale.discountPercent}%)</dt>
          <dd className="text-right tabular-nums">{sale.discount ? `− ${formatMoney(sale.discount)}` : formatMoney(0)}</dd>
          <dt className="border-t border-slate-800 pt-0.5 font-bold">Invoice value</dt>
          <dd className="border-t border-slate-800 pt-0.5 text-right font-bold tabular-nums">{formatMoney(d.total)}</dd>
          {d.extraCredit > 0 && (
            <>
              <dt>Credit added at delivery</dt>
              <dd className="text-right tabular-nums">+ {formatMoney(d.extraCredit)}</dd>
            </>
          )}
          {d.paid > 0 && (
            <>
              <dt>Paid</dt>
              <dd className="text-right tabular-nums">− {formatMoney(d.paid)}</dd>
            </>
          )}
          <dt className="font-semibold">{d.delivered ? "Cash balance" : "To collect"}</dt>
          <dd className="text-right font-semibold tabular-nums">{formatMoney(left)}</dd>
        </dl>
      </div>

      {/* As on Raigam's invoice */}
      <footer className="mt-4" style={{ breakInside: "avoid" }}>
        <p>
          <span className="font-semibold">Mode of payment:</span> {paymentMode || <span className="inline-block w-48 border-b border-dotted border-slate-600" />}
        </p>
        <p className="mt-1">Received the above article in good condition and order.</p>
        <div className="mt-8 flex justify-between gap-8">
          <p className="w-56 border-t border-dotted border-slate-600 pt-1">Customer Signature</p>
          <p className="w-56 border-t border-dotted border-slate-600 pt-1">Date</p>
        </div>
      </footer>
    </article>
  );
}
