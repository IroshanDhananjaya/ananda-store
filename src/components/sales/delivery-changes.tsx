"use client";

import { Input, toNumber } from "@/components/ui/form";
import { billDiscount, itemsTotal, returnsTotal, saleSubtotal } from "@/lib/ledger";
import { useItemMap } from "@/lib/store";
import type { Sale, SaleReturnInput } from "@/lib/types";
import { formatMoney, formatQty, round2 } from "@/lib/utils";
import { blankReturn, pricedReturn, ReturnList, ReturnPanel, returnsInput, returnStarted, toReturnDrafts, type ReturnDraft } from "./return-items";

// At the store, before marking a bill delivered: what the store didn't take (cancelled qty per
// bill line) and goods it gave back (return items, any item). Used by the Actual and Deliver dialogs.

export type DeliveryChangesValue = { cancels: Record<string, string>; returns: ReturnDraft[]; draft: ReturnDraft };
/** Nothing cancelled yet; the return items entered with the bill, to check or change */
export const changesFrom = (sale: Sale): DeliveryChangesValue => ({ cancels: {}, returns: toReturnDrafts(sale.returns), draft: blankReturn() });

/** Bill totals once these changes are applied */
export function totalsWith(sale: Sale, v: DeliveryChangesValue) {
  const bill = {
    lines: sale.lines.map((l) => ({ ...l, cancelQty: toNumber(v.cancels[l.id] ?? "") })),
    returns: v.returns.map(pricedReturn),
  };
  const gross = saleSubtotal(bill);
  const discount = billDiscount(gross, sale.discountPercent);
  return { items: itemsTotal(bill), returns: returnsTotal(bill), gross, discount, total: round2(gross - discount) };
}

/** What's wrong with the changes, if anything (the server checks again) */
export function changesError(sale: Sale, v: DeliveryChangesValue): string | undefined {
  for (const l of sale.lines) {
    const c = v.cancels[l.id] ?? "";
    if (c !== "" && (!Number.isInteger(Number(c)) || Number(c) < 0 || Number(c) > l.qty))
      return `Cancelled qty for ${l.sapCode} must be a whole number from 0 to ${l.qty}.`;
  }
  if (returnStarted(v.draft)) return "You started a return but didn't add it. Press Add return, or Clear.";
  if (totalsWith(sale, v).gross < 0) return "The returns are worth more than the items on this bill.";
  return undefined;
}

export function changesInput(v: DeliveryChangesValue): { cancels: Record<string, number>; returns: SaleReturnInput[] } {
  return {
    cancels: Object.fromEntries(Object.entries(v.cancels).filter(([, c]) => toNumber(c) > 0).map(([id, c]) => [id, Number(c)])),
    returns: returnsInput(v.returns),
  };
}

export function DeliveryChanges({ sale, value, onChange }: { sale: Sale; value: DeliveryChangesValue; onChange: (v: DeliveryChangesValue) => void }) {
  const itemMap = useItemMap();
  const t = totalsWith(sale, value);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <p className="text-sm font-semibold text-slate-900">Cancelled items</p>
        <p className="mb-2 text-xs text-slate-500">
          How many of each item the store didn&apos;t take. They stay on the bill as cancelled, aren&apos;t charged, and go back into your stock. Leave 0 if
          everything was taken.
        </p>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {/* Items taken off the bill on Raigam weren't delivered, so there's nothing to cancel */}
          {sale.lines.filter((l) => l.qty > 0).map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{itemMap.get(l.sapCode)?.description ?? l.sapCode}</p>
                <p className="text-xs text-slate-500">
                  Booked {formatQty(l.qty)}
                  {l.freeQty ? ` + ${formatQty(l.freeQty)} free` : ""} · {formatMoney(l.unitPrice)}
                  {l.discountPct ? ` · ${l.discountPct}% off` : ""}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Cancel
                <Input
                  type="number"
                  min={0}
                  max={l.qty}
                  step={1}
                  inputMode="numeric"
                  value={value.cancels[l.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => onChange({ ...value, cancels: { ...value.cancels, [l.id]: e.target.value } })}
                  className="h-9 w-20 text-right tabular-nums"
                  aria-label={`Cancelled qty of ${l.sapCode}`}
                />
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <p className="text-sm font-semibold text-slate-900">Return items</p>
        <p className="mb-2 text-xs text-slate-500">
          Any item the store gives back, credited on this bill. They go to Return Items (not stock) to send back to Raigam.
          {sale.returns.length > 0 ? " The returns entered with the bill are below: change them if the store gave back something else." : ""}
        </p>
        <ReturnPanel
          returns={value.returns}
          draft={value.draft}
          onChange={(returns, draft) => onChange({ ...value, returns, draft })}
          priceOf={(sapCode) => sale.lines.find((l) => l.sapCode === sapCode)?.unitPrice ?? itemMap.get(sapCode)?.wholesalePrice}
          className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"
        />
        <ReturnList returns={value.returns} onRemove={(key) => onChange({ ...value, returns: value.returns.filter((x) => x.key !== key) })} />
      </section>

      <dl className="grid grid-cols-2 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
        <dt className="text-slate-500">Items total</dt>
        <dd className="text-right tabular-nums">{formatMoney(t.items)}</dd>
        {t.returns > 0 && (
          <>
            <dt className="text-slate-500">Returns</dt>
            <dd className="text-right text-red-600 tabular-nums">− {formatMoney(t.returns)}</dd>
            <dt className="text-slate-500">Gross value</dt>
            <dd className="text-right tabular-nums">{formatMoney(t.gross)}</dd>
          </>
        )}
        <dt className="text-slate-500">Bill discount ({sale.discountPercent}%)</dt>
        <dd className="text-right tabular-nums">{t.discount ? `− ${formatMoney(t.discount)}` : formatMoney(0)}</dd>
        <dt className="border-t border-slate-200 pt-1.5 font-semibold text-slate-900">Invoice value</dt>
        <dd className="border-t border-slate-200 pt-1.5 text-right font-semibold text-slate-900 tabular-nums">{formatMoney(t.total)}</dd>
      </dl>
    </div>
  );
}
