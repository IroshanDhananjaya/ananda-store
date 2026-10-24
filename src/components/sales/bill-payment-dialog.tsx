"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, toNumber } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { PAYMENT_METHODS, type BillPaymentInput, type PaymentMethod } from "@/lib/types";
import { cn, formatDate, formatMoney, round2, todayISO } from "@/lib/utils";

// One payment for one shop bill. A bill can have many, from when it's created (paid with the
// order / in advance) to after delivery. Payments covering several bills go on the Payments page.

function BillPaymentForm({
  left,
  balanceLabel,
  onSave,
  onDone,
}: {
  left: number;
  balanceLabel: string;
  /** Save the payment; returns an error message, or null when saved */
  onSave: (payment: BillPaymentInput) => Promise<string | null> | string | null;
  onDone: () => void;
}) {
  const [date, setDate] = useState(todayISO);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [amount, setAmount] = useState(() => (left > 0 ? String(left) : ""));
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string>();
  const value = round2(toNumber(amount));
  // What's still owed once this payment is in
  const balance = round2(left - value);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let err: string | null | undefined;
    if (!date) err = "Enter the payment date.";
    else if (!(value > 0)) err = "Enter the amount paid.";
    else if (value > left + 0.004) err = `Only ${formatMoney(left)} is left to pay on this bill.`;
    else if (method === "Cheque" && !chequeNumber.trim()) err = "Enter the cheque number.";
    if (!err) {
      err = await onSave({
        date,
        amount: value,
        method,
        chequeNumber: method === "Cheque" ? chequeNumber.trim() : "",
        chequeDate: method === "Cheque" ? chequeDate : "",
        reference: reference.trim(),
      });
    }
    setError(err ?? undefined);
    if (!err) onDone();
  }

  return (
    <form id="bill-payment-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
        Left to pay on this bill: <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(left)}</span>
      </p>
      <Field label="Method" className="sm:col-span-2">
        <FilterTabs<PaymentMethod> value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
      </Field>
      <Field label="Amount (Rs.)" htmlFor="billPayAmount" required>
        <div className="flex gap-2">
          <Input
            id="billPayAmount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-semibold tabular-nums"
            autoFocus
          />
          <Button variant="secondary" onClick={() => setAmount(String(left))} title="Pay everything that's left">
            All
          </Button>
        </div>
      </Field>
      <Field label="Payment date" htmlFor="billPayDate" required>
        <Input id="billPayDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm sm:col-span-2",
          balance < -0.004 ? "border-red-200 bg-red-50" : balance > 0.004 ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60",
        )}
      >
        <span className="text-slate-700">
          {balance < -0.004 ? "More than what's left to pay" : balance > 0.004 ? `${balanceLabel} after this payment` : "Bill fully paid with this payment"}
        </span>
        <span className={cn("font-semibold tabular-nums", balance < -0.004 ? "text-red-600" : balance > 0.004 ? "text-amber-800" : "text-emerald-700")}>
          {formatMoney(Math.abs(balance))}
        </span>
      </div>
      {method === "Cheque" && (
        <>
          <Field label="Cheque Number" htmlFor="billPayChq" required>
            <Input id="billPayChq" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Cheque Date" htmlFor="billPayChqDate" hint="When it can be banked">
            <Input id="billPayChqDate" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
          </Field>
        </>
      )}
      <Field label={method === "Bank Transfer" ? "Transfer reference" : "Note"} htmlFor="billPayRef" className="sm:col-span-2">
        <Input id="billPayRef" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
    </form>
  );
}

/** Small dialog: add one payment to a shop bill */
export function BillPaymentDialog({
  title,
  description,
  left,
  balanceLabel = "Balance on credit",
  open,
  onClose,
  onSave,
}: {
  title: string;
  description?: string;
  /** What's still to pay on the bill (its balance, or before delivery its total less payments so far) */
  left: number;
  /** What a part payment leaves, e.g. "Balance on credit" (delivered) or "To collect after delivery" */
  balanceLabel?: string;
  open: boolean;
  onClose: () => void;
  onSave: (payment: BillPaymentInput) => Promise<string | null> | string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bill-payment-form">
            Save payment
          </Button>
        </>
      }
    >
      <BillPaymentForm left={left} balanceLabel={balanceLabel} onSave={onSave} onDone={onClose} />
    </Modal>
  );
}

export type BillPaymentRow = BillPaymentInput & { key: string; receiptNo?: string; ofReceipt?: number };

/** A bill's payment records: date, method (cheque no.), note, amount, with optional edit / remove */
export function BillPaymentList({
  rows,
  onEdit,
  onRemove,
  className,
}: {
  rows: BillPaymentRow[];
  onEdit?: (key: string) => void;
  onRemove?: (key: string) => void;
  className?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className={cn("divide-y divide-slate-100", className)}>
      {rows.map((p) => (
        <li key={p.key} className="flex items-center gap-3 px-5 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">
              {p.receiptNo ? `${p.receiptNo} · ` : ""}
              {p.method}
              {p.method === "Cheque" && p.chequeNumber ? ` ${p.chequeNumber}` : ""}
            </p>
            <p className="text-xs text-slate-500">
              {formatDate(p.date)}
              {p.method === "Cheque" && p.chequeDate ? ` · cheque date ${formatDate(p.chequeDate)}` : ""}
              {p.reference ? ` · ${p.reference}` : ""}
            </p>
          </div>
          <span className="text-right font-semibold text-emerald-700 tabular-nums">
            {formatMoney(p.amount)}
            {p.ofReceipt && p.ofReceipt > p.amount + 0.004 && (
              <span className="block text-xs font-normal text-slate-500">of {formatMoney(p.ofReceipt)} receipt</span>
            )}
          </span>
          {(onEdit || onRemove) && (
            <div className="flex items-center gap-1">
              {onEdit && (
                <Button variant="ghost" size="icon" onClick={() => onEdit(p.key)} aria-label={`Edit payment ${p.receiptNo ?? ""}`} title="Edit">
                  <Pencil />
                </Button>
              )}
              {onRemove && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-red-50 hover:text-red-600"
                  onClick={() => onRemove(p.key)}
                  aria-label={`Remove payment ${p.receiptNo ?? ""}`}
                  title="Remove"
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Add payment" button for a card header */
export function AddPaymentButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={disabled}>
      <Plus /> Add payment
    </Button>
  );
}
