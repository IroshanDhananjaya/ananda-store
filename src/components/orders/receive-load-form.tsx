"use client";

import { FileText, MapPin, PackagePlus, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ItemFormDialog } from "@/components/items/item-form-dialog";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
/** One Raigam invoice the load came on, with its own discount % and items */
type InvoiceDraft = { key: string; invoiceNumber: string; poNumber: string; discountPercent: string; lines: LineDraft[] };
type InvoiceErrors = { invoiceNumber?: string; discountPercent?: string };

const emptyLine = (): LineDraft => ({ key: newId(), itemCode: "", qty: "", unitPrice: "", discount: "0" });
const emptyInvoice = (): InvoiceDraft => ({ key: newId(), invoiceNumber: "", poNumber: "", discountPercent: "", lines: [emptyLine()] });
/** A row nothing was typed into; skipped when saving */
const isBlank = (l: LineDraft) => !l.itemCode && !l.qty && !l.unitPrice && toNumber(l.discount) === 0;

const gross = (l: LineDraft) => round2(toNumber(l.qty) * toNumber(l.unitPrice));
const value = (l: LineDraft) => round2(gross(l) - toNumber(l.discount));

const invoiceLabel = (inv: InvoiceDraft, n: number) => inv.invoiceNumber.trim() || `Invoice ${n + 1}`;

/** What one invoice comes to: its lines, their discounts, then its own discount % */
function invoiceSums(inv: InvoiceDraft) {
  const filled = inv.lines.filter((l) => !isBlank(l));
  const qty = filled.reduce((n, l) => n + toNumber(l.qty), 0);
  const linesGross = round2(filled.reduce((sum, l) => sum + gross(l), 0));
  const lineDiscount = round2(filled.reduce((sum, l) => sum + toNumber(l.discount), 0));
  const linesValue = round2(linesGross - lineDiscount);
  const pct = toNumber(inv.discountPercent);
  const { discount, total } = invoiceDiscount(linesValue, pct);
  return { filled, qty, linesGross, lineDiscount, linesValue, pct, discount, total };
}

/** Focus a field once React has drawn it (e.g. in a row that was just added) */
const focusField = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/** Numbered section title: 1 Delivery, 2 Invoices, 3 Payment */
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

/**
 * A load from Raigam, on one or more invoices (each with its own discount %):
 * saved as one received purchase order and added to stock in one step
 */
