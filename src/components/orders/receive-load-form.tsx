"use client";

import { MapPin, PackagePlus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ItemFormDialog } from "@/components/items/item-form-dialog";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, toNumber } from "@/components/ui/form";
import { SearchSelect } from "@/components/ui/search-select";
import { Card, CardHeader } from "@/components/ui/layout";
import { StackBox } from "@/components/ui/table";
import { useAppStore, useItemMap, useLastInvoicePrices } from "@/lib/store";
import type { Item, OrderPayment, ReceiveLoadInput } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatMoney, formatQty, invoiceDiscount, netUnitCost, newId, nextOrderId, NOT_PAID, round2, todayISO } from "@/lib/utils";
import { OrderPaymentFields, orderPaymentErrors, type OrderPaymentErrors } from "./order-payment";

type LineDraft = { key: string; itemCode: string; qty: string; unitPrice: string; discount: string };
type LineErrors = Partial<Record<"itemCode" | "qty" | "unitPrice" | "discount", true>>;

const emptyLine = (): LineDraft => ({ key: newId(), itemCode: "", qty: "", unitPrice: "", discount: "0" });
/** A row nothing was typed into; skipped when saving */
const isBlank = (l: LineDraft) => !l.itemCode && !l.qty && !l.unitPrice && toNumber(l.discount) === 0;

const gross = (l: LineDraft) => round2(toNumber(l.qty) * toNumber(l.unitPrice));
const value = (l: LineDraft) => round2(gross(l) - toNumber(l.discount));

/** Focus a field once React has drawn it (e.g. in a row that was just added) */
const focusField = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/** Numbered section title: 1 Invoice, 2 Items, 3 Payment */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{n}</span>
      {children}
    </span>
  );
}

function SummaryRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2.5", className)}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 tabular-nums">{children}</dd>
    </div>
  );
}

