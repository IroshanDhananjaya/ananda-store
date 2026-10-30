"use client";

import { ClipboardCheck, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LineStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, toNumber } from "@/components/ui/form";
import { FilterTabs, SearchInput } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";
import { StackBox } from "@/components/ui/table";
import { useAppStore, useItemMap, useItemPickOptions, useLastInvoicePrices } from "@/lib/store";
import type { Order, OrderInvoice, OrderInvoiceInput, OrderItem, ReceiveOrderInput } from "@/lib/types";
import {
  cn,
  formatMoney,
  formatQty,
  includesText,
  invoiceDiscount,
  invoiceTotals,
  lineStatus,
  newId,
  nowTime,
  orderLineValue,
  round2,
  todayISO,
} from "@/lib/utils";

/** The Raigam companies that bill us, offered in an invoice's Company box */
const RAIGAM_COMPANIES = ["Raigam Marketing Services (Pvt) Ltd", "Raigam Wayamba Salterns PLC", "Raigam Eastern Salt Company (Pvt) Ltd"];

const isWhole = (v: string) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;
const isPrice = (v: string) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
const isPercent = (v: string) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 100);

/** Focus a field once React has drawn it */
const focusField = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

// ---------- Raigam invoices: an order's goods can come on several, each with its own discount ----------

/** An invoice as typed (`key` = its id, or a new key until saved) */
type InvoiceDraft = { key: string; invoiceNumber: string; poNumber: string; company: string; invoiceDate: string; discountPercent: string };

const draftOf = (i: OrderInvoice): InvoiceDraft => ({
  key: i.id,
  invoiceNumber: i.invoiceNumber,
  poNumber: i.poNumber,
  company: i.company,
  invoiceDate: i.invoiceDate,
  discountPercent: i.discountPercent ? String(i.discountPercent) : "",
});
const blankInvoice = (date: string): InvoiceDraft => ({ key: `new-${newId()}`, invoiceNumber: "", poNumber: "", company: "", invoiceDate: date, discountPercent: "" });
const invoiceInput = (d: InvoiceDraft): OrderInvoiceInput => ({
  invoiceNumber: d.invoiceNumber,
  poNumber: d.poNumber,
  company: d.company,
  invoiceDate: d.invoiceDate,
  discountPercent: toNumber(d.discountPercent),
});

/** "Invoice 131632", or its place in the list until it has a number */
export const invoiceName = (i: Pick<OrderInvoice, "invoiceNumber">, n: number) =>
  i.invoiceNumber.trim() ? `Invoice ${i.invoiceNumber.trim()}` : `Invoice ${n + 1} (no number yet)`;

