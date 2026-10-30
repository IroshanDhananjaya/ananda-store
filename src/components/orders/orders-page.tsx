"use client";

import { Eye, PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { OrderStatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateRangePicker, inDateRange, type DateRange } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore } from "@/lib/store";
import type { Order, OrderStatus } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { CHEQUE_REMIND_DAYS, cn, daysUntil, formatDate, formatMoney, formatQty, includesText, invoiceNumbersOf, orderStatus, RAIGAM_CHEQUE_DAYS, raigamChequeDate } from "@/lib/utils";
import { ChequeDepositDate, OrderPaymentSummary } from "./order-payment";

type StatusFilter = "all" | OrderStatus;
/** Which date the date range filters on */
type DateBy = "order" | "received";

export function OrdersPage() {
  const router = useRouter();
  const orders = useAppStore((s) => s.orders);
  const orderItems = useAppStore((s) => s.orderItems);
  const orderInvoices = useAppStore((s) => s.orderInvoices);
  const deleteOrder = useAppStore((s) => s.deleteOrder);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  const [dateBy, setDateBy] = useState<DateBy>("order");
  const remove = useDialog<Order>();

  const qtyByOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of orderItems) map.set(l.orderId, (map.get(l.orderId) ?? 0) + l.orderedQty);
    return map;
  }, [orderItems]);

  // The status tabs count orders in the chosen dates
  const datedOrders = orders.filter((o) => inDateRange(dateBy === "received" ? o.receivedDate : o.orderDate, range));
  const statusOf = (o: Order) => orderStatus(o, orderItems);
  const counts: Record<OrderStatus, number> = { Pending: 0, Received: 0, Partial: 0, Posted: 0 };
  for (const o of datedOrders) counts[statusOf(o)]++;
  // An order can come on several Raigam invoices
  const invoicesOf = (o: Order) => orderInvoices.filter((i) => i.orderId === o.orderId);
  // Some items in stock: locked like a posted order
  const locked = (o: Order) => statusOf(o) === "Posted" || statusOf(o) === "Partial";
  // The cheque is deposited within the reminder days, or late with nothing paid
  const depositSoon = (o: Order) => {
    const date = raigamChequeDate(o);
    return !!date && daysUntil(date) <= CHEQUE_REMIND_DAYS && (daysUntil(date) >= 0 || !o.paymentMethod);
  };

  const rows = datedOrders
    .filter((o) => status === "all" || statusOf(o) === status || (status === "Received" && statusOf(o) === "Partial"))
    .filter((o) =>
      includesText([o.orderId, ...invoicesOf(o).flatMap((i) => [i.invoiceNumber, i.poNumber, i.company]), o.chequeNumber, o.paymentReference], query),
    )
    .sort((a, b) => b.orderId.localeCompare(a.orderId));
  const billTotal = rows.reduce((sum, o) => sum + o.totalBillAmount, 0);
  const notPaid = rows.reduce((sum, o) => sum + (o.paymentMethod ? 0 : o.totalBillAmount), 0);

  const pager = usePagination(rows, [query, status, range, dateBy]);

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        description="Orders placed with Raigam (your “Order Details” sheet): track delivery, cheque payment and stock posting."
        actions={
          <>
            <Link href="/orders/new" className={buttonClass("outline")}>
              <Plus /> New order
            </Link>
            <Link href="/orders/receive" className={buttonClass()}>
              <PackagePlus /> Receive new load
            </Link>
          </>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search order, invoice, PO or cheque no." value={query} onChange={(e) => setQuery(e.target.value)} />
          <DateRangePicker value={range} onChange={setRange} />
          <Select value={dateBy} onChange={(e) => setDateBy(e.target.value as DateBy)} className="h-9 sm:w-44" aria-label="Which date to use">
            <option value="order">By order date</option>
            <option value="received">By received date</option>
          </Select>
          <div className="sm:ml-auto">
            <FilterTabs<StatusFilter>
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All", count: datedOrders.length },
                { value: "Pending", label: "Pending delivery", count: counts.Pending },
                { value: "Received", label: "Received", count: counts.Received + counts.Partial },
                { value: "Posted", label: "Posted", count: counts.Posted },
              ]}
            />
          </div>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Order ID</TH>
              <TH title="Invoice Number / PO Number">Invoice / PO No.</TH>
              <TH>Order Date</TH>
              <TH title="Order Received Date / Time">Received</TH>
              <TH title="How the bill was paid">Payment</TH>
              <TH title={`The day Raigam deposits the cheque: ${RAIGAM_CHEQUE_DAYS} days after the goods came, or the date on the cheque`}>Cheque Deposit</TH>
              <TH className="text-right" title="Total Item Quantity">Total Qty</TH>
              <TH className="text-right" title="Total Bill Amount">Bill Amount</TH>
              <TH>Status</TH>
              <TH className="w-28">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={10}>No orders found.</EmptyRow>}
            {pager.pageRows.map((o) => (
              <TR key={o.id} className={cn("cursor-pointer", depositSoon(o) && "bg-amber-50/60")} onClick={() => router.push(`/orders/${o.id}`)}>
                <TD className="font-semibold text-brand-700">{o.orderId}</TD>
                <TD className="max-w-52 whitespace-normal">
                  {invoiceNumbersOf(o, orderInvoices) || <span className="text-slate-400">—</span>}
                  {invoicesOf(o).length > 1 && <span className="block text-xs text-slate-500">{invoicesOf(o).length} invoices</span>}
                  {[...new Set(invoicesOf(o).map((i) => i.poNumber).filter(Boolean))].map((po) => (
                    <span key={po} className="block text-xs text-slate-500">
                      PO {po}
                    </span>
                  ))}
                </TD>
                <TD className="tabular-nums">{formatDate(o.orderDate)}</TD>
                <TD className="tabular-nums">
                  {o.receivedDate ? (
                    <>
                      {formatDate(o.receivedDate)}
                      <span className="block text-xs text-slate-500">{o.receivedTime || "—"}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">Not received</span>
                  )}
                </TD>
                <TD className="tabular-nums">
                  <OrderPaymentSummary order={o} />
                </TD>
                <TD>
                  <ChequeDepositDate order={o} />
                </TD>
                <TD className="text-right tabular-nums">{formatQty(qtyByOrder.get(o.orderId) ?? 0)}</TD>
                <TD className="text-right font-medium text-slate-900 tabular-nums">{formatMoney(o.totalBillAmount)}</TD>
                <TD>
                  <OrderStatusBadge status={statusOf(o)} />
                </TD>
                <TD onClick={(e) => e.stopPropagation()}>
                  <RowActions>
                    <Link href={`/orders/${o.id}`} className={buttonClass("ghost", "icon")} aria-label={`View ${o.orderId}`} title="View">
                      <Eye />
                    </Link>
                    {!locked(o) && (
                      <>
                        <Link
                          href={`/orders/${o.id}/edit`}
                          className={buttonClass("ghost", "icon")}
                          aria-label={`Edit ${o.orderId}`}
                          title="Edit"
                        >
                          <Pencil />
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-red-50 hover:text-red-600"
                          onClick={() => remove.open(o)}
                          aria-label={`Delete ${o.orderId}`}
                          title="Delete"
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </RowActions>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length === orders.length ? orders.length : `${rows.length} of ${orders.length}`} orders ·{" "}
          <span className="font-medium text-slate-700">{formatMoney(billTotal)}</span> in bills
          {notPaid > 0 && (
            <>
              {" "}
              · <span className="font-medium text-amber-700">{formatMoney(notPaid)} not paid</span>
            </>
          )}{" "}
          · Posted orders are locked; reverse the posting to edit them (payments can still be recorded).
        </TableFooter>
      </Card>

      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title={`Delete ${remove.target?.orderId}?`}
        message="The order and all of its item lines will be deleted. This cannot be undone."
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteOrder(remove.target.id);
          if (result.ok) toast.success(`${remove.target.orderId} deleted`);
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