/** A load from Raigam with its invoice: saved as a received purchase order and added to stock in one step */
export function ReceiveLoadForm({ onSaved, cancelHref }: { onSaved: (id: string) => void; cancelHref: string }) {
  const items = useAppStore((s) => s.items);
  const orders = useAppStore((s) => s.orders);
  const locations = useAppStore((s) => s.locations);
  const receiveLoad = useAppStore((s) => s.receiveLoad);
  const itemMap = useItemMap();
  // Setting a missing stock location on an item, without leaving the load
  const setLocation = useDialog<Item>();

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(todayISO);
  const [discountPercent, setDiscountPercent] = useState("");
  const [payment, setPayment] = useState<OrderPayment>(NOT_PAID);
  const [paymentErrors, setPaymentErrors] = useState<OrderPaymentErrors>({});
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});
  const [headerErrors, setHeaderErrors] = useState<{ invoiceNumber?: string; deliveryDate?: string; discountPercent?: string }>({});
  const [formError, setFormError] = useState<string>();

  const lastPrice = useLastInvoicePrices();

  const filled = lines.filter((l) => !isBlank(l));
  // Each item goes into stock at the location set on the item
  const locationOf = (itemCode: string) => locations.find((x) => x.locationNumber === itemMap.get(itemCode)?.locationNumber);
  const unmapped = filled.filter((l) => l.itemCode && !locationOf(l.itemCode)).map((l) => l.itemCode);
  const chosen = new Set(lines.map((l) => l.itemCode));
  const totalQty = filled.reduce((n, l) => n + toNumber(l.qty), 0);
  const totalGross = round2(filled.reduce((sum, l) => sum + gross(l), 0));
  const totalDiscount = round2(filled.reduce((sum, l) => sum + toNumber(l.discount), 0));
  const totalValue = round2(totalGross - totalDiscount);
  const pct = toNumber(discountPercent);
  const { discount: invoiceOff, total: grandTotal } = invoiceDiscount(totalValue, pct);

  const itemOptions = (l: LineDraft) =>
    items.map((i) => ({
      value: i.sapCode,
      label: i.sapCode,
      description: i.description,
      hint: i.packageDetails,
      disabled: i.sapCode !== l.itemCode && chosen.has(i.sapCode),
    }));

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setLineErrors((e) => (e[key] ? { ...e, [key]: {} } : e));
    setFormError(undefined);
  };

  function addLine() {
    const line = emptyLine();
    setLines((ls) => [...ls, line]);
    focusField(`item-${line.key}`);
  }

  // A picked item starts at its price on the last invoice
  function pickItem(l: LineDraft, itemCode: string) {
    const price = lastPrice.get(itemCode);
    updateLine(l.key, {
      itemCode,
      unitPrice: l.unitPrice === "" && price !== undefined ? String(price) : l.unitPrice,
    });
    focusField(`qty-${l.key}`);
  }

  /** Enter moves on through the row (qty → price → next row), starting a new row after the last one */
  function enterTo(e: KeyboardEvent<HTMLInputElement>, next: string | null, index: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (next) return focusField(next);
    const following = lines[index + 1];
    if (following) focusField(`item-${following.key}`);
    else addLine();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const hErr: typeof headerErrors = {};
    if (!invoiceNumber.trim()) hErr.invoiceNumber = "Invoice number is required.";
    if (!deliveryDate) hErr.deliveryDate = "Delivery date is required.";
    if (Number(discountPercent) < 0 || Number(discountPercent) >= 100 || Number.isNaN(Number(discountPercent)))
      hErr.discountPercent = "Enter a % from 0 to 99.99.";

    const lErr: Record<string, LineErrors> = {};
    for (const l of filled) {
      const err: LineErrors = {};
      const qty = Number(l.qty);
      if (!l.itemCode) err.itemCode = true;
      if (!Number.isInteger(qty) || qty <= 0) err.qty = true;
      if (l.unitPrice === "" || toNumber(l.unitPrice) < 0) err.unitPrice = true;
      if (toNumber(l.discount) < 0 || toNumber(l.discount) > gross(l)) err.discount = true;
      if (Object.keys(err).length) lErr[l.key] = err;
    }
    const pErr = orderPaymentErrors(payment);
    setHeaderErrors(hErr);
    setLineErrors(lErr);
    setPaymentErrors(pErr);

    const error =
      filled.length === 0
        ? "Add at least one item."
        : Object.keys(lErr).length
          ? "Check the highlighted rows: pick an item, a whole-number quantity, a price and a discount no more than the line amount."
          : unmapped.length
            ? `Set a stock location on ${unmapped.join(", ")} first (Set location, under the item).`
            : undefined;
    setFormError(error);
    if (error || Object.keys(hErr).length || Object.keys(pErr).length) {
      toast.error(error ?? "Check the highlighted fields.");
      return;
    }

    const input: ReceiveLoadInput = {
      invoiceNumber,
      poNumber,
      deliveryDate,
      discountPercent: pct,
      payment,
      lines: filled.map((l) => ({
        itemCode: l.itemCode,
        qty: Number(l.qty),
        unitPrice: toNumber(l.unitPrice),
        discount: toNumber(l.discount),
      })),
    };
    const result = await receiveLoad(input);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Load saved · ${formatQty(totalQty)} units added to stock · ${formatMoney(grandTotal)}`);
    onSaved(result.id!);
  }

  const saveButton = (className?: string) => (
    <Button type="submit" className={className}>
      <PackagePlus /> Save & add to stock
    </Button>
  );

  return (
    <>
      <form
        onSubmit={handleSubmit}
        // Enter in a box never saves the whole load by accident (row boxes move on instead)
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && !e.defaultPrevented) e.preventDefault();
        }}
        noValidate
        // Wide screens: items on the left, a summary that stays in view on the right.
        // Narrower: one column, with a bar at the bottom that keeps the total and Save in view.
        className="grid items-start gap-6 min-[1360px]:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader
              title={<Step n={1}>Invoice</Step>}
              description="As printed on the Raigam invoice."
              actions={
                <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
                  Saved as {nextOrderId(orders)}
                </span>
              }
            />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label="Invoice Number" htmlFor="loadInvoice" required error={headerErrors.invoiceNumber}>
                <Input
                  id="loadInvoice"
                  value={invoiceNumber}
                  onChange={(e) => {
                    setInvoiceNumber(e.target.value);
                    setHeaderErrors((h) => ({ ...h, invoiceNumber: undefined }));
                  }}
                  placeholder="e.g. 131087"
                  aria-invalid={!!headerErrors.invoiceNumber}
                  autoFocus
                />
              </Field>
              <Field label="PO Number" htmlFor="loadPo">
                <Input id="loadPo" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. 26101908" />
              </Field>
              <Field label="Delivery Date" htmlFor="loadDate" required error={headerErrors.deliveryDate}>
                <Input
                  id="loadDate"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => {
                    setDeliveryDate(e.target.value);
                    setHeaderErrors((h) => ({ ...h, deliveryDate: undefined }));
                  }}
                  aria-invalid={!!headerErrors.deliveryDate}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={
                <Step n={2}>
                  Items
                  {filled.length > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums">{filled.length}</span>
                  )}
                </Step>
              }
              description="Type a code or name to find an item; it goes to the stock location set on the item. Enter moves to the next box; after the price it starts a new row."
            />
            {locations.length === 0 && (
              <p className="border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-sm text-amber-800">
                There are no stock locations yet.{" "}
                <Link href="/locations" className="font-medium underline">
                  Add one first
                </Link>
              </p>
            )}
            {formError && <p className="border-b border-red-100 bg-red-50 px-5 py-2.5 text-sm text-red-700">{formError}</p>}
            <div className="relative overflow-x-auto">
              <StackBox>
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th className="w-12 py-2.5 pl-5">#</th>
                      <th className="px-2 py-2.5">Item</th>
                      <th className="w-20 px-2 py-2.5 text-right">Qty</th>
                      <th className="w-28 px-2 py-2.5 text-right">Price</th>
                      <th className="w-24 px-2 py-2.5 text-right">Discount</th>
                      <th className="w-32 px-2 py-2.5 text-right">Value</th>
                      <th className="w-12 py-2.5 pr-3">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                          No items yet.
                        </td>
                      </tr>
                    )}
                    {lines.map((l, index) => {
                      const err = lineErrors[l.key] ?? {};
                      const item = itemMap.get(l.itemCode);
                      const location = item && locationOf(item.sapCode);
                      const qty = toNumber(l.qty);
                      const price = toNumber(l.unitPrice);
                      const last = lastPrice.get(l.itemCode);
                      const netCost = qty > 0 && price > 0 ? netUnitCost({ qty, unitPrice: price, discount: toNumber(l.discount) }, pct) : null;
                      const hasError = Object.keys(err).length > 0;
                      return (
                        <tr key={l.key} className={cn("align-top transition-colors", hasError ? "bg-red-50/50" : "hover:bg-slate-50/70")}>
                          <td className="py-4 pl-5">
                            <span className="grid size-6 place-items-center rounded-full bg-slate-100 text-xs font-medium text-slate-500 tabular-nums">
                              {index + 1}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <SearchSelect
                              id={`item-${l.key}`}
                              value={l.itemCode}
                              onChange={(code) => pickItem(l, code)}
                              options={itemOptions(l)}
                              placeholder="Search item…"
                              showDescription
                              aria-invalid={!!err.itemCode}
                              aria-label={`Item for row ${index + 1}`}
                              className="min-w-60"
                            />
                            {item && (
                              <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
                                <span>
                                  {item.packageDetails ? `${item.packageDetails} · ` : ""}
                                  {item.uom}
                                </span>
                                <span>·</span>
                                {location ? (
                                  <span className="inline-flex items-center gap-1" title={`Goes to ${location.locationNumber} · ${location.itemGroup}`}>
                                    <MapPin className="size-3" />
                                    {location.locationNumber}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setLocation.open(item)}
                                    className="inline-flex items-center gap-1 font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800"
                                  >
                                    <MapPin className="size-3" />
                                    No stock location · Set location
                                  </button>
                                )}
                                <span>·</span>
                                {last !== undefined ? <span>Last invoice {formatMoney(last)}</span> : <span className="text-amber-700">First invoice for this item</span>}
                                {l.unitPrice !== "" && price === 0 ? (
                                  <span className="font-medium text-slate-600">· Free, cost stays {formatMoney(item.costPrice)}</span>
                                ) : (
                                  netCost !== null &&
                                  netCost !== item.costPrice && <span className="font-medium text-brand-700">· Cost {formatMoney(item.costPrice)} → {formatMoney(netCost)}</span>
                                )}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            <Input
                              id={`qty-${l.key}`}
                              type="number"
                              min={1}
                              step={1}
                              inputMode="numeric"
                              value={l.qty}
                              onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                              onKeyDown={(e) => enterTo(e, `price-${l.key}`, index)}
                              aria-invalid={!!err.qty}
                              aria-label={`Quantity for row ${index + 1}`}
                              className="text-right tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-2.5">
                            <Input
                              id={`price-${l.key}`}
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={l.unitPrice}
                              onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                              onKeyDown={(e) => enterTo(e, null, index)}
                              aria-invalid={!!err.unitPrice}
                              aria-label={`Price for row ${index + 1}`}
                              className="text-right tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-2.5">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={l.discount}
                              onChange={(e) => updateLine(l.key, { discount: e.target.value })}
                              onKeyDown={(e) => enterTo(e, null, index)}
                              aria-invalid={!!err.discount}
                              aria-label={`Discount for row ${index + 1}`}
                              className="text-right tabular-nums"
                            />
                          </td>
                          <td
                            className={cn(
                              "px-2 py-4 text-right font-semibold tabular-nums",
                              value(l) < 0 ? "text-red-600" : value(l) > 0 ? "text-slate-900" : "text-slate-300",
                            )}
                          >
                            {formatMoney(value(l))}
                          </td>
                          <td className="py-2.5 pr-3">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="mt-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                              aria-label={`Remove row ${index + 1}`}
                            >
                              <Trash2 />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </StackBox>
            </div>
            <div className="border-t border-slate-100 p-4">
              <button
                type="button"
                onClick={addLine}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700"
              >
                <Plus className="size-4" /> Add item
              </button>
            </div>
          </Card>
        </div>

        <aside className="flex flex-col gap-6 min-[1360px]:sticky min-[1360px]:top-6 min-[1360px]:max-h-[calc(100dvh-3rem)] min-[1360px]:overflow-y-auto">
          <Card>
            <div className="bg-gradient-to-br from-brand-700 to-brand-900 px-5 py-5 text-white">
              <p className="text-xs font-medium tracking-wide text-brand-100 uppercase">Grand total</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(grandTotal)}</p>
              <p className="mt-1 text-xs text-brand-100">
                {filled.length} item{filled.length === 1 ? "" : "s"} · {formatQty(totalQty)} units · saved as the bill amount
              </p>
            </div>
            <dl className="divide-y divide-slate-100 px-5 text-sm">
              <SummaryRow label="Lines total">{formatMoney(totalGross)}</SummaryRow>
              {totalDiscount > 0 && <SummaryRow label="Line discounts">− {formatMoney(totalDiscount)}</SummaryRow>}
              <div className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="loadDiscountPct" className="text-slate-500">
                    Invoice discount
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="loadDiscountPct"
                      type="number"
                      min={0}
                      max={99.99}
                      step="0.01"
                      inputMode="decimal"
                      value={discountPercent}
                      onChange={(e) => {
                        setDiscountPercent(e.target.value);
                        setHeaderErrors((h) => ({ ...h, discountPercent: undefined }));
                      }}
                      placeholder="0"
                      aria-invalid={!!headerErrors.discountPercent}
                      className="h-8 w-20 text-right tabular-nums"
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                </div>
                <p className={cn("mt-1 text-xs", headerErrors.discountPercent ? "text-red-600" : "text-slate-400")}>
                  {headerErrors.discountPercent ?? (invoiceOff ? `− ${formatMoney(invoiceOff)}` : "On the last page of the invoice")}
                </p>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title={<Step n={3}>Payment</Step>} description="Not paid yet? Leave it and record it later from the order page." />
            <div className="grid gap-4 p-5">
              <OrderPaymentFields value={payment} onChange={setPayment} errors={paymentErrors} idPrefix="load" receivedDate={deliveryDate} />
            </div>
          </Card>

          <div className="hidden flex-col gap-2 min-[1360px]:flex">
            {saveButton("h-12 w-full text-base")}
            <Link href={cancelHref} className={buttonClass("ghost", "md", "w-full")}>
              Cancel
            </Link>
          </div>
        </aside>

        {/* Narrower screens: keep the total and Save in view at the bottom */}
        <div
          className="sticky bottom-0 z-20 -mx-4 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 min-[1360px]:hidden"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">
              Grand total · {filled.length} item{filled.length === 1 ? "" : "s"}
            </p>
            <p className="truncate text-lg font-semibold text-slate-900 tabular-nums">{formatMoney(grandTotal)}</p>
          </div>
          <Link href={cancelHref} className={buttonClass("ghost", "md", "hidden sm:inline-flex")}>
            Cancel
          </Link>
          {saveButton()}
        </div>
      </form>

      {/* Outside the load form: the item dialog has a form of its own */}
      <ItemFormDialog
        open={setLocation.isOpen}
        item={setLocation.target}
        focusLocation
        onClose={() => {
          setLocation.close();
          setFormError(undefined);
        }}
      />
    </>
  );
}
