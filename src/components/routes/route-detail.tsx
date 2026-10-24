"use client";

import { HandCoins, Pencil, Plus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ActiveBadge, Badge, DayChips } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { BackLink, Card, CardHeader, Detail, NotFoundState, PageHeader, SummaryTile } from "@/components/ui/layout";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PaymentFormDialog } from "@/components/payments/payment-form-dialog";
import { ShopFormDialog } from "@/components/shops/shop-form-dialog";
import { saleTotal } from "@/lib/ledger";
import { useAppStore, useShopBalances } from "@/lib/store";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatMoney, monthStartISO } from "@/lib/utils";
import { RouteFormDialog } from "./route-form-dialog";

type Dialog = { kind: "edit" } | { kind: "addShop" } | { kind: "payment"; shopId: string };

export function RouteDetail({ id }: { id: string }) {
  const route = useAppStore((s) => s.routes.find((r) => r.id === id));
  const allShops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  const balances = useShopBalances();
  const dialog = useDialog<Dialog>();

  const shops = useMemo(
    () => allShops.filter((s) => s.routeId === id).sort((a, b) => Number(b.active) - Number(a.active) || a.shopCode.localeCompare(b.shopCode)),
    [allShops, id],
  );

  if (!route) return <NotFoundState title="Route not found" href="/routes" linkLabel="Back to routes" />;

  const shopIds = new Set(shops.map((s) => s.id));
  const monthStart = monthStartISO();
  const outstanding = shops.reduce((sum, s) => sum + (balances.get(s.id)?.balance ?? 0), 0);
  const monthSales = sales
    .filter((s) => shopIds.has(s.shopId) && s.status === "Delivered" && s.deliveredDate >= monthStart)
    .reduce((sum, s) => sum + saleTotal(s), 0);
  const monthCollected = payments.filter((p) => shopIds.has(p.shopId) && p.date >= monthStart).reduce((sum, p) => sum + p.amount, 0);
  const overdue = shops.reduce((sum, s) => sum + (balances.get(s.id)?.overdue ?? 0), 0);
  const overLimit = shops.filter((s) => (balances.get(s.id)?.balance ?? 0) > s.creditLimit).length;

  return (
    <>
      <BackLink href="/routes">Routes</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {route.routeCode} · {route.routeName} <ActiveBadge active={route.active} />
          </span>
        }
        description={route.area || undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => dialog.open({ kind: "edit" })}>
              <Pencil /> Edit route
            </Button>
            <Button onClick={() => dialog.open({ kind: "addShop" })}>
              <Plus /> Add store
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Stores" value={shops.filter((s) => s.active).length} sub={`${shops.length} in total`} />
        <SummaryTile
          label="Cash balance"
          value={formatMoney(outstanding)}
          sub={overLimit ? `${overLimit} store${overLimit > 1 ? "s" : ""} over credit limit` : "All within credit limit"}
          tone={overLimit ? "danger" : "default"}
        />
        <SummaryTile
          label="Overdue"
          value={formatMoney(overdue)}
          sub={`Delivered this month: ${formatMoney(monthSales)}`}
          tone={overdue > 0 ? "danger" : "default"}
        />
        <SummaryTile label="Collected this month" value={formatMoney(monthCollected)} tone="good" />
      </div>

      <Card className="mt-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:grid-cols-4">
          <Detail label="Visit Days">
            <DayChips days={route.visitDays} />
          </Detail>
          <Detail label="Sales Rep">{route.salesRep || "—"}</Detail>
          <Detail label="Vehicle Number">{route.vehicleNumber || "—"}</Detail>
          <Detail label="Area / Towns">{route.area || "—"}</Detail>
        </dl>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Stores on this route" description="Cash balance is what each store owes you." />
        <Table>
          <THead>
            <tr>
              <TH>Store No.</TH>
              <TH>Store Name</TH>
              <TH>Phone</TH>
              <TH>Town</TH>
              <TH className="text-right">Credit Limit</TH>
              <TH className="text-right">Cash Balance</TH>
              <TH>Last Delivery</TH>
              <TH className="w-28">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {shops.length === 0 && <EmptyRow colSpan={8}>No stores on this route yet.</EmptyRow>}
            {shops.map((s) => {
              const b = balances.get(s.id);
              const over = (b?.balance ?? 0) > s.creditLimit;
              return (
                <TR key={s.id} className={cn(!s.active && "opacity-60")}>
                  <TD className="font-semibold text-brand-700">
                    <Link href={`/stores/${s.id}`} className="hover:underline">
                      {s.shopCode}
                    </Link>
                  </TD>
                  <TD className="whitespace-normal">
                    <Link href={`/stores/${s.id}`} className="block font-medium text-slate-900 hover:underline">
                      {s.shopName}
                    </Link>
                    <span className="block text-xs text-slate-500">{s.ownerName}</span>
                  </TD>
                  <TD>
                    {s.phone ? (
                      <a href={`tel:${s.phone.replace(/\s/g, "")}`} className="hover:underline">
                        {s.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD>{s.town || "—"}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(s.creditLimit)}</TD>
                  <TD className="text-right">
                    <span className={cn("font-semibold tabular-nums", over ? "text-red-600" : "text-slate-900")}>
                      {formatMoney(b?.balance ?? 0)}
                    </span>
                    {over && (
                      <Badge tone="red" className="ml-2">
                        Over limit
                      </Badge>
                    )}
                    {(b?.overdue ?? 0) > 0 && <span className="block text-xs font-medium text-red-600">{formatMoney(b!.overdue)} overdue</span>}
                  </TD>
                  <TD className="tabular-nums">{formatDate(b?.lastSaleDate ?? "")}</TD>
                  <TD>
                    <RowActions>
                      {s.active && (
                        <Link
                          href={`/sales/new?store=${s.id}`}
                          className={buttonClass("ghost", "icon")}
                          aria-label={`New bill for ${s.shopName}`}
                          title="New bill"
                        >
                          <ShoppingCart />
                        </Link>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => dialog.open({ kind: "payment", shopId: s.id })}
                        aria-label={`Record payment from ${s.shopName}`}
                        title="Record payment"
                      >
                        <HandCoins />
                      </Button>
                    </RowActions>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <RouteFormDialog open={dialog.target?.kind === "edit"} route={route} onClose={dialog.close} />
      <ShopFormDialog open={dialog.target?.kind === "addShop"} shop={null} defaultRouteId={route.id} onClose={dialog.close} />
      <PaymentFormDialog
        open={dialog.target?.kind === "payment"}
        payment={null}
        defaultShopId={dialog.target?.kind === "payment" ? dialog.target.shopId : undefined}
        onClose={dialog.close}
      />
    </>
  );
}
