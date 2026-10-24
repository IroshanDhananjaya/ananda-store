"use client";

import { Wand2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, ReadOnlyValue, Select, toNumber } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { StackBox } from "@/components/ui/table";
import { autoAllocate, openBills, type OpenBill } from "@/lib/ledger";
import { useAppStore, useShopBalances } from "@/lib/store";
import { PAYMENT_METHODS, type Payment, type PaymentMethod } from "@/lib/types";
import { cn, formatDate, formatMoney, nextCode, round2, todayISO } from "@/lib/utils";

type Values = {
  shopId: string;
  date: string;
  amount: string;
  method: PaymentMethod;
  chequeNumber: string;
  chequeDate: string;
  reference: string;
};

/** Bill id -> amount typed for it */
type Allocs = Record<string, string>;

const toAllocs = (list: { saleId: string; amount: number }[]): Allocs => Object.fromEntries(list.map((a) => [a.saleId, String(a.amount)]));

function PaymentForm({
  payment,
  defaultShopId,
  defaultSaleId,
  onDone,
}: {
  payment: Payment | null;
  defaultShopId?: string;
  defaultSaleId?: string;
  onDone: () => void;
}) {
  const shops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  const addPayment = useAppStore((s) => s.addPayment);
  const updatePayment = useAppStore((s) => s.updatePayment);
  const balances = useShopBalances();

  // Bills as they stand without this payment (so editing shows its own bills as open)
  const otherPayments = useMemo(() => payments.filter((p) => p.id !== payment?.id), [payments, payment?.id]);
  const billsFor = (shopId: string): OpenBill[] => {
    const shop = shops.find((s) => s.id === shopId);
    return shop ? openBills(shop, sales, otherPayments) : [];
  };

  const [values, setValues] = useState<Values>(() => {
    const shopId = payment?.shopId ?? defaultShopId ?? "";
    const presetBill = defaultSaleId ? billsFor(shopId).find((b) => b.id === defaultSaleId) : undefined;
    return {
      shopId,
      date: payment?.date ?? todayISO(),
      amount: payment ? String(payment.amount) : presetBill ? String(presetBill.due) : "",
      method: payment?.method ?? "Cash",
      chequeNumber: payment?.chequeNumber ?? "",
      chequeDate: payment?.chequeDate ?? "",
      reference: payment?.reference ?? "",
    };
  });
  const [allocs, setAllocs] = useState<Allocs>(() => {
    if (payment) return toAllocs(payment.allocations);
    const bill = defaultSaleId ? billsFor(values.shopId).find((b) => b.id === defaultSaleId) : undefined;
    return bill ? { [bill.id]: String(bill.due) } : {};
  });
  // Until the user types into a bill, bill amounts follow the payment amount (oldest first)
  const [manual, setManual] = useState(!!payment || !!defaultSaleId);
  const [errors, setErrors] = useState<Partial<Record<keyof Values | "allocs", string>>>({});
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const bills = billsFor(values.shopId);
  const linked = round2(bills.reduce((sum, b) => sum + toNumber(allocs[b.id] ?? ""), 0));
  const unlinked = round2(toNumber(values.amount) - linked);

  // Balance before this payment (when editing, add the payment's own amount back)
  const owed =
    values.shopId && balances.get(values.shopId)
      ? round2(balances.get(values.shopId)!.balance + (payment && payment.shopId === values.shopId ? payment.amount : 0))
      : null;
  const after = owed === null ? null : round2(owed - toNumber(values.amount));
  const shopOptions = shops.filter((s) => s.active || s.id === values.shopId).sort((a, b) => a.shopName.localeCompare(b.shopName));

  function changeAmount(amount: string) {
    setValues((v) => ({ ...v, amount }));
    if (!manual) setAllocs(toAllocs(autoAllocate(toNumber(amount), bills)));
  }

  function changeShop(shopId: string) {
    setValues((v) => ({ ...v, shopId }));
    setManual(false);
    setAllocs(toAllocs(autoAllocate(toNumber(values.amount), billsFor(shopId))));
  }

  function autoFill() {
    setManual(false);
    setAllocs(toAllocs(autoAllocate(toNumber(values.amount), bills)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.shopId) next.shopId = "Select a store.";
    if (!values.date) next.date = "Select a date.";
    if (!(toNumber(values.amount) > 0)) next.amount = "Enter an amount above 0.";
    if (values.method === "Cheque" && !values.chequeNumber.trim()) next.chequeNumber = "Cheque number is required.";
    const over = bills.find((b) => toNumber(allocs[b.id] ?? "") > b.due + 0.004 || toNumber(allocs[b.id] ?? "") < 0);
    if (over) next.allocs = `${over.ref} only has ${formatMoney(over.due)} to collect.`;
    else if (unlinked < -0.004) next.allocs = "The bill amounts add up to more than the payment.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = {
      ...values,
      amount: toNumber(values.amount),
      allocations: bills.map((b) => ({ saleId: b.id, amount: toNumber(allocs[b.id] ?? "") })).filter((a) => a.amount > 0),
    };
    const result = await (payment ? updatePayment(payment.id, input) : addPayment(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(payment ? "Payment updated" : `Payment of ${formatMoney(input.amount)} recorded`);
    onDone();
  }

  return (
    <form id="payment-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Receipt No.">
        <ReadOnlyValue className="font-medium">{payment?.receiptNo ?? nextCode(payments.map((p) => p.receiptNo), "RC", 4)}</ReadOnlyValue>
      </Field>
      <Field label="Date" htmlFor="payDate" required error={errors.date}>
        <Input id="payDate" type="date" value={values.date} onChange={set("date")} aria-invalid={!!errors.date} />
      </Field>
      <Field label="Store" htmlFor="payShop" required error={errors.shopId} className="sm:col-span-2">
        <Select id="payShop" value={values.shopId} onChange={(e) => changeShop(e.target.value)} aria-invalid={!!errors.shopId} autoFocus={!values.shopId}>
          <option value="">Select a store…</option>
          {shopOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shopName} ({s.shopCode}) · cash balance {formatMoney(balances.get(s.id)?.balance ?? 0)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount (Rs.)" htmlFor="payAmount" required error={errors.amount}>
        <div className="flex gap-2">
          <Input
            id="payAmount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={values.amount}
            onChange={(e) => changeAmount(e.target.value)}
            aria-invalid={!!errors.amount}
            className="font-semibold tabular-nums"
            autoFocus={!!values.shopId}
          />
          {owed !== null && owed > 0 && (
            <Button variant="secondary" onClick={() => changeAmount(String(owed))} title="Pay the full cash balance">
              Full
            </Button>
          )}
        </div>
      </Field>
      <Field label="Cash Balance">
        <ReadOnlyValue className="tabular-nums">
          {owed === null ? (
            "—"
          ) : (
            <>
              {formatMoney(owed)}
              <span className="mx-1.5 text-slate-400">→</span>
              <span className={cn("font-semibold", after! < 0 ? "text-amber-700" : "text-slate-900")}>{formatMoney(after!)}</span>
            </>
          )}
        </ReadOnlyValue>
      </Field>

      {values.shopId && (
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700">Bills this payment is for</p>
            {bills.length > 0 && (
              <Button variant="ghost" size="sm" onClick={autoFill} title="Fill the oldest bills first">
                <Wand2 /> Oldest first
              </Button>
            )}
          </div>
          {bills.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              This store has no unpaid bills. The payment will be kept as an advance.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <StackBox>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Bill</th>
                      <th className="px-3 py-2 text-right">Cash Balance</th>
                      <th className="w-36 px-3 py-2 text-right">Pay now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bills.map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-slate-900">{b.ref}</span>
                          <span className="block text-xs text-slate-500">
                            {b.date ? formatDate(b.date) : "Owed before using the app"} · total {formatMoney(b.total)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(b.due)}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            max={b.due}
                            step="0.01"
                            inputMode="decimal"
                            value={allocs[b.id] ?? ""}
                            placeholder="0"
                            onChange={(e) => {
                              setManual(true);
                              setAllocs((a) => ({ ...a, [b.id]: e.target.value }));
                            }}
                            aria-label={`Pay now for ${b.ref}`}
                            className="h-9 text-right tabular-nums"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StackBox>
              <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
                <span>
                  For bills: <span className="font-medium text-slate-900 tabular-nums">{formatMoney(linked)}</span>
                </span>
                {unlinked > 0.004 && (
                  <span className="text-amber-700">
                    Not for a bill: <span className="font-medium tabular-nums">{formatMoney(unlinked)}</span> (kept as advance)
                  </span>
                )}
              </div>
            </div>
          )}
          {errors.allocs && <p className="mt-1.5 text-xs text-red-600">{errors.allocs}</p>}
        </div>
      )}

      <Field label="Method" className="sm:col-span-2">
        <FilterTabs<PaymentMethod>
          value={values.method}
          onChange={(method) => setValues((v) => ({ ...v, method }))}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
        />
      </Field>
      {values.method === "Cheque" && (
        <>
          <Field label="Cheque Number" htmlFor="chqNo" required error={errors.chequeNumber}>
            <Input id="chqNo" value={values.chequeNumber} onChange={set("chequeNumber")} inputMode="numeric" aria-invalid={!!errors.chequeNumber} />
          </Field>
          <Field label="Cheque Date" htmlFor="chqDate" hint="Date the cheque can be deposited">
            <Input id="chqDate" type="date" value={values.chequeDate} onChange={set("chequeDate")} />
          </Field>
        </>
      )}
      <Field label="Reference / Notes" htmlFor="payRef" className="sm:col-span-2">
        <Input
          id="payRef"
          value={values.reference}
          onChange={set("reference")}
          placeholder={values.method === "Bank Transfer" ? "Bank and transfer reference" : "Optional"}
        />
      </Field>
    </form>
  );
}

export function PaymentFormDialog({
  payment,
  defaultShopId,
  defaultSaleId,
  open,
  onClose,
}: {
  payment: Payment | null;
  defaultShopId?: string;
  /** Pre-select one bill (opens with that bill's cash balance as the amount) */
  defaultSaleId?: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={payment ? `Edit payment ${payment.receiptNo}` : "Record payment"}
      description="Money collected from a store. It reduces the cash balance of the bills it pays."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form">
            {payment ? "Save changes" : "Record payment"}
          </Button>
        </>
      }
    >
      <PaymentForm
        key={payment?.id ?? `new-${defaultShopId ?? ""}-${defaultSaleId ?? ""}`}
        payment={payment}
        defaultShopId={defaultShopId}
        defaultSaleId={defaultSaleId}
        onDone={onClose}
      />
    </Modal>
  );
}
