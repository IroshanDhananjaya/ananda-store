"use client";

import { ClipboardCheck, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { LineStatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, ReadOnlyValue, toNumber } from "@/components/ui/form";
import { SearchSelect } from "@/components/ui/search-select";
import { Card, CardHeader } from "@/components/ui/layout";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap, useLastInvoicePrices } from "@/lib/store";
import type { LineStatus, Order, OrderInput, OrderItem, OrderLineInput } from "@/lib/types";
import { cn, formatMoney, formatQty, invoiceDiscount, newId, nextOrderId, NOT_PAID, nowTime, orderLineValue, paymentOf, round2, todayISO } from "@/lib/utils";
import { OrderPaymentFields, orderPaymentErrors } from "./order-payment";

type HeaderDraft = Omit<OrderInput, "totalBillAmount" | "discountPercent">;
type LineDraft = { key: string; itemCode: string; orderedQty: string; receivedQty: string; unitPrice: string; discount: string; remarks: string };
type DraftErrors = Partial<Record<"itemCode" | "orderedQty" | "receivedQty" | "unitPrice" | "discount", string>>;

const emptyDraft = (): LineDraft => ({ key: newId(), itemCode: "", orderedQty: "", receivedQty: "0", unitPrice: "", discount: "0", remarks: "" });

const numbersOf = (l: LineDraft) => ({
  orderedQty: toNumber(l.orderedQty),
  receivedQty: toNumber(l.receivedQty),
  unitPrice: toNumber(l.unitPrice),
  discount: toNumber(l.discount),
});

const isWhole = (v: string) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;
/** Has what a line needs (items picked from Low stock arrive without a quantity) */
const isComplete = (l: LineDraft) => !!l.itemCode && isWhole(l.orderedQty) && toNumber(l.orderedQty) > 0 && l.unitPrice !== "";

/** Focus a field once React has drawn it */
const focusField = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

