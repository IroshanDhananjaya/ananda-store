"use client";

import { Eye, PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { orderLabel, OrderStatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateRangePicker, inDateRange, type DateRange } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/form";
import { Card, ClearFilters, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR, useRowSort } from "@/components/ui/table";
import { useAppStore } from "@/lib/store";
import type { Order, OrderStatus } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { CHEQUE_REMIND_DAYS, cn, daysUntil, formatDate, formatMoney, formatQty, includesText, invoiceNumbersOf, orderStatus, paidByInvoice, RAIGAM_CHEQUE_DAYS, raigamChequeDate, raigamPayments } from "@/lib/utils";
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
  // Its payments: the order's one, or each invoice's when they're paid one by one
  const paymentsOf = (o: Order) => raigamPayments([o], orderInvoices, orderItems);
  // A cheque is deposited within the reminder days, or late with nothing paid
  const depositSoon = (o: Order) =>
    paymentsOf(o).some((p) => {
      const date = raigamChequeDate(p);
      return !!date && daysUntil(date) <= CHEQUE_REMIND_DAYS && (daysUntil(date) >= 0 || !p.paymentMethod);
    });
  // The next cheque to watch: the soonest still to deposit, or the soonest late with nothing paid
  const nextCheque = (o: Order) =>
    paymentsOf(o)
      .map((p) => ({ p, date: raigamChequeDate(p) }))
      .filter(({ p, date }) => date && (daysUntil(date) >= 0 || !p.paymentMethod))
      .sort((a, b) => a.date.localeCompare(b.date))[0]?.p;

  const rows = datedOrders
    .filter((o) => status === "all" || statusOf(o) === status || (status === "Received" && statusOf(o) === "Partial"))
    .filter((o) =>
      includesText(
        [o.orderId, ...invoicesOf(o).flatMap((i) => [i.invoiceNumber, i.poNumber, i.company, i.chequeNumber, i.paymentReference]), o.chequeNumber, o.paymentReference],
        query,
      ),
    )
    .sort((a, b) => b.orderId.localeCompare(a.orderId));
  const billTotal = rows.reduce((sum, o) => sum + o.totalBillAmount, 0);
  const notPaid = rows.reduce((sum, o) => sum + paymentsOf(o).reduce((s, p) => s + (p.paymentMethod ? 0 : p.totalBillAmount), 0), 0);

  // A column header sorts every order (not just this page)
  const sorter = useRowSort(rows, {
    order: (o) => o.orderId,
    invoice: (o) => invoiceNumbersOf(o, orderInvoices),
    date: (o) => o.orderDate,
    received: (o) => o.receivedDate,
    // What the Payment cell says first
    payment: (o) => {
      if (paidByInvoice(o, orderInvoices)) {
        const ps = paymentsOf(o);
        return `${ps.filter((p) => p.paymentMethod).length} of ${ps.length} invoices paid`;
      }
      if (!o.paymentMethod) return "Not paid";
      return o.paymentMethod === "Cheque" ? `Cheque ${o.chequeNumber}` : o.paymentMethod;
    },
    deposit: (o) => raigamChequeDate(nextCheque(o) ?? o),
    qty: (o) => qtyByOrder.get(o.orderId) ?? 0,
    bill: (o) => o.totalBillAmount,
    status: (o) => orderLabel[statusOf(o)],
  });
  const pager = usePagination(sorter.rows, [query, status, range, dateBy, sorter.key]);

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
          <ClearFilters
            active={!!(query || status !== "all" || range.from || range.to)}
            onClear={() => {
              setQuery("");
              setStatus("all");
              setRange({ from: "", to: "" });
            }}
          />
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
              <TH sort={sorter.column("order")}>Order ID</TH>
              <TH title="Invoice Number / PO Number" sort={sorter.column("invoice")}>
                Invoice / PO No.
              </TH>
              <TH sort={sorter.column("date")}>Order Date</TH>
              <TH title="Order Received Date / Time" sort={sorter.column("received")}>
                Received
              </TH>
              <TH title="How the bill was paid" sort={sorter.column("payment")}>
                Payment
              </TH>
              <TH
                title={`The day Raigam deposits the cheque: ${RAIGAM_CHEQUE_DAYS} days after the goods came, or the date on the cheque`}
                sort={sorter.column("deposit")}
              >
                Cheque Deposit
              </TH>
              <TH className="text-right" title="Total Item Quantity" sort={sorter.column("qty")}>
                Total Qty
              </TH>
              <TH className="text-right" title="Total Bill Amount" sort={sorter.column("bill")}>
                Bill Amount
              </TH>
              <TH sort={sorter.column("status")}>Status</TH>
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
                  {paidByInvoice(o, orderInvoices) ? (
                    // Each invoice paid on its own
                    (() => {
                      const ps = paymentsOf(o);
                      const paid = ps.filter((p) => p.paymentMethod).length;
                      return (
                        <>
                          <span className={cn("font-medium", paid === ps.length ? "text-emerald-700" : "text-amber-700")}>
                            {paid} of {ps.length} invoices paid
                          </span>
                          <span className="block text-xs font-normal text-slate-500">Paid invoice by invoice</span>
                        </>
                      );
                    })()
                  ) : (
                    <OrderPaymentSummary order={o} />
                  )}
                </TD>
                <TD>
                  {(() => {
                    const next = nextCheque(o);
                    return next ? <ChequeDepositDate order={next} /> : <ChequeDepositDate order={o} />;
                  })()}
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
