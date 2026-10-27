"use client";

import { AlertTriangle, Plus, Wand2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChequeStatusField } from "@/components/payments/cheque-status-field";
import { Field, Input, ReadOnlyValue, Textarea, toNumber } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { StackBox } from "@/components/ui/table";
import { autoAllocate, openBills, type OpenBill } from "@/lib/ledger";
import { useAppStore, useItemMap, useSaleDues } from "@/lib/store";
import { PAYMENT_METHODS, type PaymentMethod, type Sale } from "@/lib/types";
import { addDays, formatDate, formatMoney, formatQty, newId, round2, todayISO } from "@/lib/utils";
import { changesError, changesFrom, changesInput, DeliveryChanges, totalsWith, type DeliveryChangesValue } from "./delivery-changes";

type Allocs = Record<string, string>;
/** Longest credit (end date or cheque date) given after delivery */
const MAX_CREDIT_DAYS = 21;
const toAllocs = (list: { saleId: string; amount: number }[]): Allocs => Object.fromEntries(list.map((a) => [a.saleId, String(a.amount)]));

/** One payment collected at the door; a delivery can have several (e.g. part cash, part cheque) */
type PayDraft = {
  key: string;
  amount: string;
  method: PaymentMethod;
  chequeNumber: string;
  chequeDate: string;
  /** "" = still to collect */
  chequeCollectedDate: string;
  /** Cheque bank / branch, transfer reference, … */
  note: string;
};
const blankPay = (): PayDraft => ({ key: newId(), amount: "", method: "Cash", chequeNumber: "", chequeDate: "", chequeCollectedDate: "", note: "" });
/** A cheque still to collect isn't paid yet: its bills keep their balance until it's collected */
const isPending = (p: PayDraft) => p.method === "Cheque" && !p.chequeCollectedDate;

/**
 * The amounts typed per bill, shared out over the payments in order: each payment pays the
 * bills (this one first) until it runs out. What's left of a payment is kept as an advance.
 */
function splitOver(amounts: number[], bills: { id: string; amount: number }[]) {
  const left = bills.map((b) => ({ ...b }));
  return amounts.map((amount) => {
    let rest = amount;
    const allocations: { saleId: string; amount: number }[] = [];
    for (const b of left) {
      const take = round2(Math.min(rest, b.amount));
      if (take <= 0) continue;
      allocations.push({ saleId: b.id, amount: take });
      b.amount = round2(b.amount - take);
      rest = round2(rest - take);
    }
    return allocations;
  });
}

