"use client";

import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Detail } from "@/components/ui/layout";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ReturnKindBadge } from "@/components/sales/return-items";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import Link from "next/link";
import { formatUnits, returnStock, type SentFromBill } from "@/lib/returns";
import { useAppStore, useItemMap, useShopMap } from "@/lib/store";
import type { RaigamReturn } from "@/lib/types";
import { formatDate, formatQty, todayISO } from "@/lib/utils";

const isWhole = (v: string) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0);

function SendReturnsForm({ onDone }: { onDone: () => void }) {
  const sales = useAppStore((s) => s.sales);
  const raigamReturns = useAppStore((s) => s.raigamReturns);
  const sendReturnsToRaigam = useAppStore((s) => s.sendReturnsToRaigam);
  const itemMap = useItemMap();
  // Everything in Return Items, ready to send in full (change a qty to send part of it)
  const held = useMemo(
    () => [...returnStock(sales, raigamReturns).values()].filter((r) => r.held > 0).sort((a, b) => a.sapCode.localeCompare(b.sapCode) || a.kind.localeCompare(b.kind)),
    [sales, raigamReturns],
  );
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(held.map((r) => [r.key, String(r.held)])));
  const [date, setDate] = useState(todayISO);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const units = held.reduce((sum, r) => sum + (isWhole(qty[r.key] ?? "") ? Number(qty[r.key] || 0) : 0), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const bad = held.find((r) => !isWhole(qty[r.key] ?? "") || Number(qty[r.key] || 0) > r.held);
    let err: string | undefined;
    if (!date) err = "Enter the date they were sent.";
    else if (bad) err = `${bad.sapCode} (${bad.kind.toLowerCase()} return): send a whole number from 0 to ${bad.held}.`;
    else if (units === 0) err = "Enter how many of each item you're sending.";
    setError(err);
    if (err) return;
    const result = await sendReturnsToRaigam({
      date,
      reference,
      notes,
      lines: held.map((r) => ({ kind: r.kind, sapCode: r.sapCode, qty: Number(qty[r.key] || 0) })).filter((l) => l.qty > 0),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const note = useAppStore.getState().raigamReturns.find((r) => r.id === result.id);
    toast.success(`${note?.returnNo ?? "Return note"} saved · ${formatUnits(units)} sent to Raigam`);
    onDone();
  }

  return (
    <form
      id="send-returns-form"
      onSubmit={handleSubmit}
      // Enter in a qty box doesn't save the note by accident
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date sent" htmlFor="rnDate" required>
          <Input id="rnDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Raigam reference" htmlFor="rnRef" hint="Their return / credit note no., if you have it">
          <Input id="rnRef" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-700">What you&apos;re sending</p>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setQty(Object.fromEntries(held.map((r) => [r.key, String(r.held)])))}>
              All
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setQty({})}>
              None
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <Table>
            <THead>
              <tr>
                <TH>Item</TH>
                <TH>Type</TH>
                <TH className="text-right">In Return Items</TH>
                <TH className="w-32 text-right">Send</TH>
              </tr>
            </THead>
            <TBody>
              {held.length === 0 && <EmptyRow colSpan={4}>Nothing in Return Items to send.</EmptyRow>}
              {held.map((r) => (
                <TR key={r.key}>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? "Unknown item"}</span>
                    <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                  </TD>
                  <TD>
                    <ReturnKindBadge kind={r.kind} />
                  </TD>
                  <TD className="text-right tabular-nums">{formatQty(r.held)}</TD>
                  <TD>
                    <Input
                      type="number"
                      min={0}
                      max={r.held}
                      step={1}
                      inputMode="numeric"
                      value={qty[r.key] ?? ""}
                      placeholder="0"
                      onChange={(e) => {
                        setQty((q) => ({ ...q, [r.key]: e.target.value }));
                        setError(undefined);
                      }}
                      aria-label={`Send qty of ${r.sapCode} (${r.kind} return)`}
                      className="h-9 text-right tabular-nums"
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <p className="mt-2 text-right text-sm text-slate-600">
          Sending <span className="font-semibold text-slate-900 tabular-nums">{formatUnits(units)}</span>
        </p>
      </div>

      <Field label="Note" htmlFor="rnNotes">
        <Textarea id="rnNotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional, e.g. lorry number or who took them" />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** Send return items back to Raigam: saved as a return note, and they leave Return Items */
export function SendReturnsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Send return items to Raigam"
      description="Saves a return note and takes the items out of Return Items."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="send-returns-form">
            Save return note
          </Button>
        </>
      }
    >
      <SendReturnsForm onDone={onClose} />
    </Modal>
  );
}

/** What went back to Raigam on one return note */
export function ReturnNoteDialog({ note, onClose, fromBills = [] }: { note: RaigamReturn | null; onClose: () => void; fromBills?: SentFromBill[] }) {
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const units = note?.lines.reduce((sum, l) => sum + l.qty, 0) ?? 0;
  return (
    <Modal
      open={note !== null}
      onClose={onClose}
      size="lg"
      title={`Return note ${note?.returnNo ?? ""}`}
      description="Return items sent back to Raigam."
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {note && (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Date sent">{formatDate(note.date)}</Detail>
            <Detail label="Raigam reference">{note.reference || "—"}</Detail>
            <Detail label="Units">{formatQty(units)}</Detail>
          </dl>
          {note.notes && (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-900">Note:</span> {note.notes}
            </p>
          )}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Qty</TH>
                </tr>
              </THead>
              <TBody>
                {note.lines.map((l) => (
                  <TR key={`${l.kind}|${l.sapCode}`}>
                    <TD className="whitespace-normal">
                      <span className="block font-medium text-slate-900">{itemMap.get(l.sapCode)?.description ?? "Unknown item"}</span>
                      <span className="block font-mono text-xs text-slate-500">{l.sapCode}</span>
                    </TD>
                    <TD>
                      <ReturnKindBadge kind={l.kind} />
                    </TD>
                    <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(l.qty)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {fromBills.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">From bills</p>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <THead>
                    <tr>
                      <TH>Bill No.</TH>
                      <TH>Store</TH>
                      <TH>Item</TH>
                      <TH>Type</TH>
                      <TH className="text-right">Qty</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {fromBills.map((b) => {
                      const ret = b.sale.returns.find((r) => r.id === b.returnId);
                      return (
                        <TR key={`${b.sale.id}|${b.returnId}`}>
                          <TD>
                            <Link href={`/sales/${b.sale.id}`} className="font-medium text-brand-700 hover:underline">
                              {b.sale.saleNo}
                            </Link>
                            <span className="block text-xs text-slate-500">Delivered {formatDate(b.sale.deliveredDate)}</span>
                          </TD>
                          <TD className="whitespace-normal">{shopMap.get(b.sale.shopId)?.shopName ?? "—"}</TD>
                          <TD className="whitespace-normal">
                            <span className="block font-medium text-slate-900">{ret ? (itemMap.get(ret.sapCode)?.description ?? "Unknown item") : "—"}</span>
                            <span className="block font-mono text-xs text-slate-500">{ret?.sapCode}</span>
                          </TD>
                          <TD>{ret && <ReturnKindBadge kind={ret.kind} />}</TD>
                          <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(b.qty)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-slate-500">Return notes only record units per item, so they&apos;re matched to the oldest delivered bills first.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
