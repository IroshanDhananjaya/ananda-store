"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Detail } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { useAppStore } from "@/lib/store";
import { PAYMENT_METHODS, type Order, type OrderPayment, type PaymentMethod } from "@/lib/types";
import { formatDate, formatMoney, NOT_PAID, paymentOf, todayISO } from "@/lib/utils";

// How a Raigam bill was paid: one payment per load (Cash, Cheque or Bank Transfer), or not paid yet.

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
}: {
  value: OrderPayment;
  onChange: (payment: OrderPayment) => void;
  errors?: OrderPaymentErrors;
  idPrefix: string;
}) {
  const method = value.paymentMethod;
  const set = (patch: Partial<OrderPayment>) => onChange({ ...value, ...patch });

  return (
    <>
      <Field label="Payment" htmlFor={`${idPrefix}PayMethod`}>
        <Select
          id={`${idPrefix}PayMethod`}
          value={method}
          // Picking a method starts the paid date at today
          onChange={(e) => {
            const paymentMethod = e.target.value as OrderPayment["paymentMethod"];
            set({ paymentMethod, paidDate: paymentMethod ? value.paidDate || todayISO() : value.paidDate });
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
          <Field label="Cheque Deposit Date" htmlFor={`${idPrefix}ChequeDate`} hint="Date written on the cheque">
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

/** "Not paid", or the method with its cheque number / date / reference */
export function OrderPaymentSummary({ order }: { order: Order }) {
  if (!order.paymentMethod) return <span className="font-medium text-amber-700">Not paid</span>;
  const cheque = order.paymentMethod === "Cheque";
  return (
    <>
      <span className="font-medium text-emerald-700">{cheque ? `Cheque ${order.chequeNumber}` : order.paymentMethod}</span>
      <span className="block text-xs font-normal text-slate-500">
        {cheque && order.chequeDepositDate ? `Deposit ${formatDate(order.chequeDepositDate)}` : `Paid ${formatDate(order.paidDate)}`}
        {order.paymentReference && ` · ${order.paymentReference}`}
      </span>
    </>
  );
}

/** The payment as Detail fields, laid out by the parent's grid */
export function OrderPaymentDetails({ order }: { order: Order }) {
  if (!order.paymentMethod)
    return (
      <Detail label="Paid By">
        <span className="text-amber-700">Not paid yet</span>
      </Detail>
    );
  const cheque = order.paymentMethod === "Cheque";
  return (
    <>
      <Detail label="Paid By">
        <span className="text-emerald-700">{order.paymentMethod}</span>
      </Detail>
      {cheque && <Detail label="Cheque Number">{order.chequeNumber}</Detail>}
      {cheque && <Detail label="Cheque Deposit Date">{order.chequeDepositDate ? formatDate(order.chequeDepositDate) : "—"}</Detail>}
      <Detail label={cheque ? "Cheque Given" : "Paid Date"}>{formatDate(order.paidDate)}</Detail>
      {order.paymentReference && <Detail label="Reference">{order.paymentReference}</Detail>}
    </>
  );
}

function PayOrderForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const payOrder = useAppStore((s) => s.payOrder);
  // Raigam is usually paid by cheque, so a new payment starts as one (the method can still be changed)
  const [payment, setPayment] = useState<OrderPayment>(() =>
    order.paymentMethod ? paymentOf(order) : { ...NOT_PAID, paymentMethod: "Cheque", paidDate: todayISO() },
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
      <OrderPaymentFields value={payment} onChange={setPayment} errors={errors} idPrefix="payOrder" />
    </form>
  );
}

/** Record or change how a Raigam bill was paid (also for posted orders) */
export function PayOrderDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={order.paymentMethod ? `Edit payment for ${order.orderId}` : `Add cheque or payment for ${order.orderId}`}
      description={`Bill amount ${formatMoney(order.totalBillAmount)}${order.invoiceNumber ? ` · invoice ${order.invoiceNumber}` : ""}`}
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
