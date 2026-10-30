"use client";

import { CalendarClock } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Detail } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { useAppStore } from "@/lib/store";
import { PAYMENT_METHODS, type Order, type OrderPayment, type PaymentMethod } from "@/lib/types";
import {
  addDays,
  CHEQUE_REMIND_DAYS,
  cn,
  daysUntil,
  formatDate,
  formatMoney,
  invoiceNumbersOf,
  NOT_PAID,
  paymentOf,
  RAIGAM_CHEQUE_DAYS,
  raigamChequeDate,
  todayISO,
  weekdayOf,
} from "@/lib/utils";

// How a Raigam bill was paid: one payment per load (Cash, Cheque or Bank Transfer), or not paid yet.
// Raigam deposits the cheque 21 days after the goods come; the app counts the days down.

/**
 * When Raigam deposits the cheque and the days left: blue while there's time, amber within the 5
 * reminder days, red on the last day or when the date has passed with no payment entered, grey
 * once deposited. null for orders not received yet or paid another way.
 */
function depositState(order: Order) {
  const date = raigamChequeDate(order);
  if (!date) return null;
  const days = daysUntil(date);
  const paid = !!order.paymentMethod;
  const text = days > 1 ? `${days} days left` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : paid ? "Deposited" : `${-days} day${days === -1 ? "" : "s"} late`;
  const tone = days < 0 && paid ? "slate" : days <= 1 ? "red" : days <= CHEQUE_REMIND_DAYS ? "amber" : "blue";
  return { date, days, text, tone } as const;
}

const countdownText = { blue: "text-sky-700", amber: "font-medium text-amber-700", red: "font-medium text-red-600", slate: "text-slate-500" };

/** Days until Raigam deposits the cheque, as coloured words ("21 days left", "Today", "3 days late") */
export function ChequeCountdown({ order }: { order: Order }) {
  const s = depositState(order);
  return s && <span className={countdownText[s.tone]}>{s.text}</span>;
}

/** The deposit date in bold with a days-left badge; "—" when there's none (not received yet, or paid by cash / transfer) */
export function ChequeDepositDate({ order, large = false }: { order: Order; large?: boolean }) {
  const s = depositState(order);
  if (!s) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className={cn("font-semibold whitespace-nowrap text-slate-900 tabular-nums", large ? "text-lg" : "text-sm")}>
        {weekdayOf(s.date)} {formatDate(s.date)}
      </span>
      <Badge tone={s.tone}>{s.text}</Badge>
    </span>
  );
}

export type OrderPaymentErrors = Partial<Record<"paidDate" | "chequeNumber", string>>;

/** Same checks as the server (core.ts), shown next to the fields */
export function orderPaymentErrors(p: OrderPayment): OrderPaymentErrors {
  const errors: OrderPaymentErrors = {};
  if (!p.paymentMethod) return errors;
  if (!p.paidDate) errors.paidDate = "Enter the date Raigam was paid.";
  if (p.paymentMethod === "Cheque" && !p.chequeNumber.trim()) errors.chequeNumber = "Cheque number is required.";
  return errors;
}

const referenceHint: Record<PaymentMethod, string> = {
  Cash: "Receipt no. or note",
  Cheque: "Bank or note",
  "Bank Transfer": "Transfer ref. or slip no.",
};

