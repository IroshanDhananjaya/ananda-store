"use client";

import { Ban, CalendarClock, ChevronDown, Clock, Ellipsis, Gift, HandCoins, PackageCheck, PackageMinus, PackageOpen, Pencil, Plus, Printer, RotateCcw, Trash2, Truck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { toast } from "sonner";
import { ChequeStatusBadge } from "@/components/payments/cheque-status-field";
import { PaymentFormDialog } from "@/components/payments/payment-form-dialog";
import { BillStatusBadge, DueDateLabel } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BackLink, Card, CardHeader } from "@/components/ui/layout";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { StickyHeader } from "@/components/ui/sticky-header";
import { EmptyRow, GroupRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  chargedQty,
  freeGiven,
  isFreeItem,
  isRemoved,
  itemsTotal,
  lineValue,
  missingSold,
  returnsTotal,
  saleSubtotal,
  wholesaleDifference,
} from "@/lib/ledger";
import { saleCost, saleRevenue } from "@/lib/profit";
import { allTakenOff } from "@/lib/raigam";
import { categoryOf, compareByCategory } from "@/lib/categories";
import { useAppStore, useCategoryRanks, useItemMap, useRouteMap, useSaleDues, useShopBalances, useShopMap } from "@/lib/store";
import type { Payment, Sale, SaleLine, SaleReturn } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, daysUntil, formatDate, formatMoney, formatQty, round2 } from "@/lib/utils";
import { BillItemDialog, BillReturnDialog, type AddKind } from "./bill-item-dialogs";
import { BillPaymentDialog } from "./bill-payment-dialog";
import { useBillStatus, type StatusChoice } from "./bill-status-menu";
import { CheckedToggle } from "./checked-toggle";
import { DeliverDialog } from "./deliver-dialog";
import { LoadLorryDialog } from "./load-lorry-dialog";
import { ReturnKindBadge } from "./return-items";
import { SaleNotFound } from "./sale-pages";

type Dialog = "load" | "unload" | "deliver" | "payment" | "undo" | "delete";

/** An item's name and code; a removed item is struck through in red; its note and the item it's free with underneath */
function ItemCell({ line, name, packageDetails, freeWith }: { line: SaleLine; name?: string; packageDetails?: string; freeWith?: string }) {
  const removed = isRemoved(line);
  return (
    <TD className="whitespace-normal">
      <span className={cn("block font-medium", removed ? "text-red-700 line-through" : "text-slate-900")}>{name ?? "Unknown item"}</span>
      <span className="block font-mono text-xs text-slate-500">
        {line.sapCode} · {line.locationNumber}
        {packageDetails ? ` · ${packageDetails}` : ""}
      </span>
      {removed && <span className="block text-xs font-semibold text-red-600">Removed from the bill</span>}
      {freeWith && <span className="block text-xs text-emerald-700">Free with {freeWith}</span>}
      {line.note && <span className="block text-xs text-slate-600 italic">Note: {line.note}</span>}
    </TD>
  );
}

/** Tick at the end of an item row: removes every unit of it from the bill (kept as a red row), untick puts it back */
function RemoveCell({ line, name, onToggle }: { line: SaleLine; name: string; onToggle: () => void }) {
  const removed = isRemoved(line);
  return (
    <TD className="text-center print:hidden">
      <input
        type="checkbox"
        checked={removed}
        onChange={onToggle}
        className="size-4 cursor-pointer accent-red-600"
        aria-label={`${removed ? "Put back" : "Remove"} ${name} ${removed ? "on" : "from"} the bill`}
        title={removed ? "Removed from the bill. Untick to put it back." : "Tick to remove it from the bill (e.g. not in our store)"}
      />
    </TD>
  );
}

/** Pencil at the end of an item row: change that item only (hidden on the printed bill) */
function EditItemCell({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <TD className="print:hidden">
      <div className="flex justify-end">
        <Button variant="ghost" size="icon" onClick={onClick} aria-label={`Edit ${name}`} title="Edit this item">
          <Pencil />
        </Button>
      </div>
    </TD>
  );
}

/** Label / value pair in the small details strip under the bill's store, invoice number and value */
function SmallDetail({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium text-slate-800">{children}</dd>
    </div>
  );
}

