"use client";

import { ClipboardCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LineStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, toNumber } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { StackBox } from "@/components/ui/table";
import { useAppStore, useItemMap } from "@/lib/store";
import type { Order, OrderItem } from "@/lib/types";
import { formatQty, nowTime, paymentOf, todayISO } from "@/lib/utils";

// ---------- Receive order: record delivery date/time and received quantities ----------

type ReceiveLine = Pick<OrderItem, "id" | "itemCode" | "orderedQty" | "unitPrice" | "discount"> & { receivedQty: string; remarks: string };

function ReceiveForm({ order, lines, onDone }: { order: Order; lines: OrderItem[]; onDone: () => void }) {
  const updateOrder = useAppStore((s) => s.updateOrder);
  const itemMap = useItemMap();
  const [date, setDate] = useState(order.receivedDate || todayISO());
  const [time, setTime] = useState(order.receivedTime || nowTime());
  const [rows, setRows] = useState<ReceiveLine[]>(() =>
    lines.map((l) => ({
      id: l.id,
      itemCode: l.itemCode,
      orderedQty: l.orderedQty,
      unitPrice: l.unitPrice,
      discount: l.discount,
      // First time receiving: assume everything arrived, adjust if not
      receivedQty: String(order.receivedDate ? l.receivedQty : l.orderedQty),
      remarks: l.remarks,
    })),
  );
  const [error, setError] = useState<string>();

  const update = (id: string, patch: Partial<ReceiveLine>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date) return setError("Enter the received date.");
    const bad = rows.find((r) => r.receivedQty === "" || !Number.isInteger(Number(r.receivedQty)) || Number(r.receivedQty) < 0);
    if (bad) return setError(`Received quantity for ${bad.itemCode} must be a whole number (0 or more).`);

    const result = await updateOrder(
      order.id,
      {
        invoiceNumber: order.invoiceNumber,
        poNumber: order.poNumber,
        orderDate: order.orderDate,
        ...paymentOf(order),
        totalBillAmount: order.totalBillAmount,
        discountPercent: order.discountPercent,
        receivedDate: date,
        receivedTime: time,
      },
      rows.map((r) => ({
        itemCode: r.itemCode,
        orderedQty: r.orderedQty,
        receivedQty: toNumber(r.receivedQty),
        unitPrice: r.unitPrice,
        discount: r.discount,
        remarks: r.remarks,
      })),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const unmatched = rows.filter((r) => toNumber(r.receivedQty) !== r.orderedQty).length;
    if (unmatched) toast.warning(`${order.orderId} received with ${unmatched} unmatched item${unmatched > 1 ? "s" : ""}`);
    else toast.success(`${order.orderId} received — all items match`);
    onDone();
  }

  return (
    <form id="receive-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Order Received Date" htmlFor="rcvDate" required>
          <Input id="rcvDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Order Received Time" htmlFor="rcvTime">
          <Input id="rcvTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Count what arrived</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRows((rs) => rs.map((r) => ({ ...r, receivedQty: String(r.orderedQty) })))}
        >
          <ClipboardCheck /> Received = Ordered
        </Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <StackBox>
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="w-28 px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <span className="block font-medium text-slate-900">{itemMap.get(r.itemCode)?.description ?? r.itemCode}</span>
                    <span className="font-mono text-xs text-slate-500">{r.itemCode}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQty(r.orderedQty)}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={r.receivedQty}
                      onChange={(e) => update(r.id, { receivedQty: e.target.value })}
                      className="h-9 text-right tabular-nums"
                      aria-label={`Received quantity for ${r.itemCode}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <LineStatusBadge status={toNumber(r.receivedQty) === r.orderedQty ? "Match" : "Unmatch"} />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={r.remarks}
                      onChange={(e) => update(r.id, { remarks: e.target.value })}
                      placeholder="e.g. 2 damaged"
                      className="h-9 min-w-36"
                      aria-label={`Remarks for ${r.itemCode}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StackBox>
      </div>
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
      size="lg"
      title={`Receive ${order.orderId}`}
      description="Record when the delivery arrived and how much of each item was received."
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

// ---------- Post to stock: add received quantities to Store Details ----------

function PostForm({ order, lines, onDone }: { order: Order; lines: OrderItem[]; onDone: () => void }) {
  const stock = useAppStore((s) => s.stock);
  const locations = useAppStore((s) => s.locations);
  const postOrderToStock = useAppStore((s) => s.postOrderToStock);
  const itemMap = useItemMap();
  const postable = lines.filter((l) => l.receivedQty > 0);

  // Default each item to its stock location, else to where it is already stored, if anywhere
  const [locationByLine, setLocationByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      postable.map((l) => [l.id, itemMap.get(l.itemCode)?.locationNumber || (stock.find((r) => r.sapCode === l.itemCode)?.locationNumber ?? "")]),
    ),
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await postOrderToStock(order.id, locationByLine);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const total = postable.reduce((s, l) => s + l.receivedQty, 0);
    toast.success(`${formatQty(total)} units from ${order.orderId} added to stock`);
    onDone();
  }

  return (
    <form id="post-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      {postable.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing was received on this order, so there is nothing to add to stock.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <StackBox>
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">In stock now</th>
                  <th className="px-3 py-2">Store Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {postable.map((l) => {
                  const loc = locationByLine[l.id];
                  const current = stock.find((r) => r.sapCode === l.itemCode && r.locationNumber === loc)?.availableQty ?? 0;
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2">
                        <span className="block font-medium text-slate-900">{itemMap.get(l.itemCode)?.description ?? l.itemCode}</span>
                        <span className="font-mono text-xs text-slate-500">{l.itemCode}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">+{formatQty(l.receivedQty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {loc ? `${formatQty(current)} → ${formatQty(current + l.receivedQty)}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={loc}
                          onChange={(e) => setLocationByLine((m) => ({ ...m, [l.id]: e.target.value }))}
                          className="h-9 min-w-44"
                          aria-label={`Store location for ${l.itemCode}`}
                          aria-invalid={!loc}
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
      )}
      <p className="text-xs text-slate-500">
        Once posted, the order is locked. You can reverse the posting later if something was entered wrongly.
      </p>
    </form>
  );
}

export function PostToStockDialog({
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
      size="lg"
      title={`Post ${order.orderId} to stock`}
      description="Received quantities will be added to Available QTY in Stock."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="post-form" disabled={!lines.some((l) => l.receivedQty > 0)}>
            Add to stock
          </Button>
        </>
      }
    >
      <PostForm order={order} lines={lines} onDone={onClose} />
    </Modal>
  );
}