export function ReceiveLoadForm({ onSaved, cancelHref }: { onSaved: (id: string) => void; cancelHref: string }) {
  const items = useAppStore((s) => s.items);
  const orders = useAppStore((s) => s.orders);
  const locations = useAppStore((s) => s.locations);
  const receiveLoad = useAppStore((s) => s.receiveLoad);
  const itemMap = useItemMap();
  // Setting a missing stock location on an item, without leaving the load
  const setLocation = useDialog<Item>();
  // Removing an invoice that already has items on it
  const removing = useDialog<InvoiceDraft>();

  const [deliveryDate, setDeliveryDate] = useState(todayISO);
  const [dateError, setDateError] = useState<string>();
  const [invoices, setInvoices] = useState<InvoiceDraft[]>(() => [emptyInvoice()]);
  const [invoiceErrors, setInvoiceErrors] = useState<Record<string, InvoiceErrors>>({});
  const [payment, setPayment] = useState<OrderPayment>(NOT_PAID);
  const [paymentErrors, setPaymentErrors] = useState<OrderPaymentErrors>({});
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});
  const [formError, setFormError] = useState<string>();

  const lastPrice = useLastInvoicePrices();

  const sums = invoices.map(invoiceSums);
  const filled = sums.flatMap((s) => s.filled);
  // Each item goes into stock at the location set on the item
  const locationOf = (itemCode: string) => locations.find((x) => x.locationNumber === itemMap.get(itemCode)?.locationNumber);
  const unmapped = filled.filter((l) => l.itemCode && !locationOf(l.itemCode)).map((l) => l.itemCode);
  // An order holds each item once: an item picked on one invoice can't be picked again on any
  const invoiceOfItem = new Map(invoices.flatMap((inv, n) => inv.lines.filter((l) => l.itemCode).map((l) => [l.itemCode, invoiceLabel(inv, n)] as const)));
  const totalQty = sums.reduce((n, s) => n + s.qty, 0);
  const totalGross = round2(sums.reduce((sum, s) => sum + s.linesGross, 0));
  const totalLineDiscount = round2(sums.reduce((sum, s) => sum + s.lineDiscount, 0));
  const totalInvoiceDiscount = round2(sums.reduce((sum, s) => sum + s.discount, 0));
  const grandTotal = round2(sums.reduce((sum, s) => sum + s.total, 0));
  const several = invoices.length > 1;

  const itemOptions = (l: LineDraft) =>
    items.map((i) => {
      const elsewhere = i.sapCode !== l.itemCode && invoiceOfItem.get(i.sapCode);
      return {
        value: i.sapCode,
        label: i.sapCode,
        description: i.description,
        hint: elsewhere ? `Already on ${elsewhere}` : i.packageDetails,
        disabled: !!elsewhere,
      };
    });

  const updateInvoice = (key: string, patch: Partial<Omit<InvoiceDraft, "key" | "lines">>) => {
    setInvoices((is) => is.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setInvoiceErrors((e) => (e[key] ? { ...e, [key]: {} } : e));
    setFormError(undefined);
  };

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setInvoices((is) => is.map((i) => ({ ...i, lines: i.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })));
    setLineErrors((e) => (e[key] ? { ...e, [key]: {} } : e));
    setFormError(undefined);
  };

  const removeLine = (key: string) => setInvoices((is) => is.map((i) => ({ ...i, lines: i.lines.filter((l) => l.key !== key) })));

  function addLine(invoiceKey: string) {
    const line = emptyLine();
    setInvoices((is) => is.map((i) => (i.key === invoiceKey ? { ...i, lines: [...i.lines, line] } : i)));
    focusField(`item-${line.key}`);
  }

  function addInvoice() {
    const invoice = emptyInvoice();
    setInvoices((is) => [...is, invoice]);
    setFormError(undefined);
    focusField(`inv-${invoice.key}-no`);
  }

  function removeInvoice(key: string) {
    setInvoices((is) => is.filter((i) => i.key !== key));
    setInvoiceErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    setFormError(undefined);
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

  /** Enter moves on through the row (qty → price → next row), starting a new row after the invoice's last one */
  function enterTo(e: KeyboardEvent<HTMLInputElement>, next: string | null, invoice: InvoiceDraft, index: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (next) return focusField(next);
    const following = invoice.lines[index + 1];
    if (following) focusField(`item-${following.key}`);
    else addLine(invoice.key);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const dErr = deliveryDate ? undefined : "Delivery date is required.";

    const iErr: Record<string, InvoiceErrors> = {};
    const numbers = new Set<string>();
    for (const inv of invoices) {
      const err: InvoiceErrors = {};
      const no = inv.invoiceNumber.trim().toUpperCase();
      if (!no) err.invoiceNumber = "Invoice number is required.";
      else if (numbers.has(no)) err.invoiceNumber = "This invoice number is entered twice.";
      numbers.add(no);
      const pct = Number(inv.discountPercent);
      if (Number.isNaN(pct) || pct < 0 || pct >= 100) err.discountPercent = "Enter a % from 0 to 99.99.";
      if (Object.keys(err).length) iErr[inv.key] = err;
    }

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
    setDateError(dErr);
    setInvoiceErrors(iErr);
    setLineErrors(lErr);
    setPaymentErrors(pErr);

    const emptyAt = sums.findIndex((s) => s.filled.length === 0);
    const error =
      filled.length === 0
        ? "Add at least one item."
        : emptyAt >= 0
          ? `${invoiceLabel(invoices[emptyAt], emptyAt)} has no items: add them, or remove the invoice.`
          : Object.keys(lErr).length
            ? "Check the highlighted rows: pick an item, a whole-number quantity, a price and a discount no more than the line amount."
            : unmapped.length
              ? `Set a stock location on ${unmapped.join(", ")} first (Set location, under the item).`
              : undefined;
    setFormError(error);
    if (error || dErr || Object.keys(iErr).length || Object.keys(pErr).length) {
      toast.error(error ?? "Check the highlighted fields.");
      return;
    }

    const input: ReceiveLoadInput = {
      deliveryDate,
      payment,
      invoices: invoices.map((inv, n) => ({
        invoiceNumber: inv.invoiceNumber,
        poNumber: inv.poNumber,
        discountPercent: sums[n].pct,
        lines: sums[n].filled.map((l) => ({
          itemCode: l.itemCode,
          qty: Number(l.qty),
          unitPrice: toNumber(l.unitPrice),
          discount: toNumber(l.discount),
        })),
      })),
    };
    const result = await receiveLoad(input);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Load saved${several ? ` on ${invoices.length} invoices` : ""} · ${formatQty(totalQty)} units added to stock · ${formatMoney(grandTotal)}`,
    );
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
        // Wide screens: invoices on the left, a summary that stays in view on the right.
        // Narrower: one column, with a bar at the bottom that keeps the total and Save in view.
        className="grid items-start gap-6 min-[1360px]:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader
              title={<Step n={1}>Delivery</Step>}
              description="When the load came. It can come on several Raigam invoices: add each one below."
              actions={
                <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
                  Saved as {nextOrderId(orders)}
                </span>
              }
            />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label="Delivery Date" htmlFor="loadDate" required error={dateError}>
                <Input
                  id="loadDate"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => {
                    setDeliveryDate(e.target.value);
                    setDateError(undefined);
                  }}
                  aria-invalid={!!dateError}
                />
              </Field>
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              <Step n={2}>
                Invoices
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums">{invoices.length}</span>
              </Step>
            </h2>
            <Button variant="secondary" size="sm" onClick={addInvoice}>
              <Plus /> Add invoice
            </Button>
          </div>

          {locations.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              There are no stock locations yet.{" "}
              <Link href="/locations" className="font-medium underline">
                Add one first
              </Link>
            </p>
          )}
          {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{formError}</p>}

          {invoices.map((inv, n) => {
            const s = sums[n];
            const errs = invoiceErrors[inv.key] ?? {};
            return (
              <Card key={inv.key}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2.5">
                      <span className="grid size-6 place-items-center rounded-full bg-brand-50 text-brand-700 [&_svg]:size-3.5">
                        <FileText />
                      </span>
                      {several ? `Invoice ${n + 1}` : "Invoice"}
                      {inv.invoiceNumber.trim() && <span className="font-normal text-slate-500">· {inv.invoiceNumber.trim()}</span>}
                    </span>
                  }
                  description={`${s.filled.length} item${s.filled.length === 1 ? "" : "s"} · ${formatMoney(s.total)}${s.discount ? ` after ${s.pct}% off` : ""}`}
                  actions={
                    several && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => (s.filled.length ? removing.open(inv) : removeInvoice(inv.key))}
                        aria-label={`Remove ${invoiceLabel(inv, n)}`}
                        title="Remove this invoice"
                      >
                        <X />
                      </Button>
                    )
                  }
                />
                <div className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-3">
                  <Field label="Invoice Number" htmlFor={`inv-${inv.key}-no`} required error={errs.invoiceNumber}>
                    <Input
                      id={`inv-${inv.key}-no`}
                      value={inv.invoiceNumber}
                      onChange={(e) => updateInvoice(inv.key, { invoiceNumber: e.target.value })}
                      placeholder="e.g. 131087"
                      aria-invalid={!!errs.invoiceNumber}
                      autoComplete="off"
                      autoFocus={n === 0}
                    />
                  </Field>
                  <Field label="PO Number" htmlFor={`inv-${inv.key}-po`}>
                    <Input
                      id={`inv-${inv.key}-po`}
                      value={inv.poNumber}
                      onChange={(e) => updateInvoice(inv.key, { poNumber: e.target.value })}
                      placeholder="e.g. 26101908"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Discount % for Total Invoice" htmlFor={`inv-${inv.key}-pct`} error={errs.discountPercent}>
                    <Input
                      id={`inv-${inv.key}-pct`}
                      type="number"
                      min={0}
                      max={99.99}
                      step="0.01"
                      inputMode="decimal"
                      value={inv.discountPercent}
                      onChange={(e) => updateInvoice(inv.key, { discountPercent: e.target.value })}
                      placeholder="0"
                      aria-invalid={!!errs.discountPercent}
                      className="text-right tabular-nums"
                    />
                  </Field>
                </div>

                <div className="relative overflow-x-auto">
                  <StackBox>
                    <table className="w-full min-w-[700px] text-sm">
                      <thead className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        <tr>
                          <th className="w-12 py-2.5 pl-5">#</th>
                          <th className="px-2 py-2.5">Item</th>
                          <th className="w-24 px-2 py-2.5 text-right">Qty</th>
                          <th className="w-28 px-2 py-2.5 text-right">Price</th>
                          <th className="w-24 px-2 py-2.5 text-right">Discount</th>
                          <th className="w-32 px-2 py-2.5 text-right">Value</th>
                          <th className="w-12 py-2.5 pr-3">
                            <span className="sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {inv.lines.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                              No items yet.
                            </td>
                          </tr>
                        )}
                        {inv.lines.map((l, index) => {
                          const err = lineErrors[l.key] ?? {};
                          const item = itemMap.get(l.itemCode);
                          const location = item && locationOf(item.sapCode);
                          const qty = toNumber(l.qty);
                          const price = toNumber(l.unitPrice);
                          const last = lastPrice.get(l.itemCode);
                          const netCost = qty > 0 && price > 0 ? netUnitCost({ qty, unitPrice: price, discount: toNumber(l.discount) }, s.pct) : null;
                          const hasError = Object.keys(err).length > 0;
                          const where = `row ${index + 1}${several ? ` of ${invoiceLabel(inv, n)}` : ""}`;
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
                                  aria-label={`Item for ${where}`}
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
                                    {last !== undefined ? (
                                      <span>Last invoice {formatMoney(last)}</span>
                                    ) : (
                                      <span className="text-amber-700">First invoice for this item</span>
                                    )}
                                    {l.unitPrice !== "" && price === 0 ? (
                                      <span className="font-medium text-slate-600">· Free, cost stays {formatMoney(item.costPrice)}</span>
                                    ) : (
                                      netCost !== null &&
                                      netCost !== item.costPrice && (
                                        <span className="font-medium text-brand-700">
                                          · Cost {formatMoney(item.costPrice)} → {formatMoney(netCost)}
                                        </span>
                                      )
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
                                  onKeyDown={(e) => enterTo(e, `price-${l.key}`, inv, index)}
                                  aria-invalid={!!err.qty}
                                  aria-label={`Quantity for ${where}`}
                                  className="min-w-20 text-right tabular-nums"
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
                                  onKeyDown={(e) => enterTo(e, null, inv, index)}
                                  aria-invalid={!!err.unitPrice}
                                  aria-label={`Price for ${where}`}
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
                                  onKeyDown={(e) => enterTo(e, null, inv, index)}
                                  aria-invalid={!!err.discount}
                                  aria-label={`Discount for ${where}`}
                                  className="text-right tabular-nums"
                                />
                              </td>
                              <td
                                className={cn(
                                  "px-2 py-4 text-right font-semibold whitespace-nowrap tabular-nums",
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
                                  onClick={() => removeLine(l.key)}
                                  aria-label={`Remove ${where}`}
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
                <div className="flex flex-col gap-3 border-t border-slate-100 p-4 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => addLine(inv.key)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700"
                  >
                    <Plus className="size-4" /> Add item
                  </button>
                  {/* This invoice's own total, to check against its last page */}
                  <dl className="shrink-0 text-right text-sm tabular-nums sm:min-w-56">
                    {s.discount > 0 && (
                      <div className="flex justify-end gap-2 text-xs text-slate-500">
                        <dt>
                          {formatMoney(s.linesValue)} − {s.pct}%
                        </dt>
                        <dd>({formatMoney(s.discount)})</dd>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <dt className="text-slate-500">{several ? `${invoiceLabel(inv, n)} total` : "Invoice total"}</dt>
                      <dd className="font-semibold text-slate-900">{formatMoney(s.total)}</dd>
                    </div>
                  </dl>
                </div>
              </Card>
            );
          })}

          <button
            type="button"
            onClick={addInvoice}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 py-4 text-sm font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700"
          >
            <FileText className="size-4" /> Add another invoice (same load)
          </button>
        </div>

        <aside className="flex flex-col gap-6 min-[1360px]:sticky min-[1360px]:top-6 min-[1360px]:max-h-[calc(100dvh-3rem)] min-[1360px]:overflow-y-auto">
          <Card>
            <div className="bg-gradient-to-br from-brand-700 to-brand-900 px-5 py-5 text-white">
              <p className="text-xs font-medium tracking-wide text-brand-100 uppercase">Grand total</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(grandTotal)}</p>
              <p className="mt-1 text-xs text-brand-100">
                {several ? `${invoices.length} invoices · ` : ""}
                {filled.length} item{filled.length === 1 ? "" : "s"} · {formatQty(totalQty)} units · saved as the bill amount
              </p>
            </div>
            <dl className="divide-y divide-slate-100 px-5 text-sm">
              {several &&
                invoices.map((inv, n) => (
                  <SummaryRow key={inv.key} label={invoiceLabel(inv, n)}>
                    {formatMoney(sums[n].total)}
                  </SummaryRow>
                ))}
              <SummaryRow label="Lines total">{formatMoney(totalGross)}</SummaryRow>
              {totalLineDiscount > 0 && <SummaryRow label="Line discounts">− {formatMoney(totalLineDiscount)}</SummaryRow>}
              <SummaryRow label="Invoice discounts">{totalInvoiceDiscount > 0 ? `− ${formatMoney(totalInvoiceDiscount)}` : "—"}</SummaryRow>
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
          className="sticky bottom-0 z-20 -mx-4 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6 min-[1360px]:hidden"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">
              Grand total · {several ? `${invoices.length} invoices · ` : ""}
              {filled.length} item{filled.length === 1 ? "" : "s"}
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

      <ConfirmDialog
        open={removing.isOpen}
        onClose={removing.close}
        title={`Remove ${removing.target?.invoiceNumber.trim() || "this invoice"}?`}
        message="Its items are taken off the load too."
        confirmLabel="Remove invoice"
        onConfirm={() => {
          if (removing.target) removeInvoice(removing.target.key);
          removing.close();
        }}
      />
    </>
  );
}
