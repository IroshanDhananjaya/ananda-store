"use client";

import { AlertTriangle, Wand2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, ReadOnlyValue, toNumber } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { StackBox } from "@/components/ui/table";
import { autoAllocate, openBills, type OpenBill } from "@/lib/ledger";
import { useAppStore, useItemMap, useSaleDues } from "@/lib/store";
import { PAYMENT_METHODS, type PaymentMethod, type Sale } from "@/lib/types";
import { addDays, formatDate, formatMoney, formatQty, round2, todayISO } from "@/lib/utils";
import { changesError, changesFrom, changesInput, DeliveryChanges, totalsWith, type DeliveryChangesValue } from "./delivery-changes";

type Allocs = Record<string, string>;
const toAllocs = (list: { saleId: string; amount: number }[]): Allocs => Object.fromEntries(list.map((a) => [a.saleId, String(a.amount)]));

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

  // This bill first, then the store's other unpaid bills (oldest first)
  const billsFor = (thisTotal: number): OpenBill[] => [
    { id: sale.id, ref: `${sale.saleNo} (this delivery)`, date: "", dueDate: "", total: thisTotal, paid: prepaid, due: Math.max(0, round2(thisTotal - prepaid)), overdueDays: 0 },
    ...(shop ? openBills(shop, sales, payments) : []),
  ];
  const bills = billsFor(total);

  const [date, setDate] = useState(todayISO);
  // End date for the balance: the store's credit days after delivery (follows the delivery date until changed here)
  const creditDays = shop?.creditDays ?? 21;
  const [dueDate, setDueDate] = useState(() => addDays(todayISO(), creditDays));
  const [dueTouched, setDueTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [allocs, setAllocs] = useState<Allocs>({});
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string>();

  // Delivering without loading first takes stock now, so check it
  const short =
    sale.status === "Ordered"
      ? sale.lines
          .map((l) => ({ line: l, have: stock.find((r) => r.sapCode === l.sapCode && r.locationNumber === l.locationNumber)?.availableQty ?? 0 }))
          .filter((x) => x.have < x.line.qty + x.line.freeQty)
      : [];

  const collected = toNumber(amount);
  const linked = round2(bills.reduce((sum, b) => sum + toNumber(allocs[b.id] ?? ""), 0));
  const unlinked = round2(collected - linked);
  const thisBillPaid = toNumber(allocs[sale.id] ?? "");
  const thisBillBalance = round2(bills[0].due - thisBillPaid);

  function changeAmount(value: string) {
    setAmount(value);
    setError(undefined);
    if (!manual) setAllocs(toAllocs(autoAllocate(toNumber(value), bills)));
  }

  function changeChanges(next: DeliveryChangesValue) {
    setChanges(next);
    setError(undefined);
    // The bill total moved: spread the money again (unless the amounts were typed by hand)
    if (!manual && collected > 0) setAllocs(toAllocs(autoAllocate(collected, billsFor(totalsWith(sale, next).total))));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date) return setError("Enter the delivery date.");
    const changeErr = changesError(sale, changes);
    if (changeErr) return setError(changeErr);
    if (collected < 0) return setError("Amount can't be negative.");
    const over = bills.find((b) => toNumber(allocs[b.id] ?? "") > b.due + 0.004);
    if (over) return setError(`${over.ref} only has ${formatMoney(over.due)} to pay.`);
    if (unlinked < -0.004) return setError("The bill amounts add up to more than the money collected.");
    if (thisBillBalance > 0 && (!dueDate || dueDate < date)) return setError("Set the end date for collecting the balance (on or after the delivery date).");
    if (method === "Cheque" && collected > 0 && !chequeNumber.trim()) return setError("Enter the cheque number.");

    const result = await deliverSale(sale.id, {
      ...changesInput(changes),
      date,
      dueDate: thisBillBalance > 0 ? dueDate : date,
      collection:
        collected > 0
          ? {
              amount: collected,
              method,
              chequeNumber,
              chequeDate,
              reference: `Collected on delivery of ${sale.saleNo}`,
              allocations: bills.map((b) => ({ saleId: b.id, amount: toNumber(allocs[b.id] ?? "") })).filter((a) => a.amount > 0),
            }
          : null,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      thisBillBalance > 0
        ? `${sale.saleNo} delivered · ${formatMoney(thisBillBalance)} to collect by ${formatDate(dueDate)}`
        : `${sale.saleNo} delivered and fully paid`,
    );
    onDone();
  }

  return (
    <form id="deliver-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      {short.length > 0 && (
        <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 sm:col-span-2">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" /> Not enough stock (this bill wasn&apos;t loaded on a lorry)
          </p>
          <ul className="mt-1 list-disc pl-6 text-xs">
            {short.map(({ line, have }) => (
              <li key={line.id}>
                {itemMap.get(line.sapCode)?.description ?? line.sapCode} at {line.locationNumber}: need {formatQty(line.qty + line.freeQty)}, have {formatQty(have)}
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
        label="Money collected now (Rs.)"
        htmlFor="dlvAmount"
        hint="Leave empty if the store pays later. You can add payments on the bill any time."
      >
        <div className="flex gap-2">
          <Input
            id="dlvAmount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            placeholder="0"
            onChange={(e) => changeAmount(e.target.value)}
            className="font-semibold tabular-nums"
            autoFocus
          />
          <Button variant="secondary" onClick={() => changeAmount(String(bills[0].due))} title="Collect everything left on this bill">
            {prepaid > 0 ? "Rest of bill" : "Full bill"}
          </Button>
        </div>
      </Field>
      <Field label="Method">
        <FilterTabs<PaymentMethod> value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
      </Field>
      {method === "Cheque" && collected > 0 && (
        <>
          <Field label="Cheque Number" htmlFor="dlvChq" required>
            <Input id="dlvChq" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Cheque Date" htmlFor="dlvChqDate">
            <Input id="dlvChqDate" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
          </Field>
        </>
      )}

      {collected > 0 && (
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700">Which bills is this money for?</p>
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
                {formatMoney(unlinked)} isn&apos;t for any bill. It will be kept as an advance for this store.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm sm:col-span-2">
        <div className="flex justify-between">
          <span className="text-slate-600">{sale.saleNo} balance after delivery</span>
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
          hint={`${creditDays} day${creditDays === 1 ? "" : "s"} after delivery (the store's credit days). Change it if needed.`}
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
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
    </form>
  );
}

export function DeliverDialog({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  const stock = useAppStore((s) => s.stock);
  const blocked =
    sale.status === "Ordered" &&
    sale.lines.some((l) => (stock.find((r) => r.sapCode === l.sapCode && r.locationNumber === l.locationNumber)?.availableQty ?? 0) < l.qty + l.freeQty);
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
          <Button type="submit" form="deliver-form" disabled={blocked}>
            Mark delivered
          </Button>
        </>
      }
    >
      <DeliverForm key={sale.id} sale={sale} onDone={onClose} />
    </Modal>
  );
}