/** Number, company, PO, date and discount % of one invoice */
function InvoiceFields({
  value,
  onChange,
  idPrefix,
  autoFocus,
  disabled,
}: {
  value: InvoiceDraft;
  onChange: (patch: Partial<InvoiceDraft>) => void;
  idPrefix: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const used = useAppStore((s) => s.orderInvoices).map((i) => i.company);
  const companies = [...new Set([...RAIGAM_COMPANIES, ...used.filter(Boolean)])];
  return (
    <>
      <Field label="Invoice Number" htmlFor={`${idPrefix}No`}>
        <Input
          id={`${idPrefix}No`}
          value={value.invoiceNumber}
          onChange={(e) => onChange({ invoiceNumber: e.target.value })}
          placeholder="e.g. 131632"
          autoComplete="off"
          autoFocus={autoFocus}
        />
      </Field>
      <Field label="Company" htmlFor={`${idPrefix}Company`}>
        <Input
          id={`${idPrefix}Company`}
          list={`${idPrefix}Companies`}
          value={value.company}
          onChange={(e) => onChange({ company: e.target.value })}
          placeholder="Raigam Marketing Services…"
          autoComplete="off"
        />
        <datalist id={`${idPrefix}Companies`}>
          {companies.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="PO Number" htmlFor={`${idPrefix}Po`}>
        <Input id={`${idPrefix}Po`} value={value.poNumber} onChange={(e) => onChange({ poNumber: e.target.value })} placeholder="e.g. 26102704" autoComplete="off" />
      </Field>
      <Field label="Invoice Date" htmlFor={`${idPrefix}Date`}>
        <Input id={`${idPrefix}Date`} type="date" value={value.invoiceDate} onChange={(e) => onChange({ invoiceDate: e.target.value })} />
      </Field>
      <Field
        label="Discount % for Total Invoice"
        htmlFor={`${idPrefix}Pct`}
        error={isPercent(value.discountPercent) ? undefined : "A % from 0 to 99.99."}
        hint={disabled ? "Items on it are in stock" : undefined}
      >
        <Input
          id={`${idPrefix}Pct`}
          type="number"
          min={0}
          max={99.99}
          step="0.01"
          inputMode="decimal"
          value={value.discountPercent}
          onChange={(e) => onChange({ discountPercent: e.target.value })}
          placeholder="0"
          className="text-right tabular-nums"
          aria-invalid={!isPercent(value.discountPercent)}
        />
      </Field>
    </>
  );
}

/** "54 items · Rs 1,373,782.25 − 10.5% (Rs 144,247.14) = Rs 1,229,535.11" */
function InvoiceSum({ items, linesTotal, percent, className }: { items: number; linesTotal: number; percent: number; className?: string }) {
  const { discount, total } = invoiceDiscount(linesTotal, percent);
  return (
    <p className={cn("text-sm text-slate-600 tabular-nums", className)}>
      {items} item{items === 1 ? "" : "s"} · {formatMoney(linesTotal)}
      {percent > 0 && (
        <>
          {" "}
          − {percent}% ({formatMoney(discount)})
        </>
      )}{" "}
      = <span className="font-semibold text-slate-900">{formatMoney(total)}</span>
    </p>
  );
}

function InvoiceForm({ order, invoice, lines, onDone }: { order: Order; invoice: OrderInvoice | null; lines: OrderItem[]; onDone: () => void }) {
  const saveOrderInvoice = useAppStore((s) => s.saveOrderInvoice);
  const [draft, setDraft] = useState<InvoiceDraft>(() => (invoice ? draftOf(invoice) : blankInvoice(order.receivedDate || todayISO())));
  const [error, setError] = useState<string>();
  const on = invoice ? invoiceTotals(invoice, lines) : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isPercent(draft.discountPercent)) return setError("The discount must be a % from 0 to 99.99.");
    const result = await saveOrderInvoice(order.id, invoice?.id ?? null, invoiceInput(draft));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const name = draft.invoiceNumber.trim() ? `Invoice ${draft.invoiceNumber.trim()}` : "The invoice";
    toast.success(invoice ? `${name} saved` : `${name} added to ${order.orderId}`);
    onDone();
  }

  return (
    <form id="order-invoice-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <InvoiceFields
        value={draft}
        onChange={(patch) => {
          setDraft((d) => ({ ...d, ...patch }));
          setError(undefined);
        }}
        idPrefix="orderInvoice"
        autoFocus
      />
      {on && on.lines.length > 0 ? (
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 sm:col-span-2">
          <InvoiceSum items={on.lines.length} linesTotal={on.linesTotal} percent={toNumber(draft.discountPercent)} />
        </div>
      ) : (
        <p className="text-xs text-slate-500 sm:col-span-2">Put the items that came on it with Receive order on the order page.</p>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
    </form>
  );
}

/** Add a Raigam invoice to an order, or change one (also once the goods are in stock) */
export function OrderInvoiceDialog({
  order,
  invoice,
  lines,
  open,
  onClose,
}: {
  order: Order;
  /** null = add a new one */
  invoice: OrderInvoice | null;
  lines: OrderItem[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={invoice ? `Edit ${invoiceName(invoice, 0)}` : `Add a Raigam invoice to ${order.orderId}`}
      description="Number, company, PO and the invoice's own discount %, as printed on it."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="order-invoice-form">
            {invoice ? "Save invoice" : "Add invoice"}
          </Button>
        </>
      }
    >
      {/* Modal mounts this only while open, so it starts from the saved invoice each time */}
      <InvoiceForm order={order} invoice={invoice} lines={lines} onDone={onClose} />
    </Modal>
  );
}

// ---------- Receive order: when it came, the invoices it came on, and what arrived ----------

type ReceiveRow = {
  key: string;
  /** The order line; "" = an item added here that wasn't ordered */
  id: string;
  itemCode: string;
  orderedQty: number;
  /** The invoice's key; "" = Missing (on no invoice) */
  invoiceKey: string;
  invoicedQty: string;
  receivedQty: string;
  unitPrice: string;
  discount: number;
  remarks: string;
  /** Already in stock: it can't change */
  inStock: boolean;
};

/** Rows shown: everything, one invoice's items, or the missing ones */
type RowFilter = "all" | "missing" | `inv:${string}`;

function ReceiveForm({ order, lines, onDone }: { order: Order; lines: OrderItem[]; onDone: () => void }) {
  const orderInvoices = useAppStore((s) => s.orderInvoices);
  const receiveOrder = useAppStore((s) => s.receiveOrder);
  const itemMap = useItemMap();
  const pickOptions = useItemPickOptions();
  const lastPrice = useLastInvoicePrices();

  const [start] = useState(() => {
    const saved = orderInvoices.filter((i) => i.orderId === order.orderId).map(draftOf);
    const invoices = saved.length ? saved : [blankInvoice(order.receivedDate || todayISO())];
    // First time: everything ordered came on the first invoice; after that, as saved
    const firstTime = !order.receivedDate;
    const rows = lines.map((l): ReceiveRow => {
      const invoiceKey = firstTime ? invoices[0].key : l.invoiceId;
      const price = l.unitPrice > 0 || !firstTime ? l.unitPrice : lastPrice.get(l.itemCode);
      return {
        key: l.id,
        id: l.id,
        itemCode: l.itemCode,
        orderedQty: l.orderedQty,
        invoiceKey,
        invoicedQty: String(invoiceKey ? (firstTime ? l.orderedQty : l.invoicedQty) : 0),
        receivedQty: String(firstTime ? l.orderedQty : l.receivedQty),
        unitPrice: price === undefined ? "" : String(price),
        discount: l.discount,
        remarks: l.remarks,
        inStock: !!l.postedLocation,
      };
    });
    return { invoices, rows };
  });
  const [date, setDate] = useState(order.receivedDate || todayISO());
  const [time, setTime] = useState(order.receivedTime || nowTime());
  const [invoices, setInvoices] = useState<InvoiceDraft[]>(start.invoices);
  const [rows, setRows] = useState<ReceiveRow[]>(start.rows);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<RowFilter>("all");
  const [error, setError] = useState<string>();

  const valueOf = (r: ReceiveRow) => (r.invoiceKey ? round2(toNumber(r.invoicedQty) * toNumber(r.unitPrice) - r.discount) : 0);
  const rowsOn = (key: string) => rows.filter((r) => r.invoiceKey === key);
  const sumOf = (key: string) => round2(rowsOn(key).reduce((sum, r) => sum + valueOf(r), 0));
  const billTotal = round2(invoices.reduce((sum, i) => sum + invoiceDiscount(sumOf(i.key), toNumber(i.discountPercent)).total, 0));
  const missing = rows.filter((r) => !r.invoiceKey);
  const visible = rows.filter(
    (r) =>
      (show === "all" || (show === "missing" ? !r.invoiceKey : `inv:${r.invoiceKey}` === show)) &&
      includesText([r.itemCode, itemMap.get(r.itemCode)?.description], query),
  );

  function update(key: string, patch: Partial<ReceiveRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setError(undefined);
  }

  function chooseInvoice(r: ReceiveRow, invoiceKey: string) {
    // Missing: nothing on an invoice, nothing came
    if (!invoiceKey) return update(r.key, { invoiceKey, invoicedQty: "0", receivedQty: "0" });
    // Back on an invoice: as ordered, all of it came
    if (!r.invoiceKey) {
      const qty = String(r.orderedQty || toNumber(r.receivedQty) || "");
      return update(r.key, { invoiceKey, invoicedQty: qty, receivedQty: qty });
    }
    update(r.key, { invoiceKey });
  }

  // What arrived follows the qty on the invoice until it's typed differently
  const changeInvoiced = (r: ReceiveRow, value: string) =>
    update(r.key, { invoicedQty: value, receivedQty: r.receivedQty === r.invoicedQty ? value : r.receivedQty });

  function changeInvoice(key: string, patch: Partial<InvoiceDraft>) {
    setInvoices((is) => is.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setError(undefined);
  }

  function addInvoice() {
    const invoice = blankInvoice(invoices.at(-1)?.invoiceDate || date);
    setInvoices((is) => [...is, invoice]);
    focusField(`inv-${invoice.key}No`);
  }

  // Its items become Missing until they're put on another invoice
  function removeInvoice(key: string) {
    setInvoices((is) => is.filter((i) => i.key !== key));
    setRows((rs) => rs.map((r) => (r.invoiceKey === key ? { ...r, invoiceKey: "", invoicedQty: "0", receivedQty: "0" } : r)));
    if (show === `inv:${key}`) setShow("all");
  }

  // An item on an invoice that wasn't on the order
  function addItem(itemCode: string) {
    if (!itemCode || rows.some((r) => r.itemCode === itemCode)) return;
    const key = `new-${newId()}`;
    const invoiceKey = show.startsWith("inv:") ? show.slice(4) : (invoices[0]?.key ?? "");
    const price = lastPrice.get(itemCode);
    setRows((rs) => [
      ...rs,
      { key, id: "", itemCode, orderedQty: 0, invoiceKey, invoicedQty: "", receivedQty: "", unitPrice: price === undefined ? "" : String(price), discount: 0, remarks: "", inStock: false },
    ]);
    setQuery("");
    focusField(`rcvQty-${key}`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date) return setError("Enter the received date.");
    const badPct = invoices.findIndex((i) => !isPercent(i.discountPercent));
    if (badPct >= 0) return setError(`${invoiceName(invoices[badPct], badPct)}: the discount must be a % from 0 to 99.99.`);
    for (const r of rows) {
      const name = itemMap.get(r.itemCode)?.description ?? r.itemCode;
      if (r.invoiceKey && (!isWhole(r.invoicedQty) || toNumber(r.invoicedQty) === 0)) return setError(`Enter the qty on the invoice for ${name}, or mark it Missing.`);
      if (!isWhole(r.receivedQty)) return setError(`What came of ${name} must be a whole number (0 or more).`);
      if (r.invoiceKey && !isPrice(r.unitPrice)) return setError(`Enter the price of ${name} as on its invoice.`);
      if (!r.orderedQty && !r.invoiceKey && toNumber(r.receivedQty) === 0) return setError(`${name} wasn't ordered: put it on an invoice, or take it off.`);
    }

    const input: ReceiveOrderInput = {
      receivedDate: date,
      receivedTime: time,
      invoices: invoices.map((i) => ({ key: i.key, ...invoiceInput(i) })),
      lines: rows.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        itemCode: r.itemCode,
        invoiceKey: r.invoiceKey,
        invoicedQty: r.invoiceKey ? toNumber(r.invoicedQty) : 0,
        receivedQty: toNumber(r.receivedQty),
        unitPrice: toNumber(r.unitPrice),
        discount: r.discount,
        remarks: r.remarks,
      })),
    };
    const result = await receiveOrder(order.id, input);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const nothing = rows.filter((r) => r.orderedQty > 0 && toNumber(r.receivedQty) === 0).length;
    const extra = rows.filter((r) => !r.orderedQty).length;
    toast.success(
      [
        `${order.orderId} received on ${invoices.length} invoice${invoices.length === 1 ? "" : "s"} · ${formatMoney(billTotal)}`,
        nothing ? `${nothing} missing` : "",
        extra ? `${extra} not ordered` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    onDone();
  }

  return (
    <form id="receive-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Order Received Date" htmlFor="rcvDate" required>
          <Input id="rcvDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Order Received Time" htmlFor="rcvTime">
          <Input id="rcvTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Raigam invoices ({invoices.length})</h3>
            <p className="text-xs text-slate-500">One order can come on several invoices, each with its own discount %.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={addInvoice}>
            <Plus /> Add invoice
          </Button>
        </div>
        {invoices.map((inv, n) => {
          const on = rowsOn(inv.key);
          const locked = on.some((r) => r.inStock);
          return (
            <div key={inv.key} className="rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
                <p className="text-sm font-medium text-slate-700">{invoiceName(inv, n)}</p>
                <div className="flex items-center gap-2">
                  <InvoiceSum items={on.length} linesTotal={sumOf(inv.key)} percent={toNumber(inv.discountPercent)} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeInvoice(inv.key)}
                    disabled={locked}
                    aria-label={`Remove ${invoiceName(inv, n)}`}
                    title={locked ? "Items on it are in stock" : "Remove (its items become Missing)"}
                  >
                    <X />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
                <InvoiceFields value={inv} onChange={(patch) => changeInvoice(inv.key, patch)} idPrefix={`inv-${inv.key}`} disabled={locked} />
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">What came</h3>
            <p className="text-xs text-slate-500">
              Pick the invoice each item came on, or Missing if it didn&apos;t come. Received = what you counted (it goes into stock).
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRows((rs) => rs.map((r) => (r.inStock ? r : { ...r, receivedQty: r.invoiceKey ? r.invoicedQty : "0" })))}
          >
            <ClipboardCheck /> Received = on invoice
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput placeholder="Find an item" value={query} onChange={(e) => setQuery(e.target.value)} />
          <FilterTabs<RowFilter>
            value={show}
            onChange={setShow}
            options={[
              { value: "all", label: "All", count: rows.length },
              ...invoices.map((i, n) => ({ value: `inv:${i.key}` as const, label: i.invoiceNumber.trim() || `Invoice ${n + 1}`, count: rowsOn(i.key).length })),
              { value: "missing", label: "Missing", count: missing.length },
            ]}
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <StackBox>
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="w-44 px-3 py-2">Invoice</th>
                  <th className="w-24 px-3 py-2 text-right">On invoice</th>
                  <th className="w-24 px-3 py-2 text-right">Received</th>
                  <th className="w-28 px-3 py-2 text-right">Price (Rs.)</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Remarks</th>
                  <th className="w-10 px-1 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                      No items here.
                    </td>
                  </tr>
                )}
                {visible.map((r) => {
                  const status = lineStatus({ orderedQty: r.orderedQty, receivedQty: toNumber(r.receivedQty) }, { receivedDate: date });
                  const short = r.invoiceKey && toNumber(r.receivedQty) < toNumber(r.invoicedQty);
                  return (
                    <tr key={r.key} className={cn(!r.invoiceKey && "bg-red-50/40", r.inStock && "opacity-70")}>
                      <td className="px-3 py-2">
                        <span className="block font-medium text-slate-900">{itemMap.get(r.itemCode)?.description ?? r.itemCode}</span>
                        <span className="font-mono text-xs text-slate-500">{r.itemCode}</span>
                        {r.inStock && <span className="ml-2 text-xs font-medium text-emerald-700">In stock</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.orderedQty ? formatQty(r.orderedQty) : "—"}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={r.invoiceKey}
                          onChange={(e) => chooseInvoice(r, e.target.value)}
                          disabled={r.inStock}
                          className={cn("h-9", !r.invoiceKey && "text-red-700")}
                          aria-label={`Invoice ${r.itemCode} came on`}
                        >
                          {invoices.map((i, n) => (
                            <option key={i.key} value={i.key}>
                              {i.invoiceNumber.trim() || `Invoice ${n + 1}`}
                            </option>
                          ))}
                          <option value="">Missing (didn&apos;t come)</option>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          id={`rcvQty-${r.key}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={r.invoiceKey ? r.invoicedQty : ""}
                          placeholder={r.invoiceKey ? "" : "—"}
                          onChange={(e) => changeInvoiced(r, e.target.value)}
                          disabled={!r.invoiceKey || r.inStock}
                          className="h-9 text-right tabular-nums"
                          aria-label={`Qty of ${r.itemCode} on the invoice`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={r.receivedQty}
                          onChange={(e) => update(r.key, { receivedQty: e.target.value })}
                          disabled={r.inStock}
                          className={cn("h-9 text-right tabular-nums", short && "border-amber-400")}
                          aria-label={`Received quantity of ${r.itemCode}`}
                        />
                        {short && <span className="mt-1 block text-right text-xs text-amber-700">{formatQty(toNumber(r.invoicedQty) - toNumber(r.receivedQty))} short</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={r.unitPrice}
                          onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                          disabled={!r.invoiceKey || r.inStock}
                          className="h-9 text-right tabular-nums"
                          aria-label={`Price of ${r.itemCode} on the invoice`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-900 tabular-nums">
                        {r.invoiceKey ? formatMoney(valueOf(r)) : "—"}
                        {r.discount > 0 && r.invoiceKey && <span className="block text-xs font-normal text-slate-500">less {formatMoney(r.discount)}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <LineStatusBadge status={status} />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={r.remarks}
                          onChange={(e) => update(r.key, { remarks: e.target.value })}
                          placeholder="e.g. 2 damaged"
                          className="h-9 min-w-32"
                          aria-label={`Remarks for ${r.itemCode}`}
                        />
                      </td>
                      <td className="px-1 py-2">
                        {!r.orderedQty && !r.inStock && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-red-50 hover:text-red-600"
                            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            aria-label={`Take ${r.itemCode} off`}
                            title="Take off (it wasn't ordered)"
                          >
                            <X />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </StackBox>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Field label="An item on an invoice that wasn't ordered?" className="sm:w-96">
            <SearchSelect
              value=""
              onChange={addItem}
              options={pickOptions.map((o) => ({ ...o, disabled: rows.some((r) => r.itemCode === o.value) }))}
              placeholder="Find the item to add…"
              aria-label="Add an item that wasn't ordered"
            />
          </Field>
          <div className="rounded-lg bg-slate-50 px-4 py-2.5 text-sm sm:text-right">
            <span className="text-slate-500">
              Bill total ({invoices.length} invoice{invoices.length === 1 ? "" : "s"}){missing.length ? ` · ${missing.length} missing` : ""}
            </span>
            <span className="block text-base font-semibold text-slate-900 tabular-nums">{formatMoney(billTotal)}</span>
          </div>
        </div>
      </section>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

export function ReceiveOrderDialog({
  order,
  lines,
  open,
  onClose,
}: {
  order: Order;
  lines: OrderItem[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Receive ${order.orderId}`}
      description="When the goods came, the Raigam invoices they came on, and how much of each item arrived."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="receive-form">
            Save delivery
          </Button>
        </>
      }
    >
      <ReceiveForm order={order} lines={lines} onDone={onClose} />
    </Modal>
  );
}

// ---------- Post to stock: check the invoice prices, add received items to Store Details (all, or a few at a time) ----------

function PostForm({ order, lines, only, onDone }: { order: Order; lines: OrderItem[]; only?: string[]; onDone: () => void }) {
  const stock = useAppStore((s) => s.stock);
  const locations = useAppStore((s) => s.locations);
  const orderInvoices = useAppStore((s) => s.orderInvoices);
  const postOrderToStock = useAppStore((s) => s.postOrderToStock);
  const itemMap = useItemMap();
  const lastPrice = useLastInvoicePrices();
  const invoices = orderInvoices.filter((i) => i.orderId === order.orderId);
  const invoiceOf = new Map(invoices.map((i, n) => [i.id, { invoice: i, n }]));
  const postable = lines.filter((l) => l.receivedQty > 0 && !l.postedLocation);
  const inStock = lines.filter((l) => l.postedLocation).length;

  // Default each item to its stock location, else to where it is already stored, if anywhere
  const [locationByLine, setLocationByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      postable.map((l) => [l.id, itemMap.get(l.itemCode)?.locationNumber || (stock.find((r) => r.sapCode === l.itemCode)?.locationNumber ?? "")]),
    ),
  );
  // Price on Raigam's invoice: starts at the saved price (an item on no invoice with none starts at its last invoice price)
  const [priceByLine, setPriceByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      postable.map((l) => [l.id, l.unitPrice > 0 || l.invoiceId ? String(l.unitPrice) : String(lastPrice.get(l.itemCode) ?? "")]),
    ),
  );
  // Everything at once, or the items picked (one by one)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(only?.length ? only : postable.map((l) => l.id)));
  const [bulkLocation, setBulkLocation] = useState("");
  const [error, setError] = useState<string>();

  const chosen = postable.filter((l) => ticked.has(l.id));
  const priceOf = (l: OrderItem) => (ticked.has(l.id) && l.id in priceByLine ? round2(toNumber(priceByLine[l.id])) : l.unitPrice);
  const repriced = (l: OrderItem) => ticked.has(l.id) && isPrice(priceByLine[l.id] ?? "") && priceOf(l) !== l.unitPrice;
  // Worked out the way the order page does: qty on the invoice × price − line discount, less that invoice's discount
  const valueOf = (l: OrderItem) => orderLineValue({ ...l, unitPrice: priceOf(l) }, order);
  const priced = lines.map((l) => ({ ...l, unitPrice: priceOf(l) }));
  const perInvoice = invoices.map((i) => ({ invoice: i, ...invoiceTotals(i, priced) }));
  const total = round2(perInvoice.reduce((sum, x) => sum + x.total, 0));
  const difference = round2(total - order.totalBillAmount);

  function tick(lineId: string, on: boolean) {
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
    setError(undefined);
  }

  function setAllLocations(loc: string) {
    setBulkLocation(loc);
    if (loc) setLocationByLine((m) => ({ ...m, ...Object.fromEntries(chosen.map((l) => [l.id, loc])) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (chosen.length === 0) return setError("Tick at least one item to add to stock.");
    const name = (l: OrderItem) => itemMap.get(l.itemCode)?.description ?? l.itemCode;
    const unpriced = chosen.find((l) => !isPrice(priceByLine[l.id] ?? ""));
    if (unpriced) return setError(`Enter the price of ${name(unpriced)} (0 or more).`);
    const unplaced = chosen.find((l) => !locationByLine[l.id]);
    if (unplaced) return setError(`Choose a store location for ${name(unplaced)}.`);
    const result = await postOrderToStock(
      order.id,
      Object.fromEntries(chosen.map((l) => [l.id, locationByLine[l.id]])),
      Object.fromEntries(chosen.map((l) => [l.id, priceOf(l)])),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const units = chosen.reduce((s, l) => s + l.receivedQty, 0);
    const left = postable.length - chosen.length;
    toast.success(
      `${formatQty(units)} units of ${chosen.length} item${chosen.length === 1 ? "" : "s"} from ${order.orderId} added to stock` +
        (left ? ` · ${left} still to add` : ` · bill ${formatMoney(total)}`),
    );
    onDone();
  }

  return (
    <form id="post-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      {postable.length === 0 ? (
        <p className="text-sm text-slate-600">
          {inStock ? "Everything received on this order is already in stock." : "Nothing was received on this order, so there is nothing to add to stock."}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-900">
                {chosen.length} of {postable.length}
              </span>{" "}
              items ticked{inStock ? ` · ${inStock} already in stock` : ""}. Untick any you&apos;ll add later.
            </p>
            <Select value={bulkLocation} onChange={(e) => setAllLocations(e.target.value)} className="h-9 sm:w-64" aria-label="Store location for all ticked items">
              <option value="">Same location for all ticked…</option>
              {locations.map((x) => (
                <option key={x.id} value={x.locationNumber}>
                  {x.locationNumber} · {x.itemGroup}
                </option>
              ))}
            </Select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <StackBox>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer rounded accent-brand-600"
                        checked={chosen.length === postable.length}
                        onChange={(e) => setTicked(new Set(e.target.checked ? postable.map((l) => l.id) : []))}
                        aria-label="Tick all items"
                      />
                    </th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="w-36 px-3 py-2 text-right">Unit price (Rs.)</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">In stock now</th>
                    <th className="px-3 py-2">Store Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {postable.map((l) => {
                    const on = ticked.has(l.id);
                    const loc = locationByLine[l.id];
                    const current = stock.find((r) => r.sapCode === l.itemCode && r.locationNumber === loc)?.availableQty ?? 0;
                    const changed = repriced(l);
                    const inv = invoiceOf.get(l.invoiceId);
                    return (
                      <tr key={l.id} className={cn(!on && "bg-slate-50/60 text-slate-400", changed && "bg-amber-50/50")}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer rounded accent-brand-600"
                            checked={on}
                            onChange={(e) => tick(l.id, e.target.checked)}
                            aria-label={`Add ${l.itemCode} now`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn("block font-medium", on ? "text-slate-900" : "text-slate-500")}>{itemMap.get(l.itemCode)?.description ?? l.itemCode}</span>
                          <span className="font-mono text-xs text-slate-500">{l.itemCode}</span>
                          <span className="ml-2 text-xs text-slate-500">{inv ? invoiceName(inv.invoice, inv.n) : "On no invoice"}</span>
                        </td>
                        <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", on ? "text-emerald-700" : "text-slate-400")}>+{formatQty(l.receivedQty)}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={priceByLine[l.id] ?? ""}
                            onChange={(e) => {
                              setPriceByLine((m) => ({ ...m, [l.id]: e.target.value }));
                              setError(undefined);
                            }}
                            disabled={!on}
                            className={cn("h-9 text-right tabular-nums", changed && "border-amber-400")}
                            aria-label={`Unit price of ${l.itemCode}`}
                            aria-invalid={on && !isPrice(priceByLine[l.id] ?? "")}
                          />
                          {changed && (
                            <span className="mt-1 block text-right text-xs text-amber-700">
                              {l.unitPrice > 0 ? `was ${formatMoney(l.unitPrice)}` : "no price before"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {formatMoney(valueOf(l))}
                          {l.discount > 0 && <span className="block text-xs font-normal text-slate-500">less {formatMoney(l.discount)}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {loc ? `${formatQty(current)} → ${formatQty(current + (on ? l.receivedQty : 0))}` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={loc}
                            onChange={(e) => setLocationByLine((m) => ({ ...m, [l.id]: e.target.value }))}
                            disabled={!on}
                            className="h-9 min-w-44"
                            aria-label={`Store location for ${l.itemCode}`}
                            aria-invalid={on && !loc}
                          >
                            <option value="">Select location…</option>
                            {locations.map((x) => (
                              <option key={x.id} value={x.locationNumber}>
                                {x.locationNumber} · {x.itemGroup}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </StackBox>
          </div>
        </>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <p className="text-xs text-slate-500 lg:max-w-xs">
          Change a price if Raigam&apos;s invoice differs. The prices are saved on the order and become each item&apos;s cost price (less its invoice&apos;s
          discount). Items in stock are locked; reverse the posting if something was entered wrongly.
        </p>
        {postable.length > 0 && (
          <div className="w-full overflow-x-auto rounded-lg border border-slate-200 lg:w-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2 text-right">Items total</th>
                  <th className="px-3 py-2 text-right">Discount</th>
                  <th className="px-3 py-2 text-right">Grand total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {perInvoice.map(({ invoice, linesTotal, discount, total: grand }, n) => (
                  <tr key={invoice.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">{invoiceName(invoice, n)}</td>
                    <td className="px-3 py-1.5 text-right">{formatMoney(linesTotal)}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{invoice.discountPercent ? `${invoice.discountPercent}% · ${formatMoney(discount)}` : "—"}</td>
                    <td className="px-3 py-1.5 text-right">{formatMoney(grand)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50/60">
                  <td className="px-3 py-1.5 text-slate-500" colSpan={3}>
                    Total added before
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-700">{formatMoney(order.totalBillAmount)}</td>
                </tr>
                <tr className="bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-900" colSpan={3}>
                    New total
                    {difference !== 0 && (
                      <span className="ml-2 text-xs font-medium text-amber-700">
                        {difference > 0 ? "+" : "−"} {formatMoney(Math.abs(difference))} from before
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatMoney(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </form>
  );
}

export function PostToStockDialog({
  order,
  lines,
  only,
  open,
  onClose,
}: {
  order: Order;
  lines: OrderItem[];
  /** Start with just these items ticked (one item's "Add to stock"); left out = all */
  only?: string[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Add ${order.orderId} to stock`}
      description="Tick the items going into stock now (all at once, or one by one) and check each price against Raigam's invoice."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="post-form" disabled={!lines.some((l) => l.receivedQty > 0 && !l.postedLocation)}>
            Add to stock
          </Button>
        </>
      }
    >
      <PostForm key={only?.join() ?? "all"} order={order} lines={lines} only={only} onDone={onClose} />
    </Modal>
  );
}