/** Where the bill is up to and what to do next (its button is in the bar at the top) */
function NextStep({ icon, title, text, tone }: { icon: ReactNode; title: string; text: ReactNode; tone: "blue" | "red" | "amber" }) {
  const tones = {
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  return (
    <div className={cn("mb-6 flex items-center gap-3 rounded-xl border px-5 py-4 print:hidden", tones[tone])}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white shadow-sm [&_svg]:size-5">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm opacity-90">{text}</p>
      </div>
    </div>
  );
}

/** Status changes in the ⋯ menu, in Raigam's words */
const STATUS_ENTRIES: Record<Exclude<StatusChoice, "restore">, { label: string; description: string; icon: ReactNode }> = {
  actual: { label: "Actual", description: "Mark delivered; record the money separately", icon: <PackageCheck /> },
  late: { label: "Late Delivery", description: "Not delivered on its day; load it again", icon: <Clock /> },
  cancel: { label: "Cancel bill", description: "The store doesn't want it; kept as a record", icon: <Ban /> },
};

export function SaleDetail({ id }: { id: string }) {
  const sale = useAppStore((s) => s.sales.find((x) => x.id === id));
  // The bill's hooks need a bill, so it's a component of its own
  if (!sale) return <SaleNotFound />;
  return <BillDetail sale={sale} />;
}

function BillDetail({ sale }: { sale: Sale }) {
  const router = useRouter();
  const deleteSale = useAppStore((s) => s.deleteSale);
  const payments = useAppStore((s) => s.payments);
  const deletePayment = useAppStore((s) => s.deletePayment);
  const addPayment = useAppStore((s) => s.addPayment);
  const undoDelivery = useAppStore((s) => s.undoDelivery);
  const unloadSale = useAppStore((s) => s.unloadSale);
  const restoreSale = useAppStore((s) => s.restoreSale);
  const markMissing = useAppStore((s) => s.markMissing);
  const itemMap = useItemMap();
  const ranks = useCategoryRanks();
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const balances = useShopBalances();
  const dues = useSaleDues();
  const dialog = useDialog<Dialog>();
  const editPayment = useDialog<Payment>();
  // An item to change, or what to add ("item" / "free")
  const editItem = useDialog<SaleLine | AddKind>();
  // A return item to change, or "new" to add one
  const editReturn = useDialog<SaleReturn | "new">();
  const removeReturn = useDialog<SaleReturn>();
  const removeBillReturn = useAppStore((s) => s.removeBillReturn);
  const removePayment = useDialog<Payment>();
  const status = useBillStatus(sale);

  const shop = shopMap.get(sale.shopId);
  const route = shop ? routeMap.get(shop.routeId) : undefined;
  // Units charged (qty less missing and cancelled), and units out of stock with the bill (qty + free, less missing and cancelled)
  const units = sale.lines.reduce((n, l) => n + chargedQty(l), 0);
  const unitsOut = sale.lines.reduce((n, l) => n + l.qty + l.freeQty - l.missingQty - (sale.status === "Delivered" ? l.cancelQty : 0), 0);
  const hasCancel = sale.lines.some((l) => l.cancelQty > 0 && !isFreeItem(l));
  // Reduced or removed on the bill (e.g. not in our store): not loaded, not charged
  const removedCount = sale.lines.filter(isRemoved).length;
  const reducedCount = sale.lines.filter((l) => l.missingQty > 0 && !isRemoved(l)).length;
  const reducedValue = round2(sale.lines.reduce((sum, l) => sum + lineValue({ ...l, missingQty: 0 }) - lineValue(l), 0));
  // Items sold, and other items given only free (listed on their own); both under their categories (Raigam's sheet order)
  const byCategory = (a: SaleLine, b: SaleLine) => compareByCategory(ranks, itemMap.get(a.sapCode), itemMap.get(b.sapCode));
  const soldLines = sale.lines.filter((l) => !isFreeItem(l)).sort(byCategory);
  const freeLines = sale.lines.filter(isFreeItem).sort(byCategory);
  const categoryOfLine = (l: SaleLine) => categoryOf(itemMap.get(l.sapCode));
  /** A category heading where it starts in a list of lines */
  const startsCategory = (list: SaleLine[], i: number) => i === 0 || categoryOfLine(list[i]) !== categoryOfLine(list[i - 1]);
  const soldReduced = soldLines.some((l) => missingSold(l) > 0);
  const freeReduced = freeLines.some((l) => l.missingQty > 0);
  // Items can be changed here (one at a time) until the bill is cancelled; reduced or removed until it's delivered
  const canEditItems = sale.status !== "Cancelled";
  const canReduce = sale.status === "Ordered" || sale.status === "Loaded";

  /** The Remove tick on an item row: every unit off the bill (a red row), or all back on it */
  async function toggleRemoved(l: SaleLine) {
    const removing = !isRemoved(l);
    const result = await markMissing(sale.id, { [l.id]: removing ? l.qty + l.freeQty : 0 });
    const name = itemMap.get(l.sapCode)?.description ?? l.sapCode;
    if (result.ok) toast.success(removing ? `${name} removed from ${sale.saleNo}` : `${name} is back on ${sale.saleNo}`);
    else toast.error(result.error);
  }
  const returnUnits = sale.returns.reduce((n, r) => n + r.qty, 0);
  // Synced from Raigam with items taken off there: shown as on Raigam's bill (booked, taken off)
  const hasTakenOff = sale.lines.some((l) => l.takenOff > 0);
  const soldColumns = 8 + Number(hasCancel) + Number(hasTakenOff) + Number(soldReduced) + Number(canReduce) + Number(canEditItems);
  const nothingLeft = allTakenOff(sale);
  // Lines charged at a price other than the item's wholesale price, and what that adds up to
  const priced = sale.lines.filter((l) => chargedQty(l) > 0 && wholesaleDifference(l.unitPrice, itemMap.get(l.sapCode)?.wholesalePrice) !== 0);
  const pricedEffect = round2(
    priced.reduce((sum, l) => sum + wholesaleDifference(l.unitPrice, itemMap.get(l.sapCode)?.wholesalePrice) * chargedQty(l), 0),
  );
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
  const canPay = sale.status !== "Cancelled" && left > 0.004;
  // Restore is the cancelled bill's own button, so it's not listed again
  const statusEntries: MenuEntry[] = status.choices.flatMap((c) =>
    c === "restore" ? [] : [{ ...STATUS_ENTRIES[c], danger: c === "cancel", onSelect: () => status.choose(c) }],
  );
  if (statusEntries.length) statusEntries.unshift({ heading: "Change status" });

  async function restore() {
    const result = await restoreSale(sale.id);
    if (result.ok) toast.success(`${sale.saleNo} restored · waiting to load`);
    else toast.error(result.error);
  }

  return (
    <>
      <BackLink href="/invoices">Daily Invoices</BackLink>
      {/* Every button for the bill, always in reach: Add, Print, Edit, the next step, and the rest under ⋯ */}
      <StickyHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {sale.saleNo} <BillStatusBadge status={d.status} late={sale.late} />
          </span>
        }
        actions={
          <>
            <Menu
              aria-label="Add to the bill"
              entries={[
                canEditItems && { label: "Item", description: "Sold on this bill", icon: <Plus />, onSelect: () => editItem.open("item") },
                canEditItems && { label: "Free issue item", description: "Given free, Raigam pays it back", icon: <Gift />, onSelect: () => editItem.open("free") },
                canEditItems && {
                  label: "Return item",
                  description: "Good or market return, credited on this bill",
                  icon: <RotateCcw />,
                  onSelect: () => editReturn.open("new"),
                },
                // Once delivered, Add payment is the next step's own button
                canPay && !d.delivered && { label: "Payment", description: "Paid with the order or in advance", icon: <HandCoins />, onSelect: () => dialog.open("payment") },
              ]}
            >
              <Plus /> Add <ChevronDown className="-mr-1 text-slate-400" />
            </Menu>
            {/* Icons only until the screen is wide enough for every label on one row */}
            <Button variant="outline" className="hidden px-2.5 sm:inline-flex xl:px-4" onClick={() => window.print()} aria-label="Print" title="Print">
              <Printer /> <span className="hidden xl:inline">Print</span>
            </Button>
            {sale.status !== "Cancelled" && (
              <Link
                href={`/sales/${sale.id}/edit`}
                className={buttonClass("outline", "md", "hidden px-2.5 sm:inline-flex xl:px-4")}
                aria-label="Edit"
                title="Edit"
              >
                <Pencil /> <span className="hidden xl:inline">Edit</span>
              </Link>
            )}
            {d.delivered && (
              <Button
                variant="outline"
                className="hidden px-2.5 sm:inline-flex xl:px-4"
                onClick={() => dialog.open("undo")}
                aria-label="Undo delivery"
                title="Undo delivery"
              >
                <Undo2 /> <span className="hidden xl:inline">Undo delivery</span>
              </Button>
            )}
            <Button
              variant="outline"
              className="hidden px-2.5 text-red-600 hover:bg-red-50 sm:inline-flex xl:px-4"
              onClick={() => dialog.open("delete")}
              aria-label="Delete bill"
              title="Delete bill"
            >
              <Trash2 /> <span className="hidden xl:inline">Delete</span>
            </Button>
            {sale.status === "Ordered" && (
              <>
                <Button variant="outline" className="hidden xl:inline-flex" onClick={() => dialog.open("deliver")}>
                  Deliver directly
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={() => dialog.open("load")}>
                  <Truck /> Load on lorry
                </Button>
              </>
            )}
            {sale.status === "Loaded" && (
              <>
                <Button variant="outline" className="hidden xl:inline-flex" onClick={() => dialog.open("unload")}>
                  Unload
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={() => dialog.open("deliver")}>
                  <Truck /> <span className="sm:hidden">Deliver</span>
                  <span className="hidden sm:inline">Deliver & collect cash</span>
                </Button>
              </>
            )}
            {d.delivered && canPay && (
              <Button className="flex-1 sm:flex-none" onClick={() => dialog.open("payment")}>
                <HandCoins /> Add payment
              </Button>
            )}
            {sale.status === "Cancelled" && (
              <Button className="flex-1 sm:flex-none" onClick={restore}>
                <RotateCcw /> Restore
              </Button>
            )}
            <Menu
              aria-label="More actions"
              title="More actions"
              // From sm up it only holds the status changes (and the second step until xl)
              className={cn("px-2.5", statusEntries.length === 0 && "sm:hidden")}
              entries={[
                ...statusEntries,
                // The buttons that don't fit: the second step until xl; Print, Edit, Undo and Delete on phones
                { heading: "", until: "xl" },
                sale.status === "Ordered" && { label: "Deliver directly", description: "Without loading the lorry", icon: <Truck />, onSelect: () => dialog.open("deliver"), until: "xl" },
                sale.status === "Loaded" && {
                  label: "Unload",
                  description: "Stock goes back; load it again later",
                  icon: <PackageMinus />,
                  onSelect: () => dialog.open("unload"),
                  until: "xl",
                },
                { label: "Print", icon: <Printer />, onSelect: () => window.print(), until: "sm" },
                sale.status !== "Cancelled" && { label: "Edit bill", icon: <Pencil />, onSelect: () => router.push(`/sales/${sale.id}/edit`), until: "sm" },
                d.delivered && { label: "Undo delivery", description: "Back to on the lorry", icon: <Undo2 />, onSelect: () => dialog.open("undo"), until: "sm" },
                { heading: "", until: "sm" },
                { label: "Delete bill", icon: <Trash2 />, danger: true, onSelect: () => dialog.open("delete"), until: "sm" },
              ]}
            >
              <Ellipsis />
            </Menu>
          </>
        }
      />
      {status.dialogs}

      {sale.status === "Cancelled" && (
        <NextStep
          tone="red"
          icon={<Ban className="text-red-600" />}
          title="This bill is cancelled"
          text="It's kept for your records and doesn't count in sales, profit or the store's balance."
        />
      )}
      {sale.status === "Ordered" && (
        <NextStep
          tone={sale.late ? "amber" : "blue"}
          icon={<PackageOpen className={sale.late ? "text-amber-700" : "text-sky-700"} />}
          title={sale.late ? "Late delivery · waiting to load again" : "Bill created · waiting to load"}
          text="Load the items on the lorry. Stock is reduced when you mark it loaded."
        />
      )}
      {sale.status === "Loaded" && (
        <NextStep
          tone="blue"
          icon={<Truck className="text-sky-700" />}
          title={`On lorry ${sale.vehicleNumber || ""} since ${formatDate(sale.loadedDate)}`}
          text="When you give the items to the store, mark it delivered and record the money collected."
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
        />
      )}

      <Card>
        {/* Large: who the bill is for, Raigam's invoice number and what it comes to */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
          <div className="col-span-2 min-w-0 lg:col-span-1">
            <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Dealer (Store)</dt>
            <dd className="mt-0.5 text-lg leading-snug font-semibold">
              {shop ? (
                <Link href={`/stores/${shop.id}`} className="text-brand-700 hover:underline print:text-slate-900 print:no-underline">
                  {shop.shopName}
                </Link>
              ) : (
                <span className="text-slate-500">Deleted store</span>
              )}
            </dd>
            {shop && <dd className="text-xs text-slate-500">{[shop.shopCode, shop.ownerName, shop.phone].filter(Boolean).join(" · ")}</dd>}
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Raigam Invoice No.</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-lg leading-snug font-semibold text-slate-900 tabular-nums">
              {sale.invoiceNo || <span className="text-base font-medium text-slate-400">Not entered</span>}
              {sale.invoiceNo && <CheckedToggle sale={sale} />}
            </dd>
            <dd className="text-xs text-slate-500">Bill No. {sale.saleNo}</dd>
          </div>
          <div className="text-right">
            <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Invoice Value</dt>
            <dd className="mt-0.5 text-xl leading-snug font-bold text-slate-900 tabular-nums">{formatMoney(d.total)}</dd>
            <dd className={cn("text-xs font-medium tabular-nums", d.due > 0 ? "text-red-600" : d.delivered ? "text-emerald-700" : "text-slate-500")}>
              {d.delivered ? `Cash balance ${formatMoney(d.due)}` : "Cash balance after delivery"}
            </dd>
          </div>
        </dl>
        {/* The rest, small */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:grid-cols-4 lg:grid-cols-7">
          <SmallDetail label="Address">{[shop?.address, shop?.town].filter(Boolean).join(", ") || "—"}</SmallDetail>
          <SmallDetail label="Route / Territory">
            {/* The route's towns on hover, to keep the strip short */}
            <span title={route?.area || undefined}>{route ? `${route.routeCode} · ${route.routeName}` : "—"}</span>
          </SmallDetail>
          <SmallDetail label="Booking Date">{formatDate(sale.date)}</SmallDetail>
          <SmallDetail label="Actual Date">
            {d.delivered ? formatDate(sale.deliveredDate) : <span className="text-slate-500">Not delivered yet</span>}
            {sale.loadedDate && (
              <span className="block text-[11px] font-normal text-slate-500">
                Loaded {formatDate(sale.loadedDate)}
                {sale.vehicleNumber ? ` · ${sale.vehicleNumber}` : ""}
              </span>
            )}
          </SmallDetail>
          <SmallDetail label="Rep">{sale.repName || "—"}</SmallDetail>
          <SmallDetail label="Mode of Payment">
            {paymentMode || <span className="text-slate-500">Not paid yet</span>}
            {(billPayments.length > 0 || onCredit > 0) && (
              <span className="block text-[11px] font-normal text-slate-500">
                {[billPayments.length ? `${formatMoney(d.paid)} paid` : "", onCredit ? `${formatMoney(onCredit)} on credit` : ""].filter(Boolean).join(" · ")}
              </span>
            )}
          </SmallDetail>
          <SmallDetail label="End Date to Collect">
            {d.delivered ? (
              <DueDateLabel dueDate={sale.dueDate} due={d.due} overdueDays={d.overdueDays} />
            ) : sale.status === "Cancelled" ? (
              <span className="text-slate-500">—</span>
            ) : (
              <span className="text-slate-500">{shop?.creditDays ?? 21} days after delivery</span>
            )}
          </SmallDetail>
          {sale.notes && (
            <SmallDetail label="Note" className="col-span-full">
              {sale.notes}
            </SmallDetail>
          )}
          {sale.deliveryNote && (
            <SmallDetail label="Delivery Note" className="col-span-full">
              {sale.deliveryNote}
            </SmallDetail>
          )}
        </dl>
      </Card>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Invoice items <span className="font-normal text-slate-500">· {soldLines.length}</span>
            {nothingLeft && <span className="ml-2 font-normal text-red-600">· every item was taken off on Raigam, so nothing to load or collect</span>}
            {(removedCount > 0 || reducedCount > 0) && (
              <span className="ml-2 font-normal text-red-600">
                · {[removedCount ? `${removedCount} removed` : "", reducedCount ? `${reducedCount} reduced` : ""].filter(Boolean).join(", ")}
                {reducedValue > 0 ? ` (− ${formatMoney(reducedValue)})` : ""}
              </span>
            )}
            {priced.length > 0 && (
              <span className="ml-2 font-normal text-amber-700 print:hidden">
                · {priced.length} priced differently from your wholesale price ({pricedEffect > 0 ? "+" : "−"} {formatMoney(Math.abs(pricedEffect))} on
                this bill)
              </span>
            )}
          </h2>
        </div>
        {/* The bill in one line: items, less the return items (listed below the items), and what it comes to */}
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-5 py-3 text-sm print:hidden">
          <div>
            <dt className="text-xs text-slate-500">Items ({formatQty(units)} units)</dt>
            <dd className="font-medium text-slate-900 tabular-nums">{formatMoney(itemsTotal(sale))}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">
              Returns
              {sale.returns.length > 0 &&
                ` (${formatQty(sale.returns.length)} item${sale.returns.length === 1 ? "" : "s"}, ${formatQty(returnUnits)} unit${returnUnits === 1 ? "" : "s"})`}
            </dt>
            <dd className={cn("font-medium tabular-nums", sale.returns.length ? "text-red-600" : "text-slate-400")}>
              {sale.returns.length ? `− ${formatMoney(returnsTotal(sale))}` : "None"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Value after returns</dt>
            <dd className="font-medium text-slate-900 tabular-nums">{formatMoney(saleSubtotal(sale))}</dd>
          </div>
          {sale.discount > 0 && (
            <div>
              <dt className="text-xs text-slate-500">Bill discount ({sale.discountPercent}%)</dt>
              <dd className="font-medium text-slate-900 tabular-nums">− {formatMoney(sale.discount)}</dd>
            </div>
          )}
          <div className="sm:ml-auto sm:text-right">
            <dt className="text-xs text-slate-500">Invoice value</dt>
            <dd className="text-base font-semibold text-slate-900 tabular-nums">{formatMoney(d.total)}</dd>
          </div>
        </dl>
        <Table>
          <THead>
            <tr>
              <TH>#</TH>
              <TH>Item Description</TH>
              <TH className="text-right">{hasTakenOff || soldReduced ? "Booked" : "Qty"}</TH>
              {hasTakenOff && <TH className="text-right">Taken off</TH>}
              {soldReduced && <TH className="text-right">Reduced</TH>}
              <TH className="text-right">Free</TH>
              <TH className="text-right">Unit Price</TH>
              <TH className="text-right">Disc. %</TH>
              <TH className="text-right">Disc. Value</TH>
              {hasCancel && <TH className="text-right">Cancelled</TH>}
              <TH className="text-right">Value</TH>
              {canReduce && <TH className="w-16 text-center print:hidden">Remove</TH>}
              {canEditItems && (
                <TH className="w-12 print:hidden">
                  <span className="sr-only">Edit</span>
                </TH>
              )}
            </tr>
          </THead>
          <TBody>
            {soldLines.length === 0 && (
              <EmptyRow colSpan={soldColumns}>No items on this bill.</EmptyRow>
            )}
            {soldLines.map((l, i) => {
              const item = itemMap.get(l.sapCode);
              const book = round2(chargedQty(l) * l.unitPrice);
              const diff = wholesaleDifference(l.unitPrice, item?.wholesalePrice);
              const removed = isRemoved(l);
              return (
                <Fragment key={l.id}>
                  {startsCategory(soldLines, i) && <GroupRow colSpan={soldColumns}>{categoryOfLine(l)}</GroupRow>}
                  <TR className={cn(removed && "bg-red-50/80")}>
                    <TD className="text-slate-400 tabular-nums">{i + 1}</TD>
                    <ItemCell line={l} name={item?.description} packageDetails={item?.packageDetails} />
                    {/* Booked on Raigam = what's left on the bill + what was taken off there */}
                    <TD className="text-right tabular-nums">{formatQty(l.qty + l.takenOff)}</TD>
                    {hasTakenOff && (
                      <TD className={cn("text-right tabular-nums", l.takenOff > 0 && "font-medium text-red-600")}>
                        {/* Opens the item to change it (hidden as a plain number on the printed bill) */}
                        {canEditItems ? (
                          <button
                            type="button"
                            onClick={() => editItem.open(l)}
                            className="rounded px-1 tabular-nums underline decoration-dotted underline-offset-4 hover:bg-red-50 print:no-underline"
                            title="Change the taken off qty"
                          >
                            {l.takenOff ? formatQty(l.takenOff) : "—"}
                          </button>
                        ) : l.takenOff ? (
                          formatQty(l.takenOff)
                        ) : (
                          "—"
                        )}
                      </TD>
                    )}
                    {soldReduced && (
                      <TD className={cn("text-right tabular-nums", missingSold(l) > 0 && "font-medium text-red-600")}>
                        {missingSold(l) ? formatQty(missingSold(l)) : "—"}
                      </TD>
                    )}
                    <TD className={cn("text-right tabular-nums", removed && l.freeQty > 0 && "text-red-600 line-through")}>
                      {l.freeQty ? formatQty(l.freeQty) : "—"}
                    </TD>
                    <TD className={cn("text-right tabular-nums", diff && chargedQty(l) > 0 && "bg-amber-50/70")}>
                      {formatMoney(l.unitPrice)}
                      {diff !== 0 && chargedQty(l) > 0 && (
                        <span className="block text-xs font-medium text-amber-700 print:hidden" title="Your wholesale price for this item, and how much the bill's price differs">
                          Wholesale {formatMoney(item!.wholesalePrice)} · {diff > 0 ? "+" : "−"}
                          {formatMoney(Math.abs(diff))}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{l.discountPct ? `${l.discountPct}%` : "—"}</TD>
                    <TD className="text-right tabular-nums">{l.discountPct ? formatMoney(round2(book - lineValue(l))) : "—"}</TD>
                    {hasCancel && <TD className="text-right tabular-nums">{l.cancelQty ? formatQty(l.cancelQty) : "—"}</TD>}
                    <TD className={cn("text-right font-medium tabular-nums", removed ? "text-red-600" : "text-slate-900")}>{formatMoney(lineValue(l))}</TD>
                    {canReduce && <RemoveCell line={l} name={item?.description ?? l.sapCode} onToggle={() => toggleRemoved(l)} />}
                    {canEditItems && <EditItemCell onClick={() => editItem.open(l)} name={item?.description ?? l.sapCode} />}
                  </TR>
                </Fragment>
              );
            })}
          </TBody>
        </Table>

        {freeLines.length > 0 && (
          <>
            <div className="border-t border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Free issue items <span className="font-normal text-slate-500">· given free with this bill, not charged, Raigam pays them back</span>
              </h2>
            </div>
            <Table>
              <THead>
                <tr>
                  <TH>#</TH>
                  <TH>Item Description</TH>
                  <TH className="text-right">Free Qty</TH>
                  {freeReduced && <TH className="text-right">Reduced</TH>}
                  <TH className="text-right">Unit Price</TH>
                  <TH className="text-right">Free Value</TH>
                  {canReduce && <TH className="w-16 text-center print:hidden">Remove</TH>}
                  {canEditItems && (
                    <TH className="w-12 print:hidden">
                      <span className="sr-only">Edit</span>
                    </TH>
                  )}
                </tr>
              </THead>
              <TBody>
                {freeLines.map((l, i) => {
                  const item = itemMap.get(l.sapCode);
                  const removed = isRemoved(l);
                  return (
                    <Fragment key={l.id}>
                      {startsCategory(freeLines, i) && (
                        <GroupRow colSpan={5 + Number(freeReduced) + Number(canReduce) + Number(canEditItems)}>{categoryOfLine(l)}</GroupRow>
                      )}
                      <TR className={cn(removed && "bg-red-50/80")}>
                        <TD className="text-slate-400 tabular-nums">{i + 1}</TD>
                        <ItemCell
                          line={l}
                          name={item?.description}
                          packageDetails={item?.packageDetails}
                          freeWith={l.freeWith ? (itemMap.get(l.freeWith)?.description ?? l.freeWith) : undefined}
                        />
                        <TD className="text-right font-medium text-slate-900 tabular-nums">{formatQty(l.freeQty)}</TD>
                        {freeReduced && (
                          <TD className={cn("text-right tabular-nums", l.missingQty > 0 && "font-medium text-red-600")}>
                            {l.missingQty ? formatQty(l.missingQty) : "—"}
                          </TD>
                        )}
                        <TD className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TD>
                        <TD className={cn("text-right tabular-nums", removed && "text-red-600")}>{formatMoney(round2(freeGiven(l) * l.unitPrice))}</TD>
                        {canReduce && <RemoveCell line={l} name={item?.description ?? l.sapCode} onToggle={() => toggleRemoved(l)} />}
                        {canEditItems && <EditItemCell onClick={() => editItem.open(l)} name={item?.description ?? l.sapCode} />}
                      </TR>
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </>
        )}

        {(sale.returns.length > 0 || canEditItems) && (
          <>
            {/* With no returns, only the Add return bar shows (and nothing is printed) */}
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200 px-5 py-3",
                sale.returns.length > 0 ? "border-b" : "print:hidden",
              )}
            >
              <h2 className="text-sm font-semibold text-slate-900">
                Return items{" "}
                <span className="font-normal text-slate-500">
                  {sale.returns.length > 0
                    ? `· ${sale.status === "Delivered" ? "taken at delivery" : "to collect at delivery"}, credited on this bill, sent back to Raigam`
                    : "· none. Good or market returns the store gives back are credited on this bill (Add › Return item at the top)."}
                </span>
              </h2>
            </div>
            {sale.returns.length > 0 && (
              <Table>
                <THead>
                  <tr>
                    <TH>Type</TH>
                    <TH>Item Description</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">Unit Price</TH>
                    <TH className="text-right">Value</TH>
                    {canEditItems && (
                      <TH className="w-24 print:hidden">
                        <span className="sr-only">Actions</span>
                      </TH>
                    )}
                  </tr>
                </THead>
                <TBody>
                  {sale.returns.map((r) => {
                    const name = itemMap.get(r.sapCode)?.description ?? r.sapCode;
                    return (
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
                        {canEditItems && (
                          <TD className="print:hidden">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => editReturn.open(r)} aria-label={`Edit return of ${name}`} title="Edit this return">
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="hover:bg-red-50 hover:text-red-600"
                                onClick={() => removeReturn.open(r)}
                                aria-label={`Remove return of ${name}`}
                                title="Remove this return"
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TD>
                        )}
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
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
            {d.extraCredit > 0 && (
              <>
                <dt className="text-slate-500">Credit added at delivery</dt>
                <dd className="text-right tabular-nums">+ {formatMoney(d.extraCredit)}</dd>
              </>
            )}
            {d.delivered && d.payments.length === 0 && (
              <>
                <dt className="text-slate-500">Paid</dt>
                <dd className="text-right tabular-nums">{formatMoney(0)}</dd>
              </>
            )}
            {d.payments.map((p) => (
              <div key={p.paymentId} className="contents">
                <dt className="text-slate-500">
                  {p.pending ? "Cheque to collect" : "Paid"} {p.receiptNo} <span className="text-xs">({formatDate(p.date)})</span>
                </dt>
                {/* A cheque still to collect isn't paid yet: shown, not taken off */}
                <dd className={cn("text-right tabular-nums", p.pending ? "text-slate-400" : "text-emerald-700")}>
                  {p.pending ? `(${formatMoney(p.amount)})` : `− ${formatMoney(p.amount)}`}
                </dd>
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
                ? "Fully paid. Paid part cash, part cheque? Lower a payment's amount with the pencil, then add the rest."
                : d.delivered
                  ? `${formatMoney(d.paid)} paid · ${formatMoney(left)} on credit, to collect by ${formatDate(sale.dueDate)}`
                  : d.paid > 0
                    ? `${formatMoney(d.paid)} paid in advance · ${formatMoney(left)} left to collect after delivery`
                    : "Paid with the order or in advance? Add it here. The rest is collected after delivery."
            }
            actions={
              <Button size="sm" variant="secondary" onClick={() => dialog.open("payment")} disabled={!canPay} title={canPay ? undefined : "Nothing left to pay on this bill"}>
                <Plus /> Add payment
              </Button>
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
                      <>
                        <span className="block text-xs text-slate-500">
                          No. {p.payment.chequeNumber || "—"}
                          {p.payment.chequeDate ? ` · ${formatDate(p.payment.chequeDate)}` : ""}
                        </span>
                        <span className="mt-1 block">
                          <ChequeStatusBadge payment={p.payment} />
                        </span>
                      </>
                    )}
                  </TD>
                  <TD className="max-w-64 whitespace-normal text-slate-600">{p.payment?.reference || <span className="text-slate-400">—</span>}</TD>
                  <TD className={cn("text-right font-medium tabular-nums", p.pending ? "text-slate-500" : "text-emerald-700")}>
                    {formatMoney(p.amount)}
                    {p.pending && <span className="block text-xs font-normal">not paid until collected</span>}
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
      <BillItemDialog
        sale={sale}
        line={typeof editItem.target === "string" ? null : editItem.target}
        addKind={typeof editItem.target === "string" ? editItem.target : "item"}
        open={editItem.isOpen}
        onClose={editItem.close}
      />
      <BillReturnDialog sale={sale} ret={editReturn.target === "new" ? null : editReturn.target} open={editReturn.isOpen} onClose={editReturn.close} />
      <ConfirmDialog
        open={removeReturn.isOpen}
        onClose={removeReturn.close}
        title={`Remove this return from ${sale.saleNo}?`}
        message={
          removeReturn.target
            ? `${removeReturn.target.kind} return of ${itemMap.get(removeReturn.target.sapCode)?.description ?? removeReturn.target.sapCode} × ${formatQty(
                removeReturn.target.qty,
              )}: ${formatMoney(round2(removeReturn.target.qty * removeReturn.target.unitPrice))} is no longer credited, so the invoice value goes up.`
            : ""
        }
        confirmLabel="Remove return"
        onConfirm={async () => {
          if (!removeReturn.target) return;
          const result = await removeBillReturn(sale.id, removeReturn.target.id);
          if (result.ok) toast.success(`Return removed from ${sale.saleNo}`);
          else toast.error(result.error);
          removeReturn.close();
        }}
      />
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
          router.push("/invoices");
        }}
      />
    </>
  );
}