/** The payment fields as Field elements, laid out by the parent's grid */
export function OrderPaymentFields({
  value,
  onChange,
  errors = {},
  idPrefix,
  receivedDate = "",
}: {
  value: OrderPayment;
  onChange: (payment: OrderPayment) => void;
  errors?: OrderPaymentErrors;
  idPrefix: string;
  /** When the goods came: a cheque's deposit date starts 21 days after it */
  receivedDate?: string;
}) {
  const method = value.paymentMethod;
  const set = (patch: Partial<OrderPayment>) => onChange({ ...value, ...patch });
  const usualDeposit = addDays(receivedDate, RAIGAM_CHEQUE_DAYS);

  return (
    <>
      <Field label="Payment" htmlFor={`${idPrefix}PayMethod`}>
        <Select
          id={`${idPrefix}PayMethod`}
          value={method}
          // Picking a method starts the paid date at today, and a cheque's deposit date 21 days after the goods came
          onChange={(e) => {
            const paymentMethod = e.target.value as OrderPayment["paymentMethod"];
            set({
              paymentMethod,
              paidDate: paymentMethod ? value.paidDate || todayISO() : value.paidDate,
              chequeDepositDate: paymentMethod === "Cheque" ? value.chequeDepositDate || usualDeposit : value.chequeDepositDate,
            });
          }}
        >
          <option value="">Not paid yet</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
      {method && (
        <Field
          label="Paid Date"
          htmlFor={`${idPrefix}PaidDate`}
          required
          error={errors.paidDate}
          hint={method === "Cheque" ? "The day you gave the cheque" : undefined}
        >
          <Input
            id={`${idPrefix}PaidDate`}
            type="date"
            value={value.paidDate}
            onChange={(e) => set({ paidDate: e.target.value })}
            aria-invalid={!!errors.paidDate}
          />
        </Field>
      )}
      {method === "Cheque" && (
        <>
          <Field label="Cheque Number" htmlFor={`${idPrefix}ChequeNo`} required error={errors.chequeNumber}>
            <Input
              id={`${idPrefix}ChequeNo`}
              value={value.chequeNumber}
              onChange={(e) => set({ chequeNumber: e.target.value })}
              inputMode="numeric"
              aria-invalid={!!errors.chequeNumber}
            />
          </Field>
          <Field
            label="Cheque Deposit Date"
            htmlFor={`${idPrefix}ChequeDate`}
            hint={
              usualDeposit
                ? `Date on the cheque. Raigam deposits ${RAIGAM_CHEQUE_DAYS} days after the goods came: ${formatDate(usualDeposit)}`
                : "Date written on the cheque"
            }
          >
            <Input id={`${idPrefix}ChequeDate`} type="date" value={value.chequeDepositDate} onChange={(e) => set({ chequeDepositDate: e.target.value })} />
          </Field>
        </>
      )}
      {method && (
        <Field label="Reference" htmlFor={`${idPrefix}PayRef`}>
          <Input
            id={`${idPrefix}PayRef`}
            value={value.paymentReference}
            onChange={(e) => set({ paymentReference: e.target.value })}
            placeholder={referenceHint[method]}
          />
        </Field>
      )}
    </>
  );
}

/** "Not paid", or the method with its paid / cheque given date and reference (the deposit date has its own column) */
export function OrderPaymentSummary({ order }: { order: Order }) {
  if (!order.paymentMethod) return <span className="font-medium text-amber-700">Not paid</span>;
  const cheque = order.paymentMethod === "Cheque";
  return (
    <>
      <span className="font-medium text-emerald-700">{cheque ? `Cheque ${order.chequeNumber}` : order.paymentMethod}</span>
      <span className="block text-xs font-normal text-slate-500">
        {cheque ? "Given" : "Paid"} {formatDate(order.paidDate)}
        {order.paymentReference && ` · ${order.paymentReference}`}
      </span>
    </>
  );
}

const panelTones = {
  blue: { box: "border-brand-200 bg-brand-50", icon: "text-brand-700", text: "text-brand-900", count: "text-brand-700", bar: "bg-brand-500" },
  amber: { box: "border-amber-300 bg-amber-50", icon: "text-amber-600", text: "text-amber-950", count: "text-amber-700", bar: "bg-amber-500" },
  red: { box: "border-red-300 bg-red-50", icon: "text-red-600", text: "text-red-950", count: "text-red-600", bar: "bg-red-500" },
  done: { box: "border-slate-200 bg-white", icon: "text-slate-400", text: "text-slate-900", count: "text-slate-500", bar: "bg-slate-300" },
};

/**
 * The day Raigam deposits our cheque, shown large at the top of the order page: the date, the days
 * left, the days gone since the goods came, and the money to have in the bank. Blue while there's
 * time, amber in the 5 reminder days, red on the last day or when late with nothing paid, grey once deposited.
 * `action`: e.g. an Add cheque button while no payment is entered.
 */
