"use client";

import { Banknote, FileText, PackageCheck, PackagePlus, Pencil, Trash2, Truck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { LineStatusBadge, OrderStatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BackLink, Card, CardHeader, Detail } from "@/components/ui/layout";
import { StickyHeader } from "@/components/ui/sticky-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap } from "@/lib/store";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatMoney, formatQty, invoiceDiscount, lineStatus, orderLineValue, orderStatus, round2 } from "@/lib/utils";
import { OrderInvoiceDialog, PostToStockDialog, ReceiveOrderDialog } from "./order-dialogs";
import { OrderPaymentDetails, PayOrderDialog } from "./order-payment";
import { OrderNotFound } from "./order-pages";

type Dialog = "receive" | "post" | "reverse" | "delete" | "pay" | "invoice";

/** One half of the invoice / payment row on the order card */
function InfoBlock({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 [&_svg]:size-4 [&_svg]:text-slate-400">
        {icon} {title}
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">{children}</dl>
    </div>
  );
}

function NextStep({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 px-5 py-4 sm:flex-row sm:items-center">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-brand-700 shadow-sm [&_svg]:size-5">
        {icon}
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-brand-900">{title}</p>
        <p className="text-sm text-brand-800">{text}</p>
      </div>
      {action}
    </div>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const router = useRouter();
  const order = useAppStore((s) => s.orders.find((o) => o.id === id));
  const orderItems = useAppStore((s) => s.orderItems);
  const deleteOrder = useAppStore((s) => s.deleteOrder);
  const reverseOrderPosting = useAppStore((s) => s.reverseOrderPosting);
  const itemMap = useItemMap();
  const dialog = useDialog<Dialog>();

  const lines = useMemo(() => orderItems.filter((l) => l.orderId === order?.orderId), [orderItems, order?.orderId]);

  if (!order) return <OrderNotFound />;

  const status = orderStatus(order);
  const posted = order.postedToStock;
  const totalOrdered = lines.reduce((s, l) => s + l.orderedQty, 0);
  const totalReceived = lines.reduce((s, l) => s + l.receivedQty, 0);
  const unmatched = lines.filter((l) => lineStatus(l, order) === "Unmatch").length;
  const linesTotal = round2(lines.reduce((sum, l) => sum + orderLineValue(l, order), 0));
  // Once the load is in stock, an unpaid bill is the next thing to do
  const payReminder = posted && !order.paymentMethod;

  return (
    <>
      <BackLink href="/orders">Purchase Orders</BackLink>
      {/* Invoice number and cheque are added after the order is made, so their buttons come first */}
      <StickyHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {order.orderId} <OrderStatusBadge status={status} />
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => dialog.open("invoice")}>
              <FileText /> {order.invoiceNumber ? "Edit invoice no." : "Add invoice no."}
            </Button>
            {!payReminder && (
              <Button variant="outline" onClick={() => dialog.open("pay")}>
                <Banknote /> {order.paymentMethod ? "Edit payment" : "Add cheque"}
              </Button>
            )}
            {/* Icons only until the screen is wide enough for every label on one row */}
            {posted ? (
              <Button variant="outline" className="px-2.5 xl:px-4" onClick={() => dialog.open("reverse")} aria-label="Reverse posting" title="Reverse posting">
                <Undo2 /> <span className="hidden xl:inline">Reverse posting</span>
              </Button>
            ) : (
              <>
                <Link href={`/orders/${order.id}/edit`} className={buttonClass("outline", "md", "px-2.5 xl:px-4")} aria-label="Edit" title="Edit">
                  <Pencil /> <span className="hidden xl:inline">Edit</span>
                </Link>
                <Button
                  variant="outline"
                  className="px-2.5 text-red-600 hover:bg-red-50 xl:px-4"
                  onClick={() => dialog.open("delete")}
                  aria-label="Delete"
                  title="Delete"
                >
                  <Trash2 /> <span className="hidden xl:inline">Delete</span>
                </Button>
              </>
            )}
          </>
        }
      />

      {status === "Pending" && (
        <NextStep
          icon={<Truck />}
          title="Waiting for delivery"
          text="When the goods arrive, record the received date and count each item."
          action={
            <Button onClick={() => dialog.open("receive")}>
              <PackageCheck /> Receive order
            </Button>
          }
        />
      )}
      {status === "Received" && (
        <NextStep
          icon={<PackagePlus />}
          title="Ready to add to stock"
          text={
            unmatched
              ? `${unmatched} item${unmatched > 1 ? "s" : ""} did not match the order. Check the counts, then add the received quantities to stock.`
              : "All items match. Add the received quantities to stock."
          }
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => dialog.open("receive")}>
                Edit counts
              </Button>
              <Button onClick={() => dialog.open("post")}>
                <PackagePlus /> Post to stock
              </Button>
            </div>
          }
        />
      )}
      {payReminder && (
        <NextStep
          icon={<Banknote />}
          title="Not paid yet"
          text={`Bill ${formatMoney(order.totalBillAmount)}. When you pay Raigam, add the cheque details (or cash / bank transfer).`}
          action={
            <Button onClick={() => dialog.open("pay")}>
              <Banknote /> Add cheque
            </Button>
          }
        />
      )}

      <div className="flex flex-col gap-6">
        <Card>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-3 lg:grid-cols-4">
            <Detail label="Order Date">{formatDate(order.orderDate)}</Detail>
            {order.requiredDate && <Detail label="Required Date">{formatDate(order.requiredDate)}</Detail>}
            {order.territory && <Detail label="Territory">{order.territory}</Detail>}
            <Detail label="Order Received Date">{formatDate(order.receivedDate)}</Detail>
            <Detail label="Order Received Time">{order.receivedTime || "—"}</Detail>
            <Detail label="Total Item Quantity">
              <span className="tabular-nums">{formatQty(totalOrdered)}</span>
              {order.receivedDate && (
                <span className="ml-1 text-xs font-normal text-slate-500">({formatQty(totalReceived)} received)</span>
              )}
            </Detail>
            {order.discountPercent > 0 && (
              <>
                <Detail label="Lines Total">
                  <span className="tabular-nums">{formatMoney(linesTotal)}</span>
                </Detail>
                <Detail label="Invoice Discount">
                  <span className="tabular-nums">
                    {order.discountPercent}% · {formatMoney(invoiceDiscount(linesTotal, order.discountPercent).discount)}
                  </span>
                </Detail>
              </>
            )}
            <Detail label="Total Bill Amount">
              <span className="text-base tabular-nums">{formatMoney(order.totalBillAmount)}</span>
            </Detail>
          </dl>
          {/* Added after the order is made, with the buttons at the top */}
          <div className="grid divide-y divide-slate-200 border-t border-slate-200 md:grid-cols-2 md:divide-x md:divide-y-0">
            <InfoBlock icon={<FileText />} title="Raigam invoice">
              <Detail label="Invoice Number">{order.invoiceNumber || <span className="text-amber-700">Not added yet</span>}</Detail>
              <Detail label="PO Number">{order.poNumber || "—"}</Detail>
            </InfoBlock>
            <InfoBlock icon={<Banknote />} title="Payment to Raigam">
              <OrderPaymentDetails order={order} />
            </InfoBlock>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Order items"
            description={`${lines.length} item${lines.length === 1 ? "" : "s"}${unmatched ? ` · ${unmatched} unmatched` : ""}`}
          />
          <Table>
            <THead>
              <tr>
                <TH>Item Code</TH>
                <TH>Item Name</TH>
                <TH className="text-right">Ordered Qty</TH>
                <TH className="text-right">Received Qty</TH>
                <TH className="text-right">Diff.</TH>
                <TH className="text-right">Price</TH>
                <TH className="text-right">Discount</TH>
                <TH className="text-right" title="Qty × price − discount">
                  Value
                </TH>
                <TH>Match / Unmatch</TH>
                <TH>Remarks</TH>
                {posted && <TH>Posted To</TH>}
              </tr>
            </THead>
            <TBody>
              {lines.map((l) => {
                const s = lineStatus(l, order);
                const diff = l.receivedQty - l.orderedQty;
                return (
                  <TR key={l.id} className={cn(s === "Unmatch" && "bg-red-50/40")}>
                    <TD className="font-mono text-xs font-medium text-slate-900">{l.itemCode}</TD>
                    <TD className="font-medium text-slate-900">
                      {itemMap.get(l.itemCode)?.description ?? "Unknown item"}
                      <span className="block text-xs font-normal text-slate-500">{itemMap.get(l.itemCode)?.uom}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatQty(l.orderedQty)}</TD>
                    <TD className="text-right tabular-nums">{order.receivedDate ? formatQty(l.receivedQty) : "—"}</TD>
                    <TD
                      className={cn(
                        "text-right tabular-nums",
                        s === "Unmatch" && (diff < 0 ? "text-red-600" : "text-amber-600"),
                      )}
                    >
                      {order.receivedDate ? (diff > 0 ? `+${diff}` : diff) : "—"}
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TD>
                    <TD className="text-right tabular-nums">{l.discount ? formatMoney(l.discount) : "—"}</TD>
                    <TD className="text-right font-medium text-slate-900 tabular-nums">{formatMoney(orderLineValue(l, order))}</TD>
                    <TD>
                      <LineStatusBadge status={s} />
                    </TD>
                    <TD className="max-w-56 min-w-36 whitespace-normal">
                      {l.remarks || <span className="text-slate-400">—</span>}
                    </TD>
                    {posted && <TD>{l.postedLocation ?? "—"}</TD>}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      </div>

      <ReceiveOrderDialog order={order} lines={lines} open={dialog.target === "receive"} onClose={dialog.close} />
      <PayOrderDialog order={order} open={dialog.target === "pay"} onClose={dialog.close} />
      <OrderInvoiceDialog order={order} open={dialog.target === "invoice"} onClose={dialog.close} />
      <PostToStockDialog order={order} lines={lines} open={dialog.target === "post"} onClose={dialog.close} />

      <ConfirmDialog
        open={dialog.target === "reverse"}
        onClose={dialog.close}
        title={`Reverse stock posting for ${order.orderId}?`}
        message="The received quantities will be removed from Available QTY in Stock and the order will be unlocked for editing."
        confirmLabel="Reverse posting"
        onConfirm={async () => {
          const result = await reverseOrderPosting(order.id);
          if (result.ok) toast.success(`${order.orderId} posting reversed`);
          else toast.error(result.error);
          dialog.close();
        }}
      />
      <ConfirmDialog
        open={dialog.target === "delete"}
        onClose={dialog.close}
        title={`Delete ${order.orderId}?`}
        message={`The order and its ${lines.length} item line${lines.length === 1 ? "" : "s"} will be deleted. This cannot be undone.`}
        onConfirm={async () => {
          const result = await deleteOrder(order.id);
          dialog.close();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`${order.orderId} deleted`);
          router.push("/orders");
        }}
      />
    </>
  );
}
