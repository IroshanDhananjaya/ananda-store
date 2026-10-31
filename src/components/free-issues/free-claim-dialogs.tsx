"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker, inDateRange, type DateRange } from "@/components/ui/date-range-picker";
import { Field, Input, Textarea, toNumber } from "@/components/ui/form";
import { Detail } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { billFreeIssue, claimBillCount, claimBySale, claimUnits, claimValue, isClaimPaid } from "@/lib/free-issues";
import { useAppStore, useItemMap, useShopMap } from "@/lib/store";
import type { FreeClaim } from "@/lib/types";
import { formatDate, formatMoney, formatQty, round2, todayISO } from "@/lib/utils";

// Claims for free issue: Raigam pays back the free issue given on delivered bills.

/** A claim's state: waiting for Raigam, or paid (with what they paid) */
export function ClaimStatusBadge({ claim }: { claim: FreeClaim }) {
  if (!isClaimPaid(claim)) return <Badge tone="amber">Claimed</Badge>;
  const short = round2(claimValue(claim) - claim.paidAmount);
  return short > 0 ? <Badge tone="blue">Paid · short {formatMoney(short)}</Badge> : <Badge tone="green">Paid</Badge>;
}

const tick = "size-4 cursor-pointer rounded accent-brand-600";

function NewClaimForm({ range: startRange, onDone }: { range: DateRange; onDone: () => void }) {
  const sales = useAppStore((s) => s.sales);
  const freeClaims = useAppStore((s) => s.freeClaims);
  const createFreeClaim = useAppStore((s) => s.createFreeClaim);
  const shopMap = useShopMap();
  const [range, setRange] = useState<DateRange>(startRange);
  const [date, setDate] = useState(todayISO);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();

  // Delivered bills with free issue that aren't on a claim yet, oldest first
  const claimable = useMemo(() => {
    const claimed = claimBySale(freeClaims);
    return sales
      .filter((s) => s.status === "Delivered" && !claimed.has(s.id))
      .map((sale) => {
        const free = billFreeIssue(sale);
        return { sale, units: free.reduce((n, f) => n + f.qty, 0), value: round2(free.reduce((n, f) => n + f.value, 0)), items: free.length };
      })
      .filter((b) => b.units > 0)
      .sort((a, b) => a.sale.deliveredDate.localeCompare(b.sale.deliveredDate) || a.sale.saleNo.localeCompare(b.sale.saleNo));
  }, [sales, freeClaims]);
  const shown = claimable.filter((b) => inDateRange(b.sale.deliveredDate, range));
  // Untick to leave a bill out; ticks on bills outside the dates don't count
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const chosen = shown.filter((b) => !unticked.has(b.sale.id));
  const units = chosen.reduce((n, b) => n + b.units, 0);
  const value = round2(chosen.reduce((n, b) => n + b.value, 0));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = !date ? "Enter the date of the claim." : chosen.length === 0 ? "Tick the bills to claim." : undefined;
    setError(err);
    if (err) return;
    const result = await createFreeClaim({ date, reference, notes, saleIds: chosen.map((b) => b.sale.id) });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const claim = useAppStore.getState().freeClaims.find((c) => c.id === result.id);
    toast.success(`${claim?.claimNo ?? "Claim"} saved · ${formatMoney(value)} on ${chosen.length} bill${chosen.length === 1 ? "" : "s"}`);
    onDone();
  }

  return (
    <form id="new-claim-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Claim date" htmlFor="fcDate" required>
          <Input id="fcDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Raigam reference" htmlFor="fcRef" hint="Their claim no., if you have it">
          <Input id="fcRef" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-700">Delivered bills not claimed yet</p>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
        <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
          <Table>
            <THead>
              <tr>
                <TH className="w-10">
                  <input
                    type="checkbox"
                    className={tick}
                    checked={shown.length > 0 && chosen.length === shown.length}
                    onChange={(e) => setUnticked(new Set(e.target.checked ? [] : shown.map((b) => b.sale.id)))}
                    aria-label="Tick all bills"
                  />
                </TH>
                <TH>Delivered</TH>
                <TH>Bill No.</TH>
                <TH>Store</TH>
                <TH className="text-right">Free Qty</TH>
                <TH className="text-right">Free Value</TH>
              </tr>
            </THead>
            <TBody>
              {shown.length === 0 && (
                <EmptyRow colSpan={6}>{claimable.length ? "No unclaimed bills delivered on these dates." : "Every delivered bill with free issue is claimed."}</EmptyRow>
              )}
              {shown.map((b) => (
                <TR key={b.sale.id}>
                  <TD>
                    <input
                      type="checkbox"
                      className={tick}
                      checked={!unticked.has(b.sale.id)}
                      onChange={(e) =>
                        setUnticked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(b.sale.id);
                          else next.add(b.sale.id);
                          return next;
                        })
                      }
                      aria-label={`Claim ${b.sale.saleNo}`}
                    />
                  </TD>
                  <TD className="tabular-nums">{formatDate(b.sale.deliveredDate)}</TD>
                  <TD>
                    <span className="font-medium text-slate-900">{b.sale.saleNo}</span>
                    {b.sale.invoiceNo && <span className="block text-xs text-slate-500">{b.sale.invoiceNo}</span>}
                  </TD>
                  <TD className="whitespace-normal">{shopMap.get(b.sale.shopId)?.shopName ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{formatQty(b.units)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(b.value)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <p className="mt-2 text-right text-sm text-slate-600">
          Claiming <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(value)}</span> · {formatQty(units)} units on {chosen.length} bill
          {chosen.length === 1 ? "" : "s"}
        </p>
      </div>

      <Field label="Note" htmlFor="fcNotes">
        <Textarea id="fcNotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" />
      </Field>
      <p className="text-xs text-slate-500">Once claimed, a bill&apos;s free issue is locked. To change it, delete the claim first.</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** Claim the free issue on delivered bills back from Raigam */
export function NewClaimDialog({ open, onClose, range }: { open: boolean; onClose: () => void; range: DateRange }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New free issue claim"
      description="Claims all the free issue on the ticked bills from Raigam."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-claim-form">
            Save claim
          </Button>
        </>
      }
    >
      {open && <NewClaimForm range={range} onDone={onClose} />}
    </Modal>
  );
}

/** What's on one claim: totals per item (to send Raigam) and each bill */
export function ClaimDialog({ claim, onClose }: { claim: FreeClaim | null; onClose: () => void }) {
  const sales = useAppStore((s) => s.sales);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const saleMap = useMemo(() => new Map(sales.map((s) => [s.id, s])), [sales]);
  const perItem = useMemo(() => {
    const map = new Map<string, { sapCode: string; bills: number; qty: number; value: number }>();
    for (const l of claim?.lines ?? []) {
      const row = map.get(l.sapCode) ?? { sapCode: l.sapCode, bills: 0, qty: 0, value: 0 };
      row.bills += 1;
      row.qty += l.qty;
      row.value = round2(row.value + l.value);
      map.set(l.sapCode, row);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty);
  }, [claim]);

  return (
    <Modal
      open={claim !== null}
      onClose={onClose}
      size="lg"
      title={`Free issue claim ${claim?.claimNo ?? ""}`}
      description="Free issue claimed back from Raigam."
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {claim && (
        <div className="flex flex-col gap-5">
          <dl className="grid gap-4 sm:grid-cols-4">
            <Detail label="Claim date">{formatDate(claim.date)}</Detail>
            <Detail label="Raigam reference">{claim.reference || "—"}</Detail>
            <Detail label="Claim value">{formatMoney(claimValue(claim))}</Detail>
            <Detail label="Status">
              <ClaimStatusBadge claim={claim} />
            </Detail>
          </dl>
          {isClaimPaid(claim) && (
            <p className="text-sm text-slate-600">
              Paid <span className="font-semibold text-slate-900">{formatMoney(claim.paidAmount)}</span> on {formatDate(claim.paidDate)}
              {claim.paidReference && ` · ref. ${claim.paidReference}`}
            </p>
          )}
          {claim.notes && (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-900">Note:</span> {claim.notes}
            </p>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">By item</p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <Table>
                <THead>
                  <tr>
                    <TH>Item</TH>
                    <TH className="text-right">Bills</TH>
                    <TH className="text-right">Free Qty</TH>
                    <TH className="text-right">Free Value</TH>
                  </tr>
                </THead>
                <TBody>
                  {perItem.map((r) => (
                    <TR key={r.sapCode}>
                      <TD className="whitespace-normal">
                        <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? "Unknown item"}</span>
                        <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{formatQty(r.bills)}</TD>
                      <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.qty)}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(r.value)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Bills ({claimBillCount(claim)})</p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <Table>
                <THead>
                  <tr>
                    <TH>Bill No.</TH>
                    <TH>Store</TH>
                    <TH>Item</TH>
                    <TH className="text-right">Free Qty</TH>
                    <TH className="text-right">Free Value</TH>
                  </tr>
                </THead>
                <TBody>
                  {claim.lines.map((l) => {
                    const sale = saleMap.get(l.saleId);
                    return (
                      <TR key={`${l.saleId}|${l.sapCode}`}>
                        <TD>
                          {sale ? (
                            <Link href={`/sales/${sale.id}`} className="font-medium text-brand-700 hover:underline">
                              {sale.saleNo}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {sale?.deliveredDate && <span className="block text-xs text-slate-500">Delivered {formatDate(sale.deliveredDate)}</span>}
                        </TD>
                        <TD className="whitespace-normal">{sale ? (shopMap.get(sale.shopId)?.shopName ?? "—") : "—"}</TD>
                        <TD className="whitespace-normal">
                          <span className="block font-medium text-slate-900">{itemMap.get(l.sapCode)?.description ?? "Unknown item"}</span>
                          <span className="block font-mono text-xs text-slate-500">{l.sapCode}</span>
                        </TD>
                        <TD className="text-right tabular-nums">{formatQty(l.qty)}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(l.value)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            <p className="mt-2 text-right text-sm text-slate-600">
              {formatQty(claimUnits(claim))} units · <span className="font-semibold text-slate-900">{formatMoney(claimValue(claim))}</span>
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ClaimPaidForm({ claim, onDone }: { claim: FreeClaim; onDone: () => void }) {
  const setFreeClaimPaid = useAppStore((s) => s.setFreeClaimPaid);
  const [paidDate, setPaidDate] = useState(claim.paidDate || todayISO());
  const [amount, setAmount] = useState(String(isClaimPaid(claim) ? claim.paidAmount : claimValue(claim)));
  const [reference, setReference] = useState(claim.paidReference);
  const [error, setError] = useState<string>();

  async function save(paid: boolean) {
    const n = toNumber(amount);
    let err: string | undefined;
    if (paid && !paidDate) err = "Enter the date Raigam paid.";
    else if (paid && (amount.trim() === "" || n < 0)) err = "Enter the amount Raigam paid.";
    setError(err);
    if (err) return;
    const result = await setFreeClaimPaid(claim.id, paid ? { paidDate, paidAmount: n, paidReference: reference } : { paidDate: "", paidAmount: 0, paidReference: "" });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(paid ? `${claim.claimNo} marked paid` : `${claim.claimNo} is not paid`);
    onDone();
  }

  return (
    <form
      id="claim-paid-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(true);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-slate-600">
        Claimed <span className="font-semibold text-slate-900">{formatMoney(claimValue(claim))}</span> on {formatDate(claim.date)}.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date paid" htmlFor="fcPaidDate" required>
          <Input id="fcPaidDate" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
        <Field label="Amount paid" htmlFor="fcPaidAmount" required hint="Change it if Raigam paid a different amount">
          <Input id="fcPaidAmount" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <Field label="Reference" htmlFor="fcPaidRef" hint="Credit note or payment no., if any">
        <Input id="fcPaidRef" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
      </Field>
      {isClaimPaid(claim) && (
        <button type="button" onClick={() => void save(false)} className="self-start text-sm font-medium text-red-600 hover:underline">
          Mark as not paid
        </button>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** Record that Raigam paid a claim back */
export function ClaimPaidDialog({ claim, onClose }: { claim: FreeClaim | null; onClose: () => void }) {
  return (
    <Modal
      open={claim !== null}
      onClose={onClose}
      title={`Raigam paid ${claim?.claimNo ?? ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="claim-paid-form">
            Save
          </Button>
        </>
      }
    >
      {claim && <ClaimPaidForm key={claim.id} claim={claim} onDone={onClose} />}
    </Modal>
  );
}