function DeliverForm({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const stock = useAppStore((s) => s.stock);
  const shops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  const deliverSale = useAppStore((s) => s.deliverSale);
  const itemMap = useItemMap();
  const shop = shops.find((s) => s.id === sale.shopId);
  // Paid with the order / in advance comes off what's collected now
  const prepaid = useSaleDues().get(sale.id)?.paid ?? 0;
  // Cancelled items and returns change what this bill comes to
  const [changes, setChanges] = useState<DeliveryChangesValue>(() => changesFrom(sale));
  const total = totalsWith(sale, changes).total;

  // Credit amount added on this bill (e.g. old credit to collect with it): owed with the bill, not part of its invoice value
  const [creditAmount, setCreditAmount] = useState(() => (sale.extraCredit ? String(sale.extraCredit) : ""));
  const credit = Math.max(0, toNumber(creditAmount));

  // This bill first (its invoice value plus the credit added), then the store's other unpaid bills (oldest first)
  const billsFor = (thisTotal: number, added: number): OpenBill[] => [
    {
      id: sale.id,
      ref: `${sale.saleNo} (this delivery)`,
      date: "",
      dueDate: "",
      total: round2(thisTotal + added),
      paid: prepaid,
      due: Math.max(0, round2(thisTotal + added - prepaid)),
      overdueDays: 0,
    },
    ...(shop ? openBills(shop, sales, payments) : []),
  ];
  const bills = billsFor(total, credit);

  const [date, setDate] = useState(todayISO);
  // End date for the balance: the store's credit days after delivery (follows the delivery date until changed here)
  const creditDays = shop?.creditDays ?? 21;
  const [dueDate, setDueDate] = useState(() => addDays(todayISO(), creditDays));
  const [dueTouched, setDueTouched] = useState(false);
  // Credit and cheques are given for up to this long after delivery (warned, not blocked)
  const latestDate = addDays(date, MAX_CREDIT_DAYS);
  const [pays, setPays] = useState<PayDraft[]>(() => [blankPay()]);
  const [deliveryNote, setDeliveryNote] = useState(sale.deliveryNote);
  const [allocs, setAllocs] = useState<Allocs>({});
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string>();

  // Delivering without loading first takes stock now; short stock is shown but doesn't stop it (the goods already went)
  const short =
    sale.status === "Ordered"
      ? sale.lines
          .map((l) => ({ line: l, have: stock.find((r) => r.sapCode === l.sapCode && r.locationNumber === l.locationNumber)?.availableQty ?? 0 }))
          .filter((x) => x.have < x.line.qty + x.line.freeQty - x.line.missingQty)
      : [];

  const allocOf = (billId: string) => toNumber(allocs[billId] ?? "");
  const amounts = pays.map((p) => Math.max(0, toNumber(p.amount)));
  const collected = round2(amounts.reduce((sum, a) => sum + a, 0));
  const linked = round2(bills.reduce((sum, b) => sum + allocOf(b.id), 0));
  const unlinked = round2(collected - linked);
  // Which bills each payment pays (the bill amounts below are for all the payments together)
  const split = splitOver(
    amounts,
    bills.map((b) => ({ id: b.id, amount: allocOf(b.id) })),
  );
  // A cheque still to collect pays nothing yet
  const thisBillPaid = round2(
    split.reduce((sum, list, i) => sum + (isPending(pays[i]) ? 0 : list.filter((a) => a.saleId === sale.id).reduce((n, a) => n + a.amount, 0)), 0),
  );
  const thisBillBalance = round2(bills[0].due - thisBillPaid);
  const pendingTotal = round2(pays.reduce((sum, p, i) => sum + (isPending(p) ? amounts[i] : 0), 0));
  const several = pays.length > 1;

  /** Bill amounts follow the money collected (this bill first), unless they were typed by hand */
  function spread(amount: number, list = bills) {
    if (!manual) setAllocs(toAllocs(autoAllocate(amount, list)));
  }

  function changePay(key: string, patch: Partial<PayDraft>) {
    const next = pays.map((p) => (p.key === key ? { ...p, ...patch } : p));
    setPays(next);
    setError(undefined);
    if ("amount" in patch) spread(round2(next.reduce((sum, p) => sum + Math.max(0, toNumber(p.amount)), 0)));
  }

  function removePay(key: string) {
    const next = pays.filter((p) => p.key !== key);
    setPays(next);
    setError(undefined);
    spread(round2(next.reduce((sum, p) => sum + Math.max(0, toNumber(p.amount)), 0)));
  }

  function changeChanges(next: DeliveryChangesValue) {
    setChanges(next);
    setError(undefined);
    // The bill total moved: spread the money again (unless the amounts were typed by hand)
    if (collected > 0) spread(collected, billsFor(totalsWith(sale, next).total, credit));
  }

  function changeCredit(value: string) {
    setCreditAmount(value);
    setError(undefined);
    if (collected > 0) spread(collected, billsFor(total, Math.max(0, toNumber(value))));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date) return setError("Enter the delivery date.");
    const changeErr = changesError(sale, changes);
    if (changeErr) return setError(changeErr);
    for (const [i, p] of pays.entries()) {
      const which = several ? `Payment ${i + 1}: ` : "";
      const value = toNumber(p.amount);
      if (value < 0) return setError(`${which}Amount can't be negative.`);
      if (p.method === "Cheque" && value > 0 && p.chequeCollectedDate && !p.chequeNumber.trim()) return setError(`${which}Enter the cheque number of the collected cheque.`);
      // A cheque filled in without its amount would be lost
      if (p.method === "Cheque" && !(value > 0) && p.chequeNumber.trim()) return setError(`${which}Enter the cheque amount.`);
    }
    const over = bills.find((b) => allocOf(b.id) > b.due + 0.004);
    if (over) return setError(`${over.ref} only has ${formatMoney(over.due)} to pay.`);
    if (unlinked < -0.004) return setError("The bill amounts add up to more than the money collected.");
    if (thisBillBalance > 0 && (!dueDate || dueDate < date)) return setError("Set the end date for collecting the balance (on or after the delivery date).");
    if (toNumber(creditAmount) < 0) return setError("Credit amount can't be negative.");

    const result = await deliverSale(sale.id, {
      ...changesInput(changes),
      date,
      dueDate: thisBillBalance > 0 ? dueDate : date,
      note: deliveryNote,
      extraCredit: credit,
      // One receipt per payment
      collections: pays.flatMap((p, i) =>
        amounts[i] > 0
          ? [
              {
                amount: amounts[i],
                method: p.method,
                chequeNumber: p.chequeNumber,
                chequeDate: p.chequeDate,
                chequeCollectedDate: p.method === "Cheque" ? p.chequeCollectedDate : "",
                reference: [p.note.trim(), `Collected on delivery of ${sale.saleNo}`].filter(Boolean).join(" · "),
                allocations: split[i],
              },
            ]
          : [],
      ),
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const paidCount = amounts.filter((a) => a > 0).length;
    toast.success(
      (thisBillBalance > 0
        ? `${sale.saleNo} delivered · ${formatMoney(thisBillBalance)} to collect by ${formatDate(dueDate)}`
        : `${sale.saleNo} delivered and fully paid`) +
        (paidCount > 1 ? ` · ${paidCount} payments` : "") +
        (credit > 0 ? ` (incl. credit added ${formatMoney(credit)})` : "") +
        (pendingTotal > 0 ? ` · cheque ${formatMoney(pendingTotal)} still to collect` : ""),
    );
    onDone();
  }

  return (
    <form id="deliver-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      {short.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 sm:col-span-2">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" /> Less stock in the app than this bill (it wasn&apos;t loaded on a lorry)
          </p>
          <p className="mt-0.5 text-xs">You can still mark it delivered: these items&apos; stock goes down to 0. Check the stock count later.</p>
          <ul className="mt-1 list-disc pl-6 text-xs">
            {short.map(({ line, have }) => (
              <li key={line.id}>
                {itemMap.get(line.sapCode)?.description ?? line.sapCode} at {line.locationNumber}: need {formatQty(line.qty + line.freeQty - line.missingQty)}, have {formatQty(have)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field
        label="Invoice value"
        hint={prepaid > 0 ? `${formatMoney(prepaid)} already paid · ${formatMoney(bills[0].due)} left` : "After any cancelled items and returns below"}
      >
        <ReadOnlyValue className="font-semibold tabular-nums">{formatMoney(total)}</ReadOnlyValue>
      </Field>
      <Field label="Delivery date" htmlFor="dlvDate" required>
        <Input
          id="dlvDate"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            if (!dueTouched && e.target.value) setDueDate(addDays(e.target.value, creditDays));
          }}
        />
      </Field>

      {/* Starts open when the bill has return items to check; after that it's up to the user */}
      <details className="group rounded-lg border border-slate-200 sm:col-span-2" open={sale.returns.length > 0}>
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-700 select-none">
          Cancelled items or returns? <span className="font-normal text-slate-500">(optional)</span>
        </summary>
        <div className="border-t border-slate-200 p-3">
          <DeliveryChanges sale={sale} value={changes} onChange={changeChanges} />
        </div>
      </details>

      <Field
        label="Credit amount to add (Rs.)"
        htmlFor="dlvCredit"
        hint={
          credit > 0
            ? `${sale.saleNo} to collect: invoice ${formatMoney(total)} + credit ${formatMoney(credit)} = ${formatMoney(round2(total + credit))}. Not a sale: the invoice value, profit and Raigam totals stay the same.`
            : "Optional: money the store owes on top of this bill (e.g. old credit to collect with it, even on a Rs. 0 bill). The unpaid part of the bill is on credit by itself."
        }
        className="sm:col-span-2"
      >
        <Input
          id="dlvCredit"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={creditAmount}
          placeholder="0"
          onChange={(e) => changeCredit(e.target.value)}
          className="font-semibold tabular-nums sm:w-60"
        />
      </Field>

      {/* The money collected: one payment, or several (each its own receipt) */}
      {pays.map((p, i) => {
        const id = (name: string) => `dlv${name}${i ? `-${i}` : ""}`;
        // What's left on this bill after the other payments
        const rest = Math.max(0, round2(bills[0].due - (collected - amounts[i])));
        const fields = (
          <>
            <Field
              label={several ? "Amount (Rs.)" : "Money collected now (Rs.)"}
              htmlFor={id("Amount")}
              hint={several ? undefined : "Leave empty if the store pays later (on credit). Paid part cash, part cheque? Add another payment below."}
            >
              <div className="flex gap-2">
                <Input
                  id={id("Amount")}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={p.amount}
                  placeholder="0"
                  onChange={(e) => changePay(p.key, { amount: e.target.value })}
                  className="font-semibold tabular-nums"
                  autoFocus={i === 0}
                />
                <Button
                  variant="secondary"
                  onClick={() => changePay(p.key, { amount: String(rest) })}
                  title={several ? "What's left on this bill after the other payments" : "Collect everything left on this bill"}
                >
                  {several || prepaid > 0 ? "Rest of bill" : "Full bill"}
                </Button>
              </div>
            </Field>
            <Field label="Method">
              <FilterTabs<PaymentMethod> value={p.method} onChange={(method) => changePay(p.key, { method })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
            </Field>
            {p.method === "Cheque" && (
              <>
                <Field
                  label="Cheque Number"
                  htmlFor={id("Chq")}
                  required={!!p.chequeCollectedDate}
                  hint={p.chequeCollectedDate ? undefined : "Add it now or when you collect the cheque"}
                >
                  <Input id={id("Chq")} value={p.chequeNumber} onChange={(e) => changePay(p.key, { chequeNumber: e.target.value })} inputMode="numeric" />
                </Field>
                <Field
                  label="Cheque Date"
                  htmlFor={id("ChqDate")}
                  hint={
                    p.chequeDate > latestDate ? (
                      <span className="font-medium text-amber-700">More than {MAX_CREDIT_DAYS} days after delivery (latest {formatDate(latestDate)}).</span>
                    ) : (
                      "When it can be banked"
                    )
                  }
                >
                  <Input id={id("ChqDate")} type="date" value={p.chequeDate} onChange={(e) => changePay(p.key, { chequeDate: e.target.value })} />
                </Field>
                <ChequeStatusField collectedDate={p.chequeCollectedDate} onChange={(chequeCollectedDate) => changePay(p.key, { chequeCollectedDate })} receivedDate={date} />
              </>
            )}
            {(amounts[i] > 0 || p.method === "Cheque") && (
              <Field
                label={p.method === "Bank Transfer" ? "Transfer reference" : p.method === "Cheque" ? "Cheque note" : "Payment note"}
                htmlFor={id("Note")}
                className={p.method === "Cheque" ? undefined : "sm:col-span-2"}
              >
                <Input
                  id={id("Note")}
                  value={p.note}
                  onChange={(e) => changePay(p.key, { note: e.target.value })}
                  placeholder={p.method === "Cheque" ? "Bank, branch, who gave it… (optional)" : "Optional"}
                />
              </Field>
            )}
          </>
        );
        return several ? (
          <div key={p.key} className="rounded-lg border border-slate-200 sm:col-span-2">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-sm font-medium text-slate-700">
                Payment {i + 1}
                <span className="font-normal text-slate-500">
                  {" "}
                  · {p.method}
                  {amounts[i] > 0 ? ` · ${formatMoney(amounts[i])}` : ""}
                </span>
              </p>
              <Button variant="ghost" size="sm" className="hover:bg-red-50 hover:text-red-600" onClick={() => removePay(p.key)} aria-label={`Remove payment ${i + 1}`}>
                <X /> Remove
              </Button>
            </div>
            <div className="grid gap-4 p-3 sm:grid-cols-2">{fields}</div>
          </div>
        ) : (
          <div key={p.key} className="contents">
            {fields}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2">
        {/* Part cash, part cheque: the next one starts as the other method */}
        <Button variant="secondary" size="sm" onClick={() => setPays((ps) => [...ps, { ...blankPay(), method: ps.at(-1)?.method === "Cash" ? "Cheque" : "Cash" }])}>
          <Plus /> Add another payment
        </Button>
        <span className="text-xs text-slate-500">
          {several ? `${pays.length} payments · ${formatMoney(collected)} collected in all, each saved as its own receipt` : "e.g. part cash, part cheque"}
        </span>
      </div>

      {collected > 0 && (
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700">Which bills is {several ? `the ${formatMoney(collected)}` : "this money"} for?</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setManual(false);
                setAllocs(toAllocs(autoAllocate(collected, bills)));
              }}
            >
              <Wand2 /> This bill first
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <StackBox>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Bill</th>
                    <th className="px-3 py-2 text-right">To pay</th>
                    <th className="w-36 px-3 py-2 text-right">Paid now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bills.map((b) => (
                    <tr key={b.id} className={b.id === sale.id ? "bg-brand-50/50" : ""}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-900">{b.ref}</span>
                        {b.id !== sale.id && (
                          <span className="block text-xs text-slate-500">
                            {b.date ? `Delivered ${formatDate(b.date)}` : "Owed before using the app"}
                            {b.dueDate ? ` · end date ${formatDate(b.dueDate)}` : ""}
                            {b.overdueDays > 0 && <span className="font-medium text-red-600"> · {b.overdueDays} days overdue</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(b.due)}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={b.due}
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0"
                          value={allocs[b.id] ?? ""}
                          onChange={(e) => {
                            setManual(true);
                            setAllocs((a) => ({ ...a, [b.id]: e.target.value }));
                          }}
                          aria-label={`Paid now for ${b.ref}`}
                          className="h-9 text-right tabular-nums"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StackBox>
            {unlinked > 0.004 && (
              <p className="border-t border-slate-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {formatMoney(unlinked)} isn&apos;t for any bill. It will be kept as an advance for this store. If it&apos;s for credit the store owes,
                enter that in <span className="font-medium">Credit amount to add</span> above.
              </p>
            )}
            {pendingTotal > 0 && (
              <p className="border-t border-slate-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                {several ? `The cheque still to collect (${formatMoney(pendingTotal)})` : "This cheque is still to collect: it"} pays these bills once you mark it
                collected (here, on the bill, or on Cheques &amp; Credit).
              </p>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm sm:col-span-2">
        <div className="flex justify-between">
          <span className="text-slate-600">
            {sale.saleNo} {thisBillBalance > 0 ? "balance on credit" : "balance"} after delivery
          </span>
          <span className={thisBillBalance > 0 ? "font-semibold text-red-600 tabular-nums" : "font-semibold text-emerald-700 tabular-nums"}>
            {formatMoney(Math.max(0, thisBillBalance))}
          </span>
        </div>
      </div>
      {thisBillBalance > 0 && (
        <Field
          label="End date to collect the balance"
          htmlFor="dlvDue"
          required
          hint={
            dueDate > latestDate ? (
              <span className="font-medium text-amber-700">
                More than {MAX_CREDIT_DAYS} days after delivery: credit is given for up to {MAX_CREDIT_DAYS} days (latest {formatDate(latestDate)}).
              </span>
            ) : (
              `${creditDays} day${creditDays === 1 ? "" : "s"} after delivery (the store's credit days). Change it if needed.`
            )
          }
          className="sm:col-span-2"
        >
          <Input
            id="dlvDue"
            type="date"
            min={date}
            value={dueDate}
            onChange={(e) => {
              setDueTouched(true);
              setDueDate(e.target.value);
            }}
          />
        </Field>
      )}
      <Field
        label="Delivery note"
        htmlFor="dlvDeliveryNote"
        hint={thisBillBalance > 0 ? "Shown on the bill, and on Cheques & Credit while the balance is on credit." : "Shown on the bill."}
        className="sm:col-span-2"
      >
        <Textarea
          id="dlvDeliveryNote"
          value={deliveryNote}
          onChange={(e) => setDeliveryNote(e.target.value)}
          rows={2}
          className="min-h-16"
          placeholder="Anything about this delivery or the credit, e.g. will pay on Friday, given to the owner's son… (optional)"
        />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
    </form>
  );
}

export function DeliverDialog({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Deliver ${sale.saleNo}`}
      description="Record that the items were given to the store, and any money collected."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="deliver-form">
            Mark delivered
          </Button>
        </>
      }
    >
      <DeliverForm key={sale.id} sale={sale} onDone={onClose} />
    </Modal>
  );
}