export function OrderForm({
  order,
  lines: initialLines,
  prefill = [],
  onSaved,
  cancelHref,
}: {
  order: Order | null;
  lines: OrderItem[];
  /** SAP codes to start a new order with (e.g. picked from Low stock); quantities are left to fill in */
  prefill?: string[];
  onSaved: (id: string) => void;
  cancelHref: string;
}) {
  const items = useAppStore((s) => s.items);
  const orders = useAppStore((s) => s.orders);
  const createOrder = useAppStore((s) => s.createOrder);
  const updateOrder = useAppStore((s) => s.updateOrder);
  const itemMap = useItemMap();
  const lastPrice = useLastInvoicePrices();
  const priceFor = (itemCode: string) => String(lastPrice.get(itemCode) ?? "");

  const [header, setHeader] = useState<HeaderDraft>(() => ({
    invoiceNumber: order?.invoiceNumber ?? "",
    poNumber: order?.poNumber ?? "",
    orderDate: order?.orderDate ?? todayISO(),
    receivedDate: order?.receivedDate ?? "",
    receivedTime: order?.receivedTime ?? "",
    ...(order ? paymentOf(order) : NOT_PAID),
  }));

  // Keys are stable (line id / SAP code), so building the starting lines twice gives the same rows
  const startLines = (): LineDraft[] =>
    initialLines.length
      ? initialLines.map((l) => ({
          key: l.id,
          itemCode: l.itemCode,
          orderedQty: String(l.orderedQty),
          receivedQty: String(l.receivedQty),
          unitPrice: String(l.unitPrice),
          discount: String(l.discount),
          remarks: l.remarks,
        }))
      : prefill.map((itemCode) => ({ ...emptyDraft(), key: `prefill-${itemCode}`, itemCode, unitPrice: priceFor(itemCode) }));
  const [lines, setLines] = useState<LineDraft[]>(startLines);
  // The add/edit panel; it opens on the first line still missing its quantity
  const [draft, setDraft] = useState<LineDraft>(() => startLines().find((l) => !isComplete(l)) ?? emptyDraft());
  const [editingKey, setEditingKey] = useState<string | null>(() => startLines().find((l) => !isComplete(l))?.key ?? null);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});

  const [discountPercent, setDiscountPercent] = useState(() => (order?.discountPercent ? String(order.discountPercent) : ""));

  // Invoice value: qty × price − discount per line (received qty once the order has arrived), less the invoice discount
  const calcAmount = (rows: Parameters<typeof orderLineValue>[0][], receivedDate: string, percent: number) =>
    invoiceDiscount(round2(rows.reduce((sum, l) => sum + orderLineValue(l, { receivedDate }), 0)), percent);

  // null = follow the calculated amount; a string = the user typed the invoice amount
  const [billInput, setBillInput] = useState<string | null>(() =>
    order && order.totalBillAmount !== calcAmount(initialLines, order.receivedDate, order.discountPercent).total
      ? String(order.totalBillAmount)
      : null,
  );
  const [headerErrors, setHeaderErrors] = useState<Partial<Record<keyof HeaderDraft, string>>>({});
  const [badLines, setBadLines] = useState<Set<string>>(() => new Set());
  const [formError, setFormError] = useState<string>();

  const pct = toNumber(discountPercent);
  const { discount: invoiceOff, total: calculated } = calcAmount(lines.map(numbersOf), header.receivedDate, pct);
  const billValue = billInput ?? String(calculated);
  const totalOrdered = lines.reduce((s, l) => s + toNumber(l.orderedQty), 0);
  const totalReceived = lines.reduce((s, l) => s + toNumber(l.receivedQty), 0);
  const draftItem = itemMap.get(draft.itemCode);
  // A new order hasn't arrived yet: received qty/date are entered later with "Receive order" on the order page
  const isNew = order === null;
  const editingIndex = lines.findIndex((l) => l.key === editingKey);

  const setField = (key: keyof HeaderDraft) => (e: { target: { value: string } }) =>
    setHeader((h) => ({ ...h, [key]: e.target.value }));

  function setDraftField(patch: Partial<LineDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDraftErrors({});
  }

  // A picked item starts at its price on the last Raigam invoice (unless a price was typed)
  function pickDraftItem(itemCode: string) {
    const autoPrice = draft.unitPrice === "" || draft.unitPrice === priceFor(draft.itemCode);
    setDraftField({ itemCode, unitPrice: autoPrice ? priceFor(itemCode) : draft.unitPrice });
    focusField("orderDraftQty");
  }

  function checkDraft(d: LineDraft): DraftErrors {
    const e: DraftErrors = {};
    if (!d.itemCode) e.itemCode = "Pick an item.";
    else if (lines.some((l) => l.itemCode === d.itemCode && l.key !== d.key)) e.itemCode = "Already in the list below. Edit it there.";
    if (!isWhole(d.orderedQty) || toNumber(d.orderedQty) === 0) e.orderedQty = "A whole number above 0.";
    if (!isWhole(d.receivedQty)) e.receivedQty = "A whole number, 0 or more.";
    if (d.unitPrice === "" || toNumber(d.unitPrice) < 0) e.unitPrice = "Enter the price.";
    const n = numbersOf(d);
    if (n.discount < 0 || n.discount > Math.max(n.orderedQty, n.receivedQty) * n.unitPrice) e.discount = "More than the line amount.";
    return e;
  }

  /** Add the panel's item to the list (or update the one being edited), then move on */
  function saveDraft() {
    const e = checkDraft(draft);
    setDraftErrors(e);
    if (Object.keys(e).length) return;
    const nextLines = editingKey ? lines.map((l) => (l.key === editingKey ? draft : l)) : [...lines, draft];
    setLines(nextLines);
    setBadLines((b) => {
      const next = new Set(b);
      next.delete(draft.key);
      return next;
    });
    setFormError(undefined);
    // Next line still missing its quantity, else a fresh panel for the next item
    const next = nextLines.find((l) => !isComplete(l));
    setDraft(next ?? emptyDraft());
    setEditingKey(next?.key ?? null);
    focusField(next ? "orderDraftQty" : "orderDraftItem");
  }

  function editLine(l: LineDraft) {
    setDraft(l);
    setEditingKey(l.key);
    setDraftErrors({});
    document.getElementById("orderDraftPanel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    focusField(l.itemCode ? "orderDraftQty" : "orderDraftItem");
  }

  function cancelEdit() {
    setDraft(emptyDraft());
    setEditingKey(null);
    setDraftErrors({});
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
    if (editingKey === key) cancelEdit();
  }

  // Enter in the panel adds the item instead of saving the whole order
  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.defaultPrevented || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    saveDraft();
  }

  function lineStatus(l: LineDraft): LineStatus {
    if (!header.receivedDate) return "Pending";
    return toNumber(l.orderedQty) === toNumber(l.receivedQty) ? "Match" : "Unmatch";
  }

  function markReceivedNow() {
    setHeader((h) => ({ ...h, receivedDate: todayISO(), receivedTime: nowTime() }));
  }

  function copyOrderedToReceived() {
    setLines((ls) => ls.map((l) => ({ ...l, receivedQty: l.orderedQty || "0" })));
    if (editingKey) setDraft((d) => ({ ...d, receivedQty: d.orderedQty || "0" }));
  }

  function validate() {
    const hErr: typeof headerErrors = {};
    if (!header.orderDate) hErr.orderDate = "Order date is required.";
    if (header.receivedTime && !header.receivedDate) hErr.receivedDate = "Enter the date the order was received.";
    Object.assign(hErr, orderPaymentErrors(header));

    const bad = new Set(lines.filter((l) => Object.keys(checkDraft(l)).length > 0).map((l) => l.key));
    // Something typed in the panel but not added (or an edit not applied)
    const editing = lines.find((l) => l.key === editingKey);
    const pending = editing ? JSON.stringify(editing) !== JSON.stringify(draft) : !!draft.itemCode || draft.orderedQty !== "";

    let general: string | undefined;
    if (pending) general = editing ? "Press Update item to keep your changes to the item, or Cancel edit." : "You started an item but didn't add it. Press Add item, or clear it.";
    else if (lines.length === 0) general = "Add at least one item to the order.";
    else if (bad.size) general = "Some items need fixing (highlighted): press Edit on each to add the missing quantity or price.";
    else if (!header.receivedDate && lines.some((l) => toNumber(l.receivedQty) > 0)) {
      hErr.receivedDate = "Received quantities are entered — add the received date.";
    }

    if (billValue === "" || toNumber(billValue) < 0) general = general ?? "Total bill amount must be 0 or more.";
    if (Number.isNaN(Number(discountPercent)) || pct < 0 || pct >= 100) general = general ?? "Invoice discount must be a % from 0 to 99.99.";

    setHeaderErrors(hErr);
    setBadLines(bad);
    setFormError(general);
    return !general && Object.keys(hErr).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const input: OrderInput = { ...header, discountPercent: pct, totalBillAmount: round2(toNumber(billValue)) };
    const lineInputs: OrderLineInput[] = lines.map((l) => ({
      itemCode: l.itemCode,
      orderedQty: toNumber(l.orderedQty),
      receivedQty: toNumber(l.receivedQty),
      unitPrice: toNumber(l.unitPrice),
      discount: toNumber(l.discount),
      remarks: l.remarks,
    }));
    const result = await (order ? updateOrder(order.id, input, lineInputs) : createOrder(input, lineInputs));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(order ? `${order.orderId} updated` : "Order created");
    onSaved(result.id!);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className={cn("grid gap-6", !isNew && "lg:grid-cols-3")}>
        <Card className={cn(!isNew && "lg:col-span-2")}>
          <CardHeader title="Order details" description="Supplier invoice and payment details." />
          <div className={cn("grid gap-4 p-5 sm:grid-cols-2", isNew ? "lg:grid-cols-4" : "xl:grid-cols-3")}>
            <Field label="Order ID">
              <ReadOnlyValue className="font-medium">{order?.orderId ?? nextOrderId(orders)}</ReadOnlyValue>
            </Field>
            <Field label="Invoice Number" htmlFor="invoiceNumber">
              <Input id="invoiceNumber" value={header.invoiceNumber} onChange={setField("invoiceNumber")} placeholder="INV-RG-00000" />
            </Field>
            <Field label="PO Number" htmlFor="poNumber">
              <Input id="poNumber" value={header.poNumber} onChange={setField("poNumber")} placeholder="PO-0000000" />
            </Field>
            <Field label="Order Date" htmlFor="orderDate" required error={headerErrors.orderDate}>
              <Input id="orderDate" type="date" value={header.orderDate} onChange={setField("orderDate")} aria-invalid={!!headerErrors.orderDate} />
            </Field>
            <OrderPaymentFields
              value={paymentOf(header)}
              onChange={(payment) => setHeader((h) => ({ ...h, ...payment }))}
              errors={headerErrors}
              idPrefix="order"
            />
          </div>
        </Card>

        {!isNew && (
          <Card>
            <CardHeader
              title="Delivery"
              description="Fill in when the order arrives at the store."
              actions={
                <Button variant="secondary" size="sm" onClick={markReceivedNow}>
                  <Clock /> Received now
                </Button>
              }
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-1">
              <Field label="Order Received Date" htmlFor="receivedDate" error={headerErrors.receivedDate}>
                <Input
                  id="receivedDate"
                  type="date"
                  value={header.receivedDate}
                  onChange={setField("receivedDate")}
                  aria-invalid={!!headerErrors.receivedDate}
                />
              </Field>
              <Field label="Order Received Time" htmlFor="receivedTime">
                <Input id="receivedTime" type="time" value={header.receivedTime} onChange={setField("receivedTime")} />
              </Field>
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Order items
              {lines.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums">{lines.length}</span>}
            </span>
          }
          description={
            isNew
              ? "Add items one at a time in the box below; they're listed underneath. When the goods arrive, use Receive order on the order page."
              : "Add items one at a time in the box below; they're listed underneath. Match / Unmatch is worked out once a received date is entered."
          }
          actions={
            !isNew && (
              <Button variant="outline" size="sm" onClick={copyOrderedToReceived} disabled={lines.length === 0}>
                <ClipboardCheck /> Received = Ordered
              </Button>
            )
          }
        />

        <div
          id="orderDraftPanel"
          onKeyDown={onPanelKeyDown}
          className={cn("scroll-mt-20 border-b border-slate-200 p-5", editingKey ? "bg-amber-50/60" : "bg-slate-50/70")}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">
              {editingKey ? `Edit item ${editingIndex + 1}${isComplete(draft) ? "" : " · add its quantity"}` : "Add an item"}
            </p>
            {editingKey && (
              <button type="button" onClick={cancelEdit} className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
                Cancel edit
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <Field
              label="Item"
              htmlFor="orderDraftItem"
              required
              error={draftErrors.itemCode}
              className={cn("sm:col-span-2", isNew ? "lg:col-span-4" : "lg:col-span-3")}
              hint={
                draftItem
                  ? `${draftItem.packageDetails ? `${draftItem.packageDetails} · ` : ""}${draftItem.uom}${
                      lastPrice.has(draftItem.sapCode) ? ` · last invoice ${formatMoney(lastPrice.get(draftItem.sapCode)!)}` : " · not on an invoice yet"
                    }`
                  : "Type a code or name to find it"
              }
            >
              <SearchSelect
                id="orderDraftItem"
                value={draft.itemCode}
                onChange={pickDraftItem}
                options={items.map((i) => ({
                  value: i.sapCode,
                  label: i.sapCode,
                  description: i.description,
                  hint: i.packageDetails,
                  disabled: i.sapCode !== draft.itemCode && lines.some((l) => l.itemCode === i.sapCode && l.key !== draft.key),
                }))}
                placeholder="Search item…"
                showDescription
                aria-invalid={!!draftErrors.itemCode}
              />
            </Field>
            <Field label="Ordered Qty" htmlFor="orderDraftQty" required error={draftErrors.orderedQty}>
              <Input
                id="orderDraftQty"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={draft.orderedQty}
                onChange={(e) => setDraftField({ orderedQty: e.target.value })}
                aria-invalid={!!draftErrors.orderedQty}
                className="text-right tabular-nums"
              />
            </Field>
            {!isNew && (
              <Field label="Received Qty" htmlFor="orderDraftReceived" error={draftErrors.receivedQty}>
                <Input
                  id="orderDraftReceived"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.receivedQty}
                  onChange={(e) => setDraftField({ receivedQty: e.target.value })}
                  aria-invalid={!!draftErrors.receivedQty}
                  className="text-right tabular-nums"
                />
              </Field>
            )}
            <Field label="Price (Rs.)" htmlFor="orderDraftPrice" required error={draftErrors.unitPrice}>
              <Input
                id="orderDraftPrice"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft.unitPrice}
                onChange={(e) => setDraftField({ unitPrice: e.target.value })}
                aria-invalid={!!draftErrors.unitPrice}
                className="text-right tabular-nums"
              />
            </Field>
            <Field label="Discount (Rs.)" htmlFor="orderDraftDiscount" error={draftErrors.discount}>
              <Input
                id="orderDraftDiscount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft.discount}
                onChange={(e) => setDraftField({ discount: e.target.value })}
                aria-invalid={!!draftErrors.discount}
                className="text-right tabular-nums"
              />
            </Field>
            <Field label="Remarks" htmlFor="orderDraftRemarks" className="sm:col-span-2 lg:col-span-3">
              <Input id="orderDraftRemarks" value={draft.remarks} onChange={(e) => setDraftField({ remarks: e.target.value })} placeholder="Optional" />
            </Field>
            <div className="flex items-end justify-between gap-3 sm:col-span-2 lg:col-span-2">
              <div className="pb-2">
                <p className="text-xs text-slate-500">Line value</p>
                <p className="text-base font-semibold text-slate-900 tabular-nums">{formatMoney(orderLineValue(numbersOf(draft), header))}</p>
              </div>
              <Button onClick={saveDraft} className="shrink-0">
                {editingKey ? (
                  <>
                    <Pencil /> Update item
                  </>
                ) : (
                  <>
                    <Plus /> Add item
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {formError && <p className="border-b border-red-100 bg-red-50 px-5 py-2.5 text-sm text-red-700">{formError}</p>}
        <Table>
          <THead>
            <tr>
              <TH className="w-10">#</TH>
              <TH>Item</TH>
              <TH className="text-right">Ordered</TH>
              {!isNew && <TH className="text-right">Received</TH>}
              <TH className="text-right">Price</TH>
              <TH className="text-right">Discount</TH>
              <TH className="text-right">Value</TH>
              {!isNew && <TH>Match</TH>}
              <TH>Remarks</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {lines.length === 0 && <EmptyRow colSpan={isNew ? 8 : 10}>No items yet. Add the first one above.</EmptyRow>}
            {lines.map((l, index) => {
              const item = itemMap.get(l.itemCode);
              const complete = isComplete(l);
              return (
                <TR
                  key={l.key}
                  className={cn(l.key === editingKey ? "bg-amber-50/70" : badLines.has(l.key) ? "bg-red-50/60" : undefined)}
                >
                  <TD className="text-slate-400 tabular-nums">{index + 1}</TD>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{item?.description ?? "Unknown item"}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {l.itemCode}
                      {item ? ` · ${item.packageDetails ? `${item.packageDetails} · ` : ""}${item.uom}` : ""}
                    </span>
                  </TD>
                  <TD className="text-right font-semibold text-slate-900 tabular-nums">
                    {complete ? formatQty(toNumber(l.orderedQty)) : <span className="text-xs font-medium text-amber-700">Add qty</span>}
                  </TD>
                  {!isNew && <TD className="text-right tabular-nums">{formatQty(toNumber(l.receivedQty))}</TD>}
                  <TD className="text-right tabular-nums">{l.unitPrice === "" ? "—" : formatMoney(toNumber(l.unitPrice))}</TD>
                  <TD className="text-right tabular-nums">{toNumber(l.discount) ? formatMoney(toNumber(l.discount)) : "—"}</TD>
                  <TD className="text-right font-medium text-slate-900 tabular-nums">{formatMoney(orderLineValue(numbersOf(l), header))}</TD>
                  {!isNew && (
                    <TD>
                      <LineStatusBadge status={lineStatus(l)} />
                    </TD>
                  )}
                  <TD className="max-w-56 whitespace-normal text-slate-600">{l.remarks || <span className="text-slate-400">—</span>}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => editLine(l)} aria-label={`Edit item ${index + 1}`} title="Edit">
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeLine(l.key)}
                        aria-label={`Remove item ${index + 1}`}
                        title="Remove"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Card>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <Field label="Total Item Quantity" hint={isNew ? undefined : `${formatQty(totalReceived)} received`}>
            <ReadOnlyValue className="font-semibold tabular-nums">{formatQty(totalOrdered)}</ReadOnlyValue>
          </Field>
          <Field
            label="Discount % for Total Invoice"
            htmlFor="discountPercent"
            hint={invoiceOff ? `${formatMoney(invoiceOff)} off the lines total` : "On the last page of the invoice"}
          >
            <Input
              id="discountPercent"
              type="number"
              min={0}
              max={99.99}
              step="0.01"
              inputMode="decimal"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              placeholder="0"
              className="text-right tabular-nums"
            />
          </Field>
          <Field label="Calculated value" hint={`Qty × price − discount, all lines${pct ? `, less ${pct}%` : ""}`}>
            <ReadOnlyValue className="tabular-nums">{formatMoney(calculated)}</ReadOnlyValue>
          </Field>
          <Field
            label="Total Bill Amount (Rs.)"
            htmlFor="totalBill"
            required
            hint={
              billInput === null ? (
                "Following calculated value — type to enter the invoice amount."
              ) : (
                <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setBillInput(null)}>
                  Use calculated value
                </button>
              )
            }
          >
            <Input
              id="totalBill"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={billValue}
              onChange={(e) => setBillInput(e.target.value)}
              className="font-semibold tabular-nums"
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:justify-end lg:pb-5">
            <Link href={cancelHref} className={buttonClass("outline", "md", "flex-1 lg:flex-none")}>
              Cancel
            </Link>
            <Button type="submit" className="flex-1 lg:flex-none">
              {order ? "Save changes" : "Create order"}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
