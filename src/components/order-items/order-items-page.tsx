"use client";

import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LineStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, ReadOnlyValue, Select, toNumber } from "@/components/ui/form";
import { SearchSelect } from "@/components/ui/search-select";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap, useOrderMap } from "@/lib/store";
import type { LineStatus, OrderItem } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatMoney, formatQty, includesText, lineStatus, orderLineValue } from "@/lib/utils";

type StatusFilter = "all" | LineStatus;
type Values = { orderId: string; itemCode: string; orderedQty: string; receivedQty: string; unitPrice: string; discount: string; remarks: string };

const isWhole = (v: string) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;

function OrderItemForm({ line, onDone }: { line: OrderItem | null; onDone: () => void }) {
  const orders = useAppStore((s) => s.orders);
  const items = useAppStore((s) => s.items);
  const addOrderItem = useAppStore((s) => s.addOrderItem);
  const updateOrderItem = useAppStore((s) => s.updateOrderItem);
  const itemMap = useItemMap();
  const orderMap = useOrderMap();
  const [values, setValues] = useState<Values>(() => ({
    orderId: line?.orderId ?? "",
    itemCode: line?.itemCode ?? "",
    orderedQty: line ? String(line.orderedQty) : "",
    receivedQty: line ? String(line.receivedQty) : "0",
    unitPrice: line ? String(line.unitPrice) : "",
    discount: line ? String(line.discount) : "0",
    remarks: line?.remarks ?? "",
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const openOrders = orders.filter((o) => !o.postedToStock).sort((a, b) => b.orderId.localeCompare(a.orderId));
  const selectedOrder = orderMap.get(values.orderId);
  const status: LineStatus = !selectedOrder?.receivedDate
    ? "Pending"
    : toNumber(values.orderedQty) === toNumber(values.receivedQty)
      ? "Match"
      : "Unmatch";
  const value = orderLineValue(
    {
      orderedQty: toNumber(values.orderedQty),
      receivedQty: toNumber(values.receivedQty),
      unitPrice: toNumber(values.unitPrice),
      discount: toNumber(values.discount),
    },
    selectedOrder,
  );

  // A new line starts at the item's cost price
  function pickItem(itemCode: string) {
    setValues((v) => ({ ...v, itemCode, unitPrice: v.unitPrice === "" ? String(itemMap.get(itemCode)?.costPrice ?? "") : v.unitPrice }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.orderId) next.orderId = "Select an order.";
    if (!values.itemCode) next.itemCode = "Select an item.";
    if (!isWhole(values.orderedQty) || toNumber(values.orderedQty) === 0) next.orderedQty = "Whole number above 0.";
    if (!isWhole(values.receivedQty)) next.receivedQty = "Whole number, 0 or more.";
    if (values.unitPrice === "" || toNumber(values.unitPrice) < 0) next.unitPrice = "Enter a price of 0 or more.";
    if (toNumber(values.discount) < 0) next.discount = "0 or more.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = {
      orderId: values.orderId,
      itemCode: values.itemCode,
      orderedQty: toNumber(values.orderedQty),
      receivedQty: toNumber(values.receivedQty),
      unitPrice: toNumber(values.unitPrice),
      discount: toNumber(values.discount),
      remarks: values.remarks,
    };
    const result = await (line ? updateOrderItem(line.id, input) : addOrderItem(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(line ? "Order item updated" : "Order item added");
    onDone();
  }

  return (
    <form id="order-item-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Order ID" htmlFor="oi-order" required error={errors.orderId} hint="Only orders not yet posted to stock.">
        <Select id="oi-order" value={values.orderId} onChange={set("orderId")} aria-invalid={!!errors.orderId} autoFocus>
          <option value="">Select an order…</option>
          {openOrders.map((o) => (
            <option key={o.id} value={o.orderId}>
              {o.orderId}
              {o.invoiceNumber ? ` · ${o.invoiceNumber}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Item Code" htmlFor="oi-item" required error={errors.itemCode}>
        <SearchSelect
          id="oi-item"
          value={values.itemCode}
          onChange={pickItem}
          options={items.map((i) => ({ value: i.sapCode, label: i.sapCode, description: i.description, hint: i.packageDetails }))}
          placeholder="Select an item…"
          aria-invalid={!!errors.itemCode}
        />
      </Field>
      <Field label="Item Name" className="sm:col-span-2">
        <ReadOnlyValue>{itemMap.get(values.itemCode)?.description ?? "—"}</ReadOnlyValue>
      </Field>
      <Field label="Ordered Quantity" htmlFor="oi-ordered" required error={errors.orderedQty}>
        <Input id="oi-ordered" type="number" min={1} step={1} inputMode="numeric" value={values.orderedQty} onChange={set("orderedQty")} aria-invalid={!!errors.orderedQty} />
      </Field>
      <Field label="Received Quantity" htmlFor="oi-received" required error={errors.receivedQty}>
        <Input id="oi-received" type="number" min={0} step={1} inputMode="numeric" value={values.receivedQty} onChange={set("receivedQty")} aria-invalid={!!errors.receivedQty} />
      </Field>
      <Field label="Price (Rs.)" htmlFor="oi-price" required error={errors.unitPrice} hint="Per unit, from the invoice">
        <Input id="oi-price" type="number" min={0} step="0.01" inputMode="decimal" value={values.unitPrice} onChange={set("unitPrice")} aria-invalid={!!errors.unitPrice} />
      </Field>
      <Field label="Discount (Rs.)" htmlFor="oi-discount" error={errors.discount} hint={`Line value ${formatMoney(value)}`}>
        <Input id="oi-discount" type="number" min={0} step="0.01" inputMode="decimal" value={values.discount} onChange={set("discount")} aria-invalid={!!errors.discount} />
      </Field>
      <Field label="Match / Unmatch" hint="Calculated from the quantities once the order is received.">
        <div className="flex h-10 items-center">
          <LineStatusBadge status={status} />
        </div>
      </Field>
      <Field label="Remarks" htmlFor="oi-remarks">
        <Input id="oi-remarks" value={values.remarks} onChange={set("remarks")} placeholder="Optional" />
      </Field>
    </form>
  );
}

export function OrderItemsPage() {
  const orderItems = useAppStore((s) => s.orderItems);
  const deleteOrderItem = useAppStore((s) => s.deleteOrderItem);
  const orders = useAppStore((s) => s.orders);
  const itemMap = useItemMap();
  const orderMap = useOrderMap();
  const [query, setQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const form = useDialog<OrderItem | "new">();
  const remove = useDialog<OrderItem>();

  const withStatus = orderItems.map((l) => ({ line: l, order: orderMap.get(l.orderId), status: lineStatus(l, orderMap.get(l.orderId)) }));
  const count = (s: LineStatus) => withStatus.filter((r) => r.status === s).length;

  const rows = withStatus
    .filter((r) => !orderFilter || r.line.orderId === orderFilter)
    .filter((r) => status === "all" || r.status === status)
    .filter((r) => includesText([r.line.orderId, r.line.itemCode, itemMap.get(r.line.itemCode)?.description, r.line.remarks], query))
    .sort((a, b) => b.line.orderId.localeCompare(a.line.orderId) || a.line.itemCode.localeCompare(b.line.itemCode));

  const editing = form.target === "new" ? null : form.target;

  const pager = usePagination(rows, [query, orderFilter, status]);

  return (
    <>
      <PageHeader
        title="Order Items"
        description="Every item line across all orders: check ordered vs received quantities."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Add order item
          </Button>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search item, order or remarks" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)} className="h-9 sm:w-44" aria-label="Filter by order">
            <option value="">All orders</option>
            {[...orders]
              .sort((a, b) => b.orderId.localeCompare(a.orderId))
              .map((o) => (
                <option key={o.id} value={o.orderId}>
                  {o.orderId}
                </option>
              ))}
          </Select>
          <div className="sm:ml-auto">
            <FilterTabs<StatusFilter>
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All", count: orderItems.length },
                { value: "Match", label: "Match", count: count("Match") },
                { value: "Unmatch", label: "Unmatch", count: count("Unmatch") },
                { value: "Pending", label: "Pending", count: count("Pending") },
              ]}
            />
          </div>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Order ID</TH>
              <TH>Item Code</TH>
              <TH>Item Name</TH>
              <TH className="text-right">Ordered Qty</TH>
              <TH className="text-right">Received Qty</TH>
              <TH className="text-right">Price</TH>
              <TH className="text-right" title="Qty × price − discount">
                Value
              </TH>
              <TH>Match / Unmatch</TH>
              <TH>Remarks</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={10}>No order items found.</EmptyRow>}
            {pager.pageRows.map(({ line, order, status: s }) => {
              const locked = !!order?.postedToStock;
              return (
                <TR key={line.id} className={cn(s === "Unmatch" && "bg-red-50/40")}>
                  <TD>
                    {order ? (
                      <Link href={`/orders/${order.id}`} className="font-semibold text-brand-700 hover:underline">
                        {line.orderId}
                      </Link>
                    ) : (
                      line.orderId
                    )}
                  </TD>
                  <TD className="font-mono text-xs font-medium text-slate-900">{line.itemCode}</TD>
                  <TD className="min-w-40 font-medium whitespace-normal text-slate-900">
                    {itemMap.get(line.itemCode)?.description ?? "Unknown item"}
                  </TD>
                  <TD className="text-right tabular-nums">{formatQty(line.orderedQty)}</TD>
                  <TD className="text-right tabular-nums">{formatQty(line.receivedQty)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(line.unitPrice)}</TD>
                  <TD className="text-right tabular-nums">
                    <span className="block font-medium text-slate-900">{formatMoney(orderLineValue(line, order))}</span>
                    {line.discount > 0 && <span className="block text-xs text-slate-500">− {formatMoney(line.discount)} disc.</span>}
                  </TD>
                  <TD>
                    <LineStatusBadge status={s} />
                  </TD>
                  <TD className="max-w-48 min-w-32 whitespace-normal">
                    {line.remarks || <span className="text-slate-400">—</span>}
                  </TD>
                  <TD>
                    <RowActions>
                      {locked ? (
                        <span className="inline-flex items-center gap-1 px-2 text-xs text-slate-400" title="Order is posted to stock">
                          <Lock className="size-3.5" /> Posted
                        </span>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => form.open(line)} aria-label={`Edit ${line.itemCode} in ${line.orderId}`}>
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-red-50 hover:text-red-600"
                            onClick={() => remove.open(line)}
                            aria-label={`Delete ${line.itemCode} from ${line.orderId}`}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </RowActions>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length === orderItems.length ? orderItems.length : `${rows.length} of ${orderItems.length}`} lines
        </TableFooter>
      </Card>

      <Modal
        open={form.isOpen}
        onClose={form.close}
        title={editing ? "Edit order item" : "Add order item"}
        description={editing ? `${editing.itemCode} in ${editing.orderId}` : "Add an item line to an existing order."}
        footer={
          <>
            <Button variant="outline" onClick={form.close}>
              Cancel
            </Button>
            <Button type="submit" form="order-item-form">
              {editing ? "Save changes" : "Add item"}
            </Button>
          </>
        }
      >
        <OrderItemForm key={editing?.id ?? "new"} line={editing} onDone={form.close} />
      </Modal>

      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title="Delete order item?"
        message={
          <>
            <span className="font-medium text-slate-900">{remove.target?.itemCode}</span> will be removed from{" "}
            {remove.target?.orderId}.
          </>
        }
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteOrderItem(remove.target.id);
          if (result.ok) toast.success("Order item deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