export function ChequeDepositPanel({ order, action }: { order: Order; action?: ReactNode }) {
  const date = raigamChequeDate(order);
  if (!date) return null;
  const days = daysUntil(date);
  const paid = !!order.paymentMethod;
  const tone = days < 0 && paid ? "done" : days <= 1 ? "red" : days <= CHEQUE_REMIND_DAYS ? "amber" : "blue";
  const t = panelTones[tone];
  // From the day the goods came to the deposit day
  const span = Math.max(1, days - daysUntil(order.receivedDate));
  const gone = Math.min(span, Math.max(0, span - days));
  const [count, unit] =
    days >= 0 ? (days === 0 ? ["Today", "deposit day"] : [String(days), days === 1 ? "day left" : "days left"]) : paid ? ["Done", `deposited ${-days} day${days === -1 ? "" : "s"} ago`] : [String(-days), days === -1 ? "day late" : "days late"];

  return (
    <section className={cn("mb-6 rounded-xl border px-5 py-4 shadow-sm", t.box)} aria-label="Cheque deposit date">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-full bg-white shadow-sm", t.icon)}>
          <CalendarClock className="size-6" />
        </span>
        <div className={cn("min-w-0 flex-1", t.text)}>
          <p className="text-xs font-semibold tracking-wider uppercase opacity-70">Cheque deposit date</p>
          <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">
            {weekdayOf(date)}, {formatDate(date)}
          </p>
          <p className="mt-1 text-sm">
            {order.chequeDepositDate ? `Date on cheque ${order.chequeNumber}` : `${RAIGAM_CHEQUE_DAYS} days after the goods came (${formatDate(order.receivedDate)})`}
            {!paid && " · no cheque entered yet"}
          </p>
          {tone !== "done" && (
            <p className="text-sm font-medium">
              Have {formatMoney(order.totalBillAmount)} in the bank by this day.
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
          <p className={cn("text-right leading-none", t.count)}>
            <span className={cn("block font-bold tracking-tight tabular-nums", count.length > 3 ? "text-3xl" : "text-5xl")}>{count}</span>
            <span className="mt-1 block text-xs font-semibold tracking-wide uppercase">{unit}</span>
          </p>
          {action}
        </div>
      </div>
      {/* Days gone since the goods came, out of the days until the deposit */}
      {!order.chequeDepositDate && tone !== "done" && (
        <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/80 ring-1 ring-black/5">
            <div className={cn("h-full rounded-full", t.bar)} style={{ width: `${(gone / span) * 100}%` }} />
          </div>
          <span className="tabular-nums">
            Day {gone} of {span}
          </span>
        </div>
      )}
    </section>
  );
}

/** The payment as Detail fields, laid out by the parent's grid; the cheque deposit date large, with its days left */
export function OrderPaymentDetails({ order }: { order: Order }) {
  const deposit = !!raigamChequeDate(order) && (
    <Detail label="Cheque Deposit Date">
      <ChequeDepositDate order={order} large />
    </Detail>
  );
  if (!order.paymentMethod)
    return (
      <>
        <Detail label="Paid By">
          <span className="text-amber-700">Not paid yet</span>
        </Detail>
        {deposit}
      </>
    );
  const cheque = order.paymentMethod === "Cheque";
  return (
    <>
      <Detail label="Paid By">
        <span className="text-emerald-700">{order.paymentMethod}</span>
      </Detail>
      {cheque && <Detail label="Cheque Number">{order.chequeNumber}</Detail>}
      {cheque && deposit}
      <Detail label={cheque ? "Cheque Given" : "Paid Date"}>{formatDate(order.paidDate)}</Detail>
      {order.paymentReference && <Detail label="Reference">{order.paymentReference}</Detail>}
    </>
  );
}

function PayOrderForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const payOrder = useAppStore((s) => s.payOrder);
  // Raigam is usually paid by cheque, so a new payment starts as one (the method can still be changed),
  // deposited 21 days after the goods came
  const [payment, setPayment] = useState<OrderPayment>(() =>
    order.paymentMethod
      ? paymentOf(order)
      : { ...NOT_PAID, paymentMethod: "Cheque", paidDate: todayISO(), chequeDepositDate: addDays(order.receivedDate, RAIGAM_CHEQUE_DAYS) },
  );
  const [errors, setErrors] = useState<OrderPaymentErrors>({});

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = orderPaymentErrors(payment);
    setErrors(next);
    if (Object.keys(next).length) return;
    const result = await payOrder(order.id, payment);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(payment.paymentMethod ? `${order.orderId} marked as paid` : `${order.orderId} marked as not paid`);
    onDone();
  }

  return (
    <form id="pay-order-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <OrderPaymentFields value={payment} onChange={setPayment} errors={errors} idPrefix="payOrder" receivedDate={order.receivedDate} />
    </form>
  );
}

/** Record or change how a Raigam bill was paid (also for posted orders) */
export function PayOrderDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const invoices = invoiceNumbersOf(order, useAppStore((s) => s.orderInvoices));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={order.paymentMethod ? `Edit payment for ${order.orderId}` : `Add cheque or payment for ${order.orderId}`}
      description={`Bill amount ${formatMoney(order.totalBillAmount)}${invoices ? ` · invoice ${invoices}` : ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="pay-order-form">
            Save payment
          </Button>
        </>
      }
    >
      {/* Modal mounts this only while open, so it starts from the saved payment each time */}
      <PayOrderForm order={order} onDone={onClose} />
    </Modal>
  );
}
