"use client";

import { Ban, CalendarClock, HandCoins, PackageOpen, Pencil, Plus, Printer, RotateCcw, Trash2, Truck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { PaymentFormDialog } from "@/components/payments/payment-form-dialog";
import { BillStatusBadge, DueDateLabel } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BackLink, Card, CardHeader, Detail, PageHeader } from "@/components/ui/layout";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { itemsTotal, lineValue, returnsTotal, saleSubtotal } from "@/lib/ledger";
import { saleCost, saleRevenue } from "@/lib/profit";
import { useAppStore, useItemMap, useRouteMap, useSaleDues, useShopBalances, useShopMap } from "@/lib/store";
import type { Payment } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, daysUntil, formatDate, formatMoney, formatQty, round2 } from "@/lib/utils";
import { BillPaymentDialog } from "./bill-payment-dialog";
import { BillStatusMenu } from "./bill-status-menu";
import { DeliverDialog } from "./deliver-dialog";
import { LoadLorryDialog } from "./load-lorry-dialog";
import { ReturnKindBadge } from "./return-items";
import { SaleNotFound } from "./sale-pages";

type Dialog = "load" | "unload" | "deliver" | "payment" | "undo" | "delete";

function NextStep({ icon, title, text, tone, action }: { icon: ReactNode; title: string; text: ReactNode; tone: "blue" | "red" | "amber"; action: ReactNode }) {
  const tones = {
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  return (
    <div className={cn("mb-6 flex flex-col gap-3 rounded-xl border px-5 py-4 sm:flex-row sm:items-center print:hidden", tones[tone])}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white shadow-sm [&_svg]:size-5">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm opacity-90">{text}</p>
      </div>
      {action}
    </div>
  );
}

export function SaleDetail({ id }: { id: string }) {
  const router = useRouter();
  const sale = useAppStore((s) => s.sales.find((x) => x.id === id));
  const deleteSale = useAppStore((s) => s.deleteSale);
  const payments = useAppStore((s) => s.payments);
  const deletePayment = useAppStore((s) => s.deletePayment);
  const addPayment = useAppStore((s) => s.addPayment);
  const undoDelivery = useAppStore((s) => s.undoDelivery);
  const unloadSale = useAppStore((s) => s.unloadSale);
  const restoreSale = useAppStore((s) => s.restoreSale);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const balances = useShopBalances();
  const dues = useSaleDues();
  const dialog = useDialog<Dialog>();
  const editPayment = useDialog<Payment>();
  const removePayment = useDialog<Payment>();

  if (!sale) return <SaleNotFound />;

  const shop = shopMap.get(sale.shopId);
  const route = shop ? routeMap.get(shop.routeId) : undefined;
  // Units charged (qty less cancelled), and units out of stock with the bill (qty + free, less cancelled)
  const units = sale.lines.reduce((n, l) => n + l.qty - l.cancelQty, 0);
  const unitsOut = sale.lines.reduce((n, l) => n + l.qty + l.freeQty - (sale.status === "Delivered" ? l.cancelQty : 0), 0);
  const hasCancel = sale.lines.some((l) => l.cancelQty > 0);
  const d = dues.get(sale.id)!;
  // Payment records on this bill (a receipt can also cover other bills; `amount` is this bill's part)
  const billPayments = d.payments.map((p) => ({ ...p, payment: payments.find((x) => x.id === p.paymentId) }));
  const methodsUsed = [...new Set(billPayments.map((p) => p.payment?.method).filter(Boolean))].join(", ");
  // Still to pay: the balance once delivered; before that, the total less what was paid in advance
  const left = d.delivered ? d.due : round2(d.total - d.paid);
  // Mode of payment as on Raigam's bill: how it was paid, plus Credit for a delivered bill's unpaid balance
  const onCredit = d.delivered && left > 0.004 ? left : 0;
  const paymentMode = [methodsUsed, onCredit ? "Credit" : ""].filter(Boolean).join(", ");
  const daysLeft = sale.dueDate ? daysUntil(sale.dueDate) : 0;

  return (
    <>
      <BackLink href="/sales">Store Orders</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {sale.saleNo} <BillStatusBadge status={d.status} late={sale.late} />
          </span>
        }
        description={`${sale.invoiceNo ? `Raigam invoice ${sale.invoiceNo} · ` : ""}${shop?.shopName ?? "Deleted store"} · ordered ${formatDate(sale.date)}${sale.repName ? ` by ${sale.repName}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {!d.delivered && sale.status !== "Cancelled" && <BillStatusMenu sale={sale} className="h-10 w-40 text-sm" />}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
            {d.delivered && (
              <Button variant="outline" onClick={() => dialog.open("undo")}>
                <Undo2 /> Undo delivery
              </Button>
            )}
            {sale.status !== "Cancelled" && (
              <Link href={`/sales/${sale.id}/edit`} className={buttonClass("outline")}>
                <Pencil /> Edit
              </Link>
            )}
            <Button variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => dialog.open("delete")}>
              <Trash2 /> Delete
            </Button>
          </div>
        }
      />

      {sale.status === "Cancelled" && (
        <NextStep
          tone="red"
          icon={<Ban className="text-red-600" />}
          title="This bill is cancelled"
          text="It's kept for your records and doesn't count in sales, profit or the store's balance."
          action={
            <Button
              variant="outline"
              onClick={async () => {
                const result = await restoreSale(sale.id);
                if (result.ok) toast.success(`${sale.saleNo} restored · waiting to load`);
                else toast.error(result.error);
              }}
            >
              <RotateCcw /> Restore
            </Button>
          }
        />
      )}
      {sale.status === "Ordered" && (
        <NextStep
          tone={sale.late ? "amber" : "blue"}
          icon={<PackageOpen className={sale.late ? "text-amber-700" : "text-sky-700"} />}
          title={sale.late ? "Late delivery · waiting to load again" : "Bill created · waiting to load"}
          text="Load the items on the lorry. Stock is reduced when you mark it loaded."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => dialog.open("deliver")}>
                Deliver directly
              </Button>
              <Button onClick={() => dialog.open("load")}>
                <Truck /> Load on lorry
              </Button>
            </div>
          }
        />
      )}
      {sale.status === "Loaded" && (
        <NextStep
          tone="blue"
          icon={<Truck className="text-sky-700" />}
          title={`On lorry ${sale.vehicleNumber || ""} since ${formatDate(sale.loadedDate)}`}
          text="When you give the items to the store, mark it delivered and record the money collected."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => dialog.open("unload")}>
                Unload
              </Button>
              <Button onClick={() => dialog.open("deliver")}>
                <Truck /> Deliver & collect cash
              </Button>
            </div>
          }
        />
      )}
      {d.delivered && d.due > 0 && (
        <NextStep
          tone={d.overdueDays > 0 ? "red" : daysLeft <= 3 ? "amber" : "blue"}
          icon={<CalendarClock className={d.overdueDays > 0 ? "text-red-600" : "text-sky-700"} />}
          title={`${formatMoney(d.due)} to collect by ${formatDate(sale.dueDate)}`}
          text={
            d.overdueDays > 0
              ? `${d.overdueDays} day${d.overdueDays === 1 ? "" : "s"} past the end date. Collect from ${shop?.ownerName || "the owner"}${shop?.phone ? ` (${shop.phone})` : ""}.`
              : daysLeft === 0
                ? "Due today."
                : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`
          }
          action={
            <Button onClick={() => dialog.open("payment")}>
              <HandCoins /> Record payment
            </Button>
          }
        />
      )}

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:grid-cols-4">
          <Detail label="Raigam Invoice No.">
            {sale.invoiceNo || <span className="text-slate-400">Not entered</span>}
            <span className="block text-xs font-normal text-slate-500">Bill No. {sale.saleNo}</span>
          </Detail>
          <Detail label="Dealer (Store)">
            {shop ? (
              <Link href={`/stores/${shop.id}`} className="text-brand-700 hover:underline print:text-slate-900 print:no-underline">
                {shop.shopName} ({shop.shopCode})
              </Link>
            ) : (
              "Deleted store"
            )}
            {(shop?.ownerName || shop?.phone) && (
              <span className="block text-xs font-normal text-slate-500">{[shop?.ownerName, shop?.phone].filter(Boolean).join(" · ")}</span>
            )}
          </Detail>
          <Detail label="Address">{[shop?.address, shop?.town].filter(Boolean).join(", ") || "—"}</Detail>
          <Detail label="Route / Territory">
            {route ? `${route.routeCode} · ${route.routeName}` : "—"}
            {route?.area && <span className="block text-xs font-normal text-slate-500">{route.area}</span>}
          </Detail>
          <Detail label="Booking Date">{formatDate(sale.date)}</Detail>
          <Detail label="Actual Date">
            {d.delivered ? formatDate(sale.deliveredDate) : <span className="text-slate-500">Not delivered yet</span>}
            {sale.loadedDate && (
              <span className="block text-xs font-normal text-slate-500">
                Loaded {formatDate(sale.loadedDate)}
                {sale.vehicleNumber ? ` · ${sale.vehicleNumber}` : ""}
              </span>
            )}
          </Detail>
          <Detail label="Rep">{sale.repName || "—"}</Detail>
          <Detail label="Mode of Payment">
            {paymentMode || <span className="text-slate-500">Not paid yet</span>}
            {(billPayments.length > 0 || onCredit > 0) && (
              <span className="block text-xs font-normal text-slate-500">
                {[billPayments.length ? `${formatMoney(d.paid)} paid` : "", onCredit ? `${formatMoney(onCredit)} on credit` : ""].filter(Boolean).join(" · ")}
              </span>
            )}
          </Detail>
          <Detail label="End Date to Collect">
            {d.delivered ? (
              <DueDateLabel dueDate={sale.dueDate} due={d.due} overdueDays={d.overdueDays} />
            ) : sale.status === "Cancelled" ? (
              <span className="text-slate-500">—</span>
            ) : (
              <span className="text-slate-500">{shop?.creditDays ?? 21} days after delivery</span>
            )}
          </Detail>
          <Detail label="Invoice Value">
            <span className="text-base tabular-nums">{formatMoney(d.total)}</span>
          </Detail>
          <Detail label="Cash Balance">
            <span className={cn("text-base tabular-nums", d.due > 0 ? "text-red-600" : d.delivered ? "text-emerald-700" : "text-slate-500")}>
              {d.delivered ? formatMoney(d.due) : "After delivery"}
            </span>
          </Detail>
          {sale.notes && (
            <div className="col-span-2 lg:col-span-4">
              <Detail label="Note">{sale.notes}</Detail>
            </div>
          )}
        </dl>
      </Card>

      <Card className="mt-6">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Invoice items <span className="font-normal text-slate-500">· {sale.lines.length}</span>
          </h2>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>#</TH>
              <TH>Item Description</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Free</TH>
              <TH className="text-right">Unit Price</TH>
              <TH className="text-right">Disc. %</TH>
              <TH className="text-right">Disc. Value</TH>
              {hasCancel && <TH className="text-right">Cancelled</TH>}
              <TH className="text-right">Value</TH>
            </tr>
          </THead>
          <TBody>
            {sale.lines.map((l, i) => {
              const item = itemMap.get(l.sapCode);
              const book = round2((l.qty - l.cancelQty) * l.unitPrice);
              return (
                <TR key={l.id}>
                  <TD className="text-slate-400 tabular-nums">{i + 1}</TD>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{item?.description ?? "Unknown item"}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {l.sapCode} · {l.locationNumber}
                      {item?.packageDetails ? ` · ${item.packageDetails}` : ""}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{formatQty(l.qty)}</TD>
                  <TD className="text-right tabular-nums">{l.freeQty ? formatQty(l.freeQty) : "—"}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TD>
                  <TD className="text-right tabular-nums">{l.discountPct ? `${l.discountPct}%` : "—"}</TD>
                  <TD className="text-right tabular-nums">{l.discountPct ? formatMoney(round2(book - lineValue(l))) : "—"}</TD>
                  {hasCancel && <TD className="text-right tabular-nums">{l.cancelQty ? formatQty(l.cancelQty) : "—"}</TD>}
                  <TD className="text-right font-medium text-slate-900 tabular-nums">{formatMoney(lineValue(l))}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>

        {sale.returns.length > 0 && (
          <>
            <div className="border-t border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Return items{" "}
                <span className="font-normal text-slate-500">
                  · {sale.status === "Delivered" ? "taken at delivery" : "to collect at delivery"}, credited on this bill, sent back to Raigam
                </span>
              </h2>
            </div>
            <Table>
              <THead>
                <tr>
                  <TH>Type</TH>
                  <TH>Item Description</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Unit Price</TH>
                  <TH className="text-right">Value</TH>
                </tr>
              </THead>
              <TBody>
                {sale.returns.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <ReturnKindBadge kind={r.kind} />
                    </TD>
                    <TD className="whitespace-normal">
                      <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? "Unknown item"}</span>
                      <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatQty(r.qty)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(r.unitPrice)}</TD>
                    <TD className="text-right font-medium text-red-600 tabular-nums">− {formatMoney(round2(r.qty * r.unitPrice))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        )}

        <div className="flex justify-end border-t border-slate-200 px-5 py-4">
          <dl className="grid w-full max-w-sm grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Items total ({formatQty(units)} units)</dt>
            <dd className="text-right tabular-nums">{formatMoney(itemsTotal(sale))}</dd>
            {sale.returns.length > 0 && (
              <>
                <dt className="text-slate-500">Returns</dt>
                <dd className="text-right text-red-600 tabular-nums">− {formatMoney(returnsTotal(sale))}</dd>
                <dt className="text-slate-500">Gross value</dt>
                <dd className="text-right tabular-nums">{formatMoney(saleSubtotal(sale))}</dd>
              </>
            )}
            <dt className="text-slate-500">Bill discount ({sale.discountPercent}%)</dt>
            <dd className="text-right tabular-nums">{sale.discount ? `− ${formatMoney(sale.discount)}` : formatMoney(0)}</dd>
            <dt className="border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">Invoice value</dt>
            <dd className="border-t border-slate-200 pt-2 text-right text-base font-semibold text-slate-900 tabular-nums">
              {formatMoney(d.total)}
            </dd>
            {d.delivered && d.payments.length === 0 && (
              <>
                <dt className="text-slate-500">Paid</dt>
                <dd className="text-right tabular-nums">{formatMoney(0)}</dd>
              </>
            )}
            {d.payments.map((p) => (
              <div key={p.paymentId} className="contents">
                <dt className="text-slate-500">
                  Paid {p.receiptNo} <span className="text-xs">({formatDate(p.date)})</span>
                </dt>
                <dd className="text-right text-emerald-700 tabular-nums">− {formatMoney(p.amount)}</dd>
              </div>
            ))}
            <dt className="border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
              {d.delivered ? "Cash balance" : "To collect after delivery"}
            </dt>
            <dd className={cn("border-t border-slate-200 pt-2 text-right text-base font-semibold tabular-nums", left > 0 ? "text-red-600" : "text-emerald-700")}>
              {formatMoney(left)}
            </dd>
          </dl>
        </div>

        {/* Printed bill footer, as on Raigam's invoice */}
        <div className="hidden border-t border-slate-200 px-5 py-6 text-sm text-slate-800 print:block">
          <p>
            <span className="font-semibold">Mode of payment:</span>{" "}
            {paymentMode || <span className="inline-block w-48 border-b border-dotted border-slate-500" />}
          </p>
          <p className="mt-2">Received the above article in good condition and order.</p>
          <div className="mt-10 flex justify-between gap-8">
            <p className="w-56 border-t border-dotted border-slate-500 pt-1">Customer Signature</p>
            <p className="w-56 border-t border-dotted border-slate-500 pt-1">Date</p>
          </div>
          {sale.repName && <p className="mt-6 text-xs text-slate-600">Sales Rep: {sale.repName}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-slate-200 px-5 py-2.5 text-xs text-slate-500 print:hidden">
          <span>
            Cost of items <span className="font-medium text-slate-700 tabular-nums">{formatMoney(saleCost(sale))}</span>
          </span>
          <span>
            Profit on this bill{" "}
            <span className={cn("font-semibold tabular-nums", saleRevenue(sale) - saleCost(sale) < 0 ? "text-red-600" : "text-slate-900")}>
              {formatMoney(round2(saleRevenue(sale) - saleCost(sale)))}
            </span>
            {sale.returns.length > 0 && <span> (returns counted back: Raigam pays them)</span>}
          </span>
        </div>
        {shop && (
          <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-3 text-sm text-slate-600 print:hidden">
            {shop.shopName}&apos;s total cash balance (all bills) is{" "}
            <span className="font-semibold text-slate-900">{formatMoney(balances.get(shop.id)?.balance ?? 0)}</span>.{" "}
            <Link href={`/stores/${shop.id}`} className="font-medium text-brand-700 hover:underline">
              View store
            </Link>
          </div>
        )}
      </Card>

      {sale.status !== "Cancelled" && (
        <Card className="mt-6 print:hidden">
          <CardHeader
            title={`Payments · ${billPayments.length}`}
            description={
              left <= 0.004
                ? "Fully paid"
                : d.delivered
                  ? `${formatMoney(d.paid)} paid · ${formatMoney(left)} on credit, to collect by ${formatDate(sale.dueDate)}`
                  : d.paid > 0
                    ? `${formatMoney(d.paid)} paid in advance · ${formatMoney(left)} left to collect after delivery`
                    : "Paid with the order or in advance? Add it here. The rest is collected after delivery."
            }
            actions={
              left > 0.004 && (
                <Button size="sm" onClick={() => dialog.open("payment")}>
                  <Plus /> Add payment
                </Button>
              )
            }
          />
          <Table>
            <THead>
              <tr>
                <TH>Receipt</TH>
                <TH>Date</TH>
                <TH>Method</TH>
                <TH>Note</TH>
                <TH className="text-right">Amount</TH>
                <TH className="w-24">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {billPayments.length === 0 && <EmptyRow colSpan={6}>No payments yet. Press Add payment when the store pays (one bill can have many payments).</EmptyRow>}
              {billPayments.map((p) => (
                <TR key={p.paymentId}>
                  <TD className="font-medium text-slate-900">{p.receiptNo}</TD>
                  <TD className="tabular-nums">{formatDate(p.date)}</TD>
                  <TD>
                    {p.payment?.method ?? "—"}
                    {p.payment?.method === "Cheque" && (
                      <span className="block text-xs text-slate-500">
                        No. {p.payment.chequeNumber}
                        {p.payment.chequeDate ? ` · ${formatDate(p.payment.chequeDate)}` : ""}
                      </span>
                    )}
                  </TD>
                  <TD className="max-w-64 whitespace-normal text-slate-600">{p.payment?.reference || <span className="text-slate-400">—</span>}</TD>
                  <TD className="text-right font-medium text-emerald-700 tabular-nums">
                    {formatMoney(p.amount)}
                    {p.payment && p.payment.amount > p.amount + 0.004 && (
                      <span className="block text-xs font-normal text-slate-500">of {formatMoney(p.payment.amount)} receipt</span>
                    )}
                  </TD>
                  <TD>
                    {p.payment && (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => editPayment.open(p.payment!)} aria-label={`Edit ${p.receiptNo}`} title="Edit">
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-red-50 hover:text-red-600"
                          onClick={() => removePayment.open(p.payment!)}
                          aria-label={`Delete ${p.receiptNo}`}
                          title="Delete"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <LoadLorryDialog open={dialog.target === "load"} onClose={dialog.close} preselect={[sale.id]} />
      <DeliverDialog sale={sale} open={dialog.target === "deliver"} onClose={dialog.close} />
      <ConfirmDialog
        open={dialog.target === "unload"}
        onClose={dialog.close}
        tone="primary"
        confirmLabel="Unload"
        title={`Unload ${sale.saleNo}?`}
        message={`${formatQty(unitsOut)} units (with free issue) go back into stock and the bill waits to be loaded again.`}
        onConfirm={async () => {
          const result = await unloadSale(sale.id);
          dialog.close();
          if (result.ok) toast.success(`${sale.saleNo} unloaded, stock returned`);
          else toast.error(result.error);
        }}
      />
      <BillPaymentDialog
        title={`Add payment · ${sale.saleNo}`}
        description={sale.invoiceNo ? `Raigam invoice ${sale.invoiceNo}` : undefined}
        left={left}
        balanceLabel={d.delivered ? "Balance on credit" : "To collect after delivery"}
        open={dialog.target === "payment"}
        onClose={dialog.close}
        onSave={async (payment) => {
          const result = await addPayment({ ...payment, shopId: sale.shopId, allocations: [{ saleId: sale.id, amount: payment.amount }] });
          if (!result.ok) return result.error;
          const after = round2(left - payment.amount);
          toast.success(`${formatMoney(payment.amount)} ${payment.method.toLowerCase()} added to ${sale.saleNo}${after > 0 ? ` · ${formatMoney(after)} left` : " · fully paid"}`);
          return null;
        }}
      />
      <PaymentFormDialog open={editPayment.isOpen} payment={editPayment.target} onClose={editPayment.close} />
      <ConfirmDialog
        open={removePayment.isOpen}
        onClose={removePayment.close}
        title={`Delete payment ${removePayment.target?.receiptNo ?? ""}?`}
        message={`${formatMoney(removePayment.target?.amount ?? 0)} comes off what was paid${
          (removePayment.target?.allocations.length ?? 0) > 1 ? " on this and the other bills it covered" : ""
        }, so ${sale.saleNo}'s balance goes back up.`}
        onConfirm={async () => {
          if (!removePayment.target) return;
          const result = await deletePayment(removePayment.target.id);
          if (result.ok) toast.success(`Payment ${removePayment.target.receiptNo} deleted`);
          else toast.error(result.error);
          removePayment.close();
        }}
      />
      <ConfirmDialog
        open={dialog.target === "undo"}
        onClose={dialog.close}
        tone="primary"
        confirmLabel="Undo delivery"
        title={`Undo delivery of ${sale.saleNo}?`}
        message={`The bill goes back to "on lorry" (stock stays out until you unload it).${hasCancel ? " Cancelled items go back on the lorry." : ""}${
          sale.returns.length ? " Its return items stay on the bill to collect at the next delivery (they leave Return Items until then)." : ""
        }${d.paid > 0 ? ` Its payments (${formatMoney(d.paid)}) stay on the bill.` : ""}`}
        onConfirm={async () => {
          const result = await undoDelivery(sale.id);
          dialog.close();
          if (result.ok) toast.success(`${sale.saleNo} is back on the lorry`);
          else toast.error(result.error);
        }}
      />
      <ConfirmDialog
        open={dialog.target === "delete"}
        onClose={dialog.close}
        title={`Delete ${sale.saleNo}?`}
        message={
          sale.status === "Ordered"
            ? "This bill hasn't been loaded, so no stock or cash balance changes."
            : `${formatQty(unitsOut)} units go back into stock.${
                sale.status === "Delivered" && sale.returns.length ? " Its return items leave Return Items." : ""
              }${d.paid > 0 ? ` Payments of ${formatMoney(d.paid)} linked to this bill stay with the store as an advance.` : ""}`
        }
        onConfirm={async () => {
          const result = await deleteSale(sale.id);
          dialog.close();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`${sale.saleNo} deleted`);
          router.push("/sales");
        }}
      />
    </>
  );
}
