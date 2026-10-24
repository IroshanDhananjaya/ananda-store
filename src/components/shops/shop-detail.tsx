"use client";

import { ExternalLink, HandCoins, Link2, Pencil, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";
import { ActiveBadge, Badge, BillStatusBadge, DueDateLabel } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BackLink, Card, CardHeader, Detail, NotFoundState, PageHeader, SummaryTile } from "@/components/ui/layout";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PaymentFormDialog } from "@/components/payments/payment-form-dialog";
import { openBills, saleTotal, shopLedger } from "@/lib/ledger";
import { useAppStore, useRouteMap, useShopBalances } from "@/lib/store";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { ShopFormDialog } from "./shop-form-dialog";

type Dialog = { kind: "edit" } | { kind: "payment"; billId?: string } | { kind: "delete" };

export function ShopDetail({ id }: { id: string }) {
  const router = useRouter();
  const shop = useAppStore((s) => s.shops.find((x) => x.id === id));
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  const deleteShop = useAppStore((s) => s.deleteShop);
  const linkPayments = useAppStore((s) => s.linkPayments);
  const routeMap = useRouteMap();
  const balances = useShopBalances();
  const dialog = useDialog<Dialog>();

  const ledger = useMemo(() => (shop ? shopLedger(shop, sales, payments) : []), [shop, sales, payments]);
  const bills = useMemo(() => (shop ? openBills(shop, sales, payments) : []), [shop, sales, payments]);
  const notDelivered = useMemo(() => sales.filter((s) => s.shopId === id && (s.status === "Ordered" || s.status === "Loaded")), [sales, id]);

  if (!shop) return <NotFoundState title="Store not found" href="/stores" linkLabel="Back to stores" />;

  const b = balances.get(shop.id)!;
  const route = routeMap.get(shop.routeId);
  const over = b.balance > shop.creditLimit;
  const used = shop.creditLimit > 0 ? Math.min(100, Math.max(0, (b.balance / shop.creditLimit) * 100)) : b.balance > 0 ? 100 : 0;

  return (
    <>
      <BackLink href="/stores">Stores</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {shop.shopName} <ActiveBadge active={shop.active} />
          </span>
        }
        description={`${shop.shopCode}${shop.ownerName ? ` · Owner: ${shop.ownerName}` : ""}`}
        actions={
          <>
            {shop.active && (
              <Link href={`/sales/new?store=${shop.id}`} className={buttonClass("outline")}>
                <ShoppingCart /> New bill
              </Link>
            )}
            <Button onClick={() => dialog.open({ kind: "payment" })}>
              <HandCoins /> Record payment
            </Button>
            <Button variant="outline" size="icon" className="size-10" onClick={() => dialog.open({ kind: "edit" })} aria-label="Edit store" title="Edit store">
              <Pencil />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-10 text-red-600 hover:bg-red-50"
              onClick={() => dialog.open({ kind: "delete" })}
              aria-label="Delete store"
              title="Delete store"
            >
              <Trash2 />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Cash balance</p>
          <p className={cn("mt-1.5 text-xl font-semibold tracking-tight tabular-nums", over ? "text-red-600" : "text-slate-900")}>
            {formatMoney(b.balance)}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className={cn("h-full rounded-full", over ? "bg-red-500" : used > 75 ? "bg-amber-500" : "bg-brand-500")} style={{ width: `${used}%` }} />
          </div>
          <p className={cn("mt-1.5 text-xs", over ? "font-medium text-red-600" : "text-slate-500")}>
            {over
              ? `${formatMoney(b.balance - shop.creditLimit)} over the ${formatMoney(shop.creditLimit)} limit`
              : `${formatMoney(shop.creditLimit - b.balance)} credit left of ${formatMoney(shop.creditLimit)}`}
          </p>
        </div>
        <SummaryTile label="Total billed" value={formatMoney(b.sales)} sub={`Last delivery ${formatDate(b.lastSaleDate)}`} />
        <SummaryTile label="Total paid" value={formatMoney(b.paid)} sub={`Last payment ${formatDate(b.lastPaymentDate)}`} tone="good" />
        <SummaryTile
          label="Overdue"
          value={formatMoney(b.overdue)}
          sub={b.overdueBills ? `${b.overdueBills} bill${b.overdueBills > 1 ? "s" : ""} past the end date` : `Credit days: ${shop.creditDays}`}
          tone={b.overdue > 0 ? "danger" : "default"}
        />
      </div>

      <Card className="mt-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:grid-cols-4">
          <Detail label="Owner">{shop.ownerName || "—"}</Detail>
          <Detail label="Phone">
            {shop.phone ? (
              <a href={`tel:${shop.phone.replace(/\s/g, "")}`} className="text-brand-700 hover:underline">
                {shop.phone}
              </a>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label="Route">
            {route ? (
              <Link href={`/routes/${route.id}`} className="text-brand-700 hover:underline">
                {route.routeCode} · {route.routeName}
              </Link>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label="Location">
            {[shop.address, shop.town].filter(Boolean).join(", ") || "—"}
            {shop.mapLink && (
              <a href={shop.mapLink} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs text-brand-700 hover:underline">
                Open in Google Maps <ExternalLink className="size-3" />
              </a>
            )}
          </Detail>
          {shop.notes && (
            <div className="col-span-2 lg:col-span-4">
              <Detail label="Notes">{shop.notes}</Detail>
            </div>
          )}
        </dl>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Bills to collect"
          description="Delivered bills with a cash balance, oldest first. Payments are linked to these bills."
          actions={
            b.unlinked > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const result = await linkPayments(shop.id);
                  if (result.ok) toast.success("Payments linked to the oldest bills");
                  else toast.error(result.error);
                }}
                title="Use the advance to pay the oldest bills"
              >
                <Link2 /> Use {formatMoney(b.unlinked)} advance
              </Button>
            ) : undefined
          }
        />
        <Table>
          <THead>
            <tr>
              <TH>Bill</TH>
              <TH>Delivered</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Cash Balance</TH>
              <TH>End Date</TH>
              <TH>
                <span className="sr-only">Collect</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {bills.length === 0 && <EmptyRow colSpan={7}>Nothing to collect from this store.</EmptyRow>}
            {bills.map((bill) => (
              <TR key={bill.id} className={cn(bill.overdueDays > 0 && "bg-red-50/40")}>
                <TD className="font-semibold">
                  {bill.date ? (
                    <Link href={`/sales/${bill.id}`} className="text-brand-700 hover:underline">
                      {bill.ref}
                    </Link>
                  ) : (
                    <span className="text-slate-700">{bill.ref}</span>
                  )}
                </TD>
                <TD className="tabular-nums">{bill.date ? formatDate(bill.date) : "—"}</TD>
                <TD className="text-right tabular-nums">{formatMoney(bill.total)}</TD>
                <TD className="text-right text-emerald-700 tabular-nums">{bill.paid ? formatMoney(bill.paid) : "—"}</TD>
                <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(bill.due)}</TD>
                <TD>
                  <DueDateLabel dueDate={bill.dueDate} due={bill.due} overdueDays={bill.overdueDays} />
                </TD>
                <TD className="text-right">
                  <Button variant="secondary" size="sm" onClick={() => dialog.open({ kind: "payment", billId: bill.id })}>
                    <HandCoins /> Collect
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {b.unlinked > 0 && (
          <p className="border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">
            {formatMoney(b.unlinked)} paid by this store isn&apos;t linked to a bill (kept as an advance). It is already taken off the cash balance.
          </p>
        )}
      </Card>

      {notDelivered.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Bills not delivered yet" description="Not owed until delivered." />
          <Table>
            <THead>
              <tr>
                <TH>Bill</TH>
                <TH>Bill Date</TH>
                <TH>Rep</TH>
                <TH className="text-right">Total</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {notDelivered.map((s) => (
                <TR key={s.id}>
                  <TD className="font-semibold">
                    <Link href={`/sales/${s.id}`} className="text-brand-700 hover:underline">
                      {s.saleNo}
                    </Link>
                  </TD>
                  <TD className="tabular-nums">{formatDate(s.date)}</TD>
                  <TD>{s.repName || "—"}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(saleTotal(s))}</TD>
                  <TD>
                    <BillStatusBadge status={s.status === "Loaded" ? "Loaded" : "Ordered"} late={s.late} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Statement" description="Every delivered bill and payment, with the running cash balance." />
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH>Ref.</TH>
              <TH>Details</TH>
              <TH className="text-right">Bill</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Balance</TH>
            </tr>
          </THead>
          <TBody>
            {ledger.map((e) => (
              <TR key={e.key} className={cn(e.kind === "Opening" && "bg-slate-50/70")}>
                <TD className="tabular-nums">{e.date ? formatDate(e.date) : ""}</TD>
                <TD>
                  {e.kind === "Opening" ? (
                    <span className="text-slate-500">Opening</span>
                  ) : (
                    <Badge tone={e.kind === "Sale" ? "blue" : "green"}>{e.kind === "Sale" ? "Bill" : "Payment"}</Badge>
                  )}
                </TD>
                <TD className="font-medium">
                  {e.kind === "Sale" ? (
                    <Link href={`/sales/${e.refId}`} className="text-brand-700 hover:underline">
                      {e.ref}
                    </Link>
                  ) : (
                    e.ref
                  )}
                </TD>
                <TD className="whitespace-normal text-slate-600">{e.details}</TD>
                <TD className="text-right tabular-nums">{e.debit ? formatMoney(e.debit) : ""}</TD>
                <TD className="text-right text-emerald-700 tabular-nums">{e.credit ? formatMoney(e.credit) : ""}</TD>
                <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(e.balance)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <ShopFormDialog open={dialog.target?.kind === "edit"} shop={shop} onClose={dialog.close} />
      <PaymentFormDialog
        open={dialog.target?.kind === "payment"}
        payment={null}
        defaultShopId={shop.id}
        defaultSaleId={dialog.target?.kind === "payment" ? dialog.target.billId : undefined}
        onClose={dialog.close}
      />
      <ConfirmDialog
        open={dialog.target?.kind === "delete"}
        onClose={dialog.close}
        title={`Delete ${shop.shopName}?`}
        message="Stores with sales or payments can't be deleted. Edit the store and untick Active instead."
        onConfirm={async () => {
          const result = await deleteShop(shop.id);
          dialog.close();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Store deleted");
          router.push("/stores");
        }}
      />
    </>
  );
}
