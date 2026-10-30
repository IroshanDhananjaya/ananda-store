"use client";

import { Banknote, ClipboardCheck, FileText, PackageCheck, PackagePlus, Pencil, Plus, Trash2, Truck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LineStatusBadge, OrderStatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BackLink, Card, CardHeader, Detail, FilterTabs } from "@/components/ui/layout";
import { StickyHeader } from "@/components/ui/sticky-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap } from "@/lib/store";
import type { OrderInvoice } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatMoney, formatQty, invoiceTotals, lineStatus, orderLineValue, orderStatus, raigamChequeDate, round2 } from "@/lib/utils";
import { invoiceName, OrderInvoiceDialog, PostToStockDialog, ReceiveOrderDialog } from "./order-dialogs";
import { ChequeDepositPanel, OrderPaymentDetails, PayOrderDialog } from "./order-payment";
import { OrderNotFound } from "./order-pages";
import { ReceiveCheckSheet } from "./receive-check-sheet";

type Dialog = "receive" | "post" | "reverse" | "delete" | "pay" | "invoice";
/** Items shown: all, one invoice's, the missing ones, or the ones that came without being ordered */
type ItemFilter = "all" | "missing" | "extra" | `inv:${string}`;

/** One half of the payment row on the order card */
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
  const orderInvoices = useAppStore((s) => s.orderInvoices);
  const deleteOrder = useAppStore((s) => s.deleteOrder);
  const reverseOrderPosting = useAppStore((s) => s.reverseOrderPosting);
  const itemMap = useItemMap();
  const dialog = useDialog<Dialog>();
  // The invoice being edited (null = adding one), and the items to add to stock (left out = all)
  const [invoiceTarget, setInvoiceTarget] = useState<OrderInvoice | null>(null);
  const [postOnly, setPostOnly] = useState<string[]>();
  const [show, setShow] = useState<ItemFilter>("all");

  const lines = useMemo(() => orderItems.filter((l) => l.orderId === order?.orderId), [orderItems, order?.orderId]);
  const invoices = useMemo(() => orderInvoices.filter((i) => i.orderId === order?.orderId), [orderInvoices, order?.orderId]);

  if (!order) return <OrderNotFound />;

  const status = orderStatus(order, orderItems);
  const received = !!order.receivedDate;
  const inStock = lines.filter((l) => l.postedLocation).length;
  const toAdd = lines.filter((l) => l.receivedQty > 0 && !l.postedLocation).length;
  // Some items in stock: the order is locked until the posting is reversed
  const locked = inStock > 0;
  const totalOrdered = lines.reduce((s, l) => s + l.orderedQty, 0);
  const totalReceived = lines.reduce((s, l) => s + l.receivedQty, 0);
  const statusOf = (l: (typeof lines)[number]) => lineStatus(l, order);
  const unmatched = lines.filter((l) => statusOf(l) === "Unmatch").length;
  const missing = lines.filter((l) => statusOf(l) === "Missing");
  const extra = lines.filter((l) => statusOf(l) === "Extra");
  const issues = [missing.length ? `${missing.length} missing` : "", unmatched ? `${unmatched} didn't match the order` : "", extra.length ? `${extra.length} not ordered` : ""]
    .filter(Boolean)
    .join(", ");
  const perInvoice = invoices.map((invoice, n) => ({ invoice, n, ...invoiceTotals(invoice, lines) }));
  const sums = {
    items: perInvoice.reduce((s, x) => s + x.lines.length, 0),
    linesTotal: round2(perInvoice.reduce((s, x) => s + x.linesTotal, 0)),
    discount: round2(perInvoice.reduce((s, x) => s + x.discount, 0)),
    total: round2(perInvoice.reduce((s, x) => s + x.total, 0)),
  };
  const invoiceOf = new Map(perInvoice.map((x) => [x.invoice.id, x]));
  const shown = lines.filter((l) =>
    show === "all" ? true : show === "missing" ? statusOf(l) === "Missing" : show === "extra" ? statusOf(l) === "Extra" : `inv:${l.invoiceId}` === show,
  );
  // Once the goods came, the deposit date panel offers Add cheque while nothing is paid
  const payReminder = !!raigamChequeDate(order) && !order.paymentMethod;

  function openInvoice(invoice: OrderInvoice | null) {
    setInvoiceTarget(invoice);
    dialog.open("invoice");
  }

  function openPost(only?: string[]) {
    setPostOnly(only);
    dialog.open("post");
  }

  return (
    <>
      {/* Printing shows only the receiving check sheet */}
      <div className="print:hidden">
        <BackLink href="/orders">Purchase Orders</BackLink>
        {/* Invoices and the cheque are added after the order is made, so their buttons come first */}
        <StickyHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              {order.orderId} <OrderStatusBadge status={status} />
            </span>
          }
          actions={
            <>
              <Button variant="outline" onClick={() => openInvoice(null)}>
                <FileText /> Add invoice
              </Button>
              {!payReminder && (
                <Button variant="outline" onClick={() => dialog.open("pay")}>
                  <Banknote /> {order.paymentMethod ? "Edit payment" : "Add cheque"}
                </Button>
              )}
              {/* Icons only until the screen is wide enough for every label on one row */}
              <Button
                variant="outline"
                className="px-2.5 xl:px-4"
                onClick={() => window.print()}
                aria-label="Print check sheet"
                title="Print check sheet: the items ordered, to count the goods against"
              >
                <ClipboardCheck /> <span className="hidden xl:inline">Check sheet</span>
              </Button>
              {locked ? (
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

        <ChequeDepositPanel
          order={order}
          action={
            payReminder && (
              <Button onClick={() => dialog.open("pay")}>
                <Banknote /> Add cheque
              </Button>
            )
          }
        />

        {status === "Pending" && (
          <NextStep
            icon={<Truck />}
            title="Waiting for delivery"
            text="Print the check sheet to count the goods on when they arrive. Then enter the Raigam invoices they came on and the count."
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => window.print()}>
                  <ClipboardCheck /> Print check sheet
                </Button>
                <Button onClick={() => dialog.open("receive")}>
                  <PackageCheck /> Receive order
                </Button>
              </div>
            }
          />
        )}
        {(status === "Received" || status === "Partial") && (
          <NextStep
            icon={<PackagePlus />}
            title={status === "Partial" ? `${toAdd} item${toAdd === 1 ? "" : "s"} still to add to stock` : "Ready to add to stock"}
            text={
              status === "Partial"
                ? `${inStock} item${inStock === 1 ? " is" : "s are"} in stock. Add the rest all at once, or one by one from the list below.`
                : issues
                  ? `${issues}. Check the counts, then add what came to stock: all at once, or one by one.`
                  : "Everything came as ordered. Add it to stock: all at once, or one by one from the list below."
            }
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => dialog.open("receive")}>
                  Edit receiving
                </Button>
                <Button onClick={() => openPost()}>
                  <PackagePlus /> {status === "Partial" ? "Add the rest" : "Add all to stock"}
                </Button>
              </div>
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
                {received && <span className="ml-1 text-xs font-normal text-slate-500">({formatQty(totalReceived)} received)</span>}
              </Detail>
              {received && sums.discount > 0 && (
                <Detail label="Invoice Discounts">
                  <span className="tabular-nums">{formatMoney(sums.discount)}</span>
                </Detail>
              )}
              <Detail label="Total Bill Amount">
                <span className="text-base tabular-nums">{formatMoney(order.totalBillAmount)}</span>
              </Detail>
            </dl>
            <div className="border-t border-slate-200">
              <InfoBlock icon={<Banknote />} title="Payment to Raigam">
                <OrderPaymentDetails order={order} />
              </InfoBlock>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={`Raigam invoices (${invoices.length})`}
              description="Each invoice with its own discount %, as printed on it. The bill is their grand totals added up."
              actions={
                <Button variant="secondary" size="sm" onClick={() => openInvoice(null)}>
                  <Plus /> Add invoice
                </Button>
              }
            />
            <Table>
              <THead>
                <tr>
                  <TH>Invoice No.</TH>
                  <TH>Company</TH>
                  <TH>PO No.</TH>
                  <TH>Date</TH>
                  <TH className="text-right">Items</TH>
                  <TH className="text-right">Items Total</TH>
                  <TH className="text-right">Discount</TH>
                  <TH className="text-right">Grand Total</TH>
                  <TH className="w-12">
                    <span className="sr-only">Edit</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {perInvoice.length === 0 && (
                  <TR>
                    <TD colSpan={9} className="py-6 text-center text-slate-500">
                      No invoices yet. They&apos;re added with Receive order when the goods come, or with Add invoice.
                    </TD>
                  </TR>
                )}
                {perInvoice.map(({ invoice, n, lines: on, units, linesTotal, discount, total }) => (
                  <TR key={invoice.id} className="cursor-pointer" onClick={() => setShow(`inv:${invoice.id}`)}>
                    <TD className="font-medium text-slate-900">{invoice.invoiceNumber || <span className="text-amber-700">No number yet</span>}</TD>
                    <TD className="max-w-56 min-w-36 whitespace-normal">{invoice.company || <span className="text-slate-400">—</span>}</TD>
                    <TD>{invoice.poNumber || <span className="text-slate-400">—</span>}</TD>
                    <TD className="tabular-nums">{formatDate(invoice.invoiceDate)}</TD>
                    <TD className="text-right tabular-nums">
                      {on.length}
                      <span className="block text-xs text-slate-500">{formatQty(units)} units</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(linesTotal)}</TD>
                    <TD className="text-right tabular-nums">
                      {invoice.discountPercent ? (
                        <>
                          {formatMoney(discount)}
                          <span className="block text-xs text-slate-500">{invoice.discountPercent}%</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(total)}</TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" onClick={() => openInvoice(invoice)} aria-label={`Edit ${invoiceName(invoice, n)}`} title="Edit">
                        <Pencil />
                      </Button>
                    </TD>
                  </TR>
                ))}
                {perInvoice.length > 1 && (
                  <TR className="bg-slate-50/70 font-semibold">
                    <TD colSpan={4}>All {perInvoice.length} invoices</TD>
                    <TD className="text-right tabular-nums">{sums.items}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(sums.linesTotal)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(sums.discount)}</TD>
                    <TD className="text-right text-slate-900 tabular-nums">{formatMoney(sums.total)}</TD>
                    <TD />
                  </TR>
                )}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader
              title="Order items"
              description={[
                `${lines.length} item${lines.length === 1 ? "" : "s"}`,
                unmatched ? `${unmatched} unmatched` : "",
                missing.length ? `${missing.length} missing` : "",
                extra.length ? `${extra.length} not ordered` : "",
                inStock ? `${inStock} in stock` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              actions={
                received && (
                  <FilterTabs<ItemFilter>
                    value={show}
                    onChange={setShow}
                    options={[
                      { value: "all", label: "All", count: lines.length },
                      ...perInvoice.map(({ invoice, n, lines: on }) => ({
                        value: `inv:${invoice.id}` as const,
                        label: invoice.invoiceNumber || `Invoice ${n + 1}`,
                        count: on.length,
                      })),
                      ...(missing.length ? [{ value: "missing" as const, label: "Missing", count: missing.length }] : []),
                      ...(extra.length ? [{ value: "extra" as const, label: "Not ordered", count: extra.length }] : []),
                    ]}
                  />
                )
              }
            />
            <Table>
              <THead>
                <tr>
                  <TH>Item Code</TH>
                  <TH>Item Name</TH>
                  <TH className="text-right">Ordered Qty</TH>
                  {received && <TH>Invoice</TH>}
                  {received && <TH className="text-right">On Invoice</TH>}
                  <TH className="text-right">Received Qty</TH>
                  <TH className="text-right">Diff.</TH>
                  <TH className="text-right">Price</TH>
                  <TH className="text-right">Discount</TH>
                  <TH className="text-right" title="Qty on the invoice × price − discount (ordered qty before the goods come)">
                    Value
                  </TH>
                  <TH>Status</TH>
                  <TH>Remarks</TH>
                  {received && <TH>Stock</TH>}
                </tr>
              </THead>
              <TBody>
                {shown.map((l) => {
                  const s = statusOf(l);
                  const diff = l.receivedQty - l.orderedQty;
                  const inv = invoiceOf.get(l.invoiceId);
                  return (
                    <TR key={l.id} className={cn((s === "Unmatch" || s === "Missing") && "bg-red-50/40")}>
                      <TD className="font-mono text-xs font-medium text-slate-900">{l.itemCode}</TD>
                      <TD className="font-medium text-slate-900">
                        {itemMap.get(l.itemCode)?.description ?? "Unknown item"}
                        <span className="block text-xs font-normal text-slate-500">{itemMap.get(l.itemCode)?.uom}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{l.orderedQty ? formatQty(l.orderedQty) : "—"}</TD>
                      {received && <TD className="whitespace-nowrap">{inv ? inv.invoice.invoiceNumber || `Invoice ${inv.n + 1}` : <span className="text-slate-400">—</span>}</TD>}
                      {received && <TD className="text-right tabular-nums">{l.invoiceId ? formatQty(l.invoicedQty) : "—"}</TD>}
                      <TD className="text-right tabular-nums">
                        {received ? formatQty(l.receivedQty) : "—"}
                        {received && l.invoiceId && l.receivedQty < l.invoicedQty && (
                          <span className="block text-xs text-amber-700">{formatQty(l.invoicedQty - l.receivedQty)} short</span>
                        )}
                      </TD>
                      <TD className={cn("text-right tabular-nums", diff !== 0 && received && (diff < 0 ? "text-red-600" : "text-amber-600"))}>
                        {received ? (diff > 0 ? `+${diff}` : diff) : "—"}
                      </TD>
                      <TD className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TD>
                      <TD className="text-right tabular-nums">{l.discount ? formatMoney(l.discount) : "—"}</TD>
                      <TD className="text-right font-medium text-slate-900 tabular-nums">{formatMoney(orderLineValue(l, order))}</TD>
                      <TD>
                        <LineStatusBadge status={s} />
                      </TD>
                      <TD className="max-w-56 min-w-36 whitespace-normal">{l.remarks || <span className="text-slate-400">—</span>}</TD>
                      {received && (
                        <TD className="whitespace-nowrap">
                          {l.postedLocation ? (
                            <span className="text-emerald-700">In stock · {l.postedLocation}</span>
                          ) : l.receivedQty > 0 ? (
                            <Button variant="secondary" size="sm" onClick={() => openPost([l.id])}>
                              <PackagePlus /> Add to stock
                            </Button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        </div>
      </div>

      <ReceiveCheckSheet orderRef={order.orderId} orderDate={order.orderDate} requiredDate={order.requiredDate} lines={lines} />

      <ReceiveOrderDialog order={order} lines={lines} open={dialog.target === "receive"} onClose={dialog.close} />
      <PayOrderDialog order={order} open={dialog.target === "pay"} onClose={dialog.close} />
      <OrderInvoiceDialog order={order} invoice={invoiceTarget} lines={lines} open={dialog.target === "invoice"} onClose={dialog.close} />
      <PostToStockDialog order={order} lines={lines} only={postOnly} open={dialog.target === "post"} onClose={dialog.close} />

      <ConfirmDialog
        open={dialog.target === "reverse"}
        onClose={dialog.close}
        title={`Reverse stock posting for ${order.orderId}?`}
        message={`The ${inStock} item${inStock === 1 ? "" : "s"} added to stock come off Available QTY in Stock, and the order is unlocked for editing.`}
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
        message={`The order, its ${invoices.length ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} and ` : ""}${lines.length} item line${lines.length === 1 ? "" : "s"} will be deleted. This cannot be undone.`}
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
