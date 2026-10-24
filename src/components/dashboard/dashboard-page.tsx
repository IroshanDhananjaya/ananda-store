"use client";

import { AlertTriangle, ArrowRight, Coins, HandCoins, PackagePlus, Plus, ShieldAlert, TrendingUp, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DueDateLabel, OrderStatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/layout";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { profitFor } from "@/lib/profit";
import { LowStockCard } from "./low-stock-card";
import { useAppStore, useItemMap, useOrderMap, useSaleDues, useShopBalances, useShopMap } from "@/lib/store";
import { cn, formatDate, formatMoney, formatQty, LOW_STOCK_LEVEL, lineStatus, monthStartISO, orderStatus, todayISO } from "@/lib/utils";

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">{children}</h2>;
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
      {children} <ArrowRight className="size-4" />
    </Link>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  icon: ReactNode;
  href: string;
  tone: "amber" | "blue" | "red" | "green";
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-sky-50 text-sky-700",
    red: "bg-red-50 text-red-700",
    green: "bg-brand-50 text-brand-700",
  };
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={cn("grid size-9 place-items-center rounded-lg [&_svg]:size-4.5", tones[tone])}>{icon}</span>
      </div>
      <span className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</span>
      <span className="text-xs text-slate-500">{sub}</span>
    </Link>
  );
}

export function DashboardPage() {
  const orders = useAppStore((s) => s.orders);
  const orderItems = useAppStore((s) => s.orderItems);
  const stock = useAppStore((s) => s.stock);
  const itemMap = useItemMap();
  const orderMap = useOrderMap();

  const pending = orders.filter((o) => orderStatus(o) === "Pending");
  const toPost = orders.filter((o) => orderStatus(o) === "Received");
  const unmatched = orderItems.filter((l) => lineStatus(l, orderMap.get(l.orderId)) === "Unmatch");
  const lowStock = stock.filter((r) => r.availableQty <= LOW_STOCK_LEVEL).sort((a, b) => a.availableQty - b.availableQty);
  const stockUnits = stock.reduce((s, r) => s + r.availableQty, 0);
  const stockValue = stock.reduce((s, r) => s + r.availableQty * (itemMap.get(r.sapCode)?.wholesalePrice ?? 0), 0);

  const actionOrders = [...toPost, ...pending].sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  const qtyFor = (orderId: string) => orderItems.filter((l) => l.orderId === orderId).reduce((s, l) => s + l.orderedQty, 0);

  // Sales side
  const shops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  const balances = useShopBalances();
  const shopMap = useShopMap();
  const monthStart = monthStartISO();
  const outstanding = shops.reduce((sum, s) => sum + (balances.get(s.id)?.balance ?? 0), 0);
  const owingCount = shops.filter((s) => (balances.get(s.id)?.balance ?? 0) > 0).length;
  const dues = useSaleDues();
  const monthCollected = payments.filter((p) => p.date >= monthStart).reduce((sum, p) => sum + p.amount, 0);
  const overdueTotal = shops.reduce((sum, s) => sum + (balances.get(s.id)?.overdue ?? 0), 0);
  const overdueBills = sales.filter((s) => (dues.get(s.id)?.overdueDays ?? 0) > 0).length;
  const expenses = useAppStore((s) => s.expenses);
  const now = todayISO();
  const monthProfit = profitFor(sales, expenses, { year: Number(now.slice(0, 4)), month: Number(now.slice(5, 7)) });
  // Quantity bills waiting to load still need from each stock row
  const needed = new Map<string, number>();
  for (const s of sales.filter((x) => x.status === "Ordered")) {
    for (const l of s.lines) needed.set(`${l.sapCode}|${l.locationNumber}`, (needed.get(`${l.sapCode}|${l.locationNumber}`) ?? 0) + l.qty + l.freeQty);
  }
  const topBalances = shops
    .map((s) => ({ shop: s, balance: balances.get(s.id)?.balance ?? 0 }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 6);
  // Bills to collect, soonest end date first (overdue ones come first)
  const toCollect = sales
    .filter((s) => (dues.get(s.id)?.due ?? 0) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 7);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <>
            <Link href="/sales?load=1" className={buttonClass("outline")}>
              <Truck /> Load lorry
            </Link>
            <Link href="/sales/new" className={buttonClass()}>
              <Plus /> New store order
            </Link>
          </>
        }
      />

      <SectionLabel>Store orders & collections</SectionLabel>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Cash balance due"
          value={<span className="text-2xl">{formatMoney(outstanding)}</span>}
          sub={`To collect from ${owingCount} store${owingCount === 1 ? "" : "s"}`}
          icon={<Wallet />}
          href="/stores"
          tone="amber"
        />
        <StatCard
          label="Overdue"
          value={<span className="text-2xl">{formatMoney(overdueTotal)}</span>}
          sub={`${overdueBills} bill${overdueBills === 1 ? "" : "s"} past the end date`}
          icon={<ShieldAlert />}
          href="/sales?filter=overdue"
          tone="red"
        />
        <StatCard
          label="Net profit this month"
          value={<span className={cn("text-2xl", monthProfit.net < 0 && "text-red-600")}>{monthProfit.net < 0 ? `− ${formatMoney(-monthProfit.net)}` : formatMoney(monthProfit.net)}</span>}
          sub={`Gross ${formatMoney(monthProfit.gross)} − expenses ${formatMoney(monthProfit.expenses)}`}
          icon={<TrendingUp />}
          href="/profit"
          tone="blue"
        />
        <StatCard
          label="Collected this month"
          value={<span className="text-2xl">{formatMoney(monthCollected)}</span>}
          sub="All payments received"
          icon={<HandCoins />}
          href="/payments"
          tone="green"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Bills to collect"
            description="Delivered bills with a cash balance, soonest end date first."
            actions={<CardLink href="/sales?filter=due">All bills</CardLink>}
          />
          <Table>
            <THead>
              <tr>
                <TH>Bill No.</TH>
                <TH>Store</TH>
                <TH className="text-right">Cash Balance</TH>
                <TH>End Date</TH>
              </tr>
            </THead>
            <TBody>
              {toCollect.length === 0 && <EmptyRow colSpan={4}>Nothing to collect.</EmptyRow>}
              {toCollect.map((s) => {
                const d = dues.get(s.id)!;
                return (
                  <TR key={s.id} className={cn(d.overdueDays > 0 && "bg-red-50/40")}>
                    <TD className="font-semibold text-brand-700">
                      <Link href={`/sales/${s.id}`} className="hover:underline">
                        {s.saleNo}
                      </Link>
                    </TD>
                    <TD className="whitespace-normal">
                      {shopMap.get(s.shopId)?.shopName ?? "Deleted store"}
                      <span className="block text-xs text-slate-500">{shopMap.get(s.shopId)?.phone}</span>
                    </TD>
                    <TD className="text-right font-semibold tabular-nums">{formatMoney(d.due)}</TD>
                    <TD>
                      <DueDateLabel dueDate={s.dueDate} due={d.due} overdueDays={d.overdueDays} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Highest cash balances" description="Stores that owe you the most." actions={<CardLink href="/stores">Stores</CardLink>} />
          <ul className="divide-y divide-slate-100">
            {topBalances.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">No store owes you money.</li>}
            {topBalances.map(({ shop, balance }) => {
              const over = balance > shop.creditLimit;
              return (
                <li key={shop.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link href={`/stores/${shop.id}`} className="min-w-0 hover:underline">
                    <p className="truncate text-sm font-medium text-slate-900">{shop.shopName}</p>
                    <p className="text-xs text-slate-500">
                      {shop.shopCode} · {shop.town || "—"}
                    </p>
                  </Link>
                  <span className={cn("text-sm font-semibold tabular-nums", over ? "text-red-600" : "text-slate-900")}>
                    {formatMoney(balance)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <div className="mt-8">
        <SectionLabel>Purchasing from Raigam & stock</SectionLabel>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Raigam deliveries due" value={pending.length} sub="Purchase orders not yet received" icon={<Truck />} href="/orders" tone="amber" />
        <StatCard label="Ready to post" value={toPost.length} sub="Received, not yet added to stock" icon={<PackagePlus />} href="/orders" tone="blue" />
        <StatCard label="Unmatched items" value={unmatched.length} sub="Received qty ≠ ordered qty" icon={<AlertTriangle />} href="/order-items" tone="red" />
        <StatCard
          label="Stock value"
          value={<span className="text-2xl">{formatMoney(stockValue)}</span>}
          sub={`${formatQty(stockUnits)} units on hand · wholesale`}
          icon={<Coins />}
          href="/stock"
          tone="green"
        />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <Card>
          <CardHeader
            title="Orders needing action"
            description="Receive deliveries and post them to stock."
            actions={
              <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                All orders <ArrowRight className="size-4" />
              </Link>
            }
          />
          <Table>
            <THead>
              <tr>
                <TH>Order ID</TH>
                <TH>Order Date</TH>
                <TH className="text-right">Items</TH>
                <TH className="text-right">Bill Amount</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Action</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {actionOrders.length === 0 && <EmptyRow colSpan={6}>All caught up — no orders waiting.</EmptyRow>}
              {actionOrders.map((o) => (
                <TR key={o.id}>
                  <TD className="font-semibold text-brand-700">
                    <Link href={`/orders/${o.id}`} className="hover:underline">
                      {o.orderId}
                    </Link>
                  </TD>
                  <TD className="tabular-nums">{formatDate(o.orderDate)}</TD>
                  <TD className="text-right tabular-nums">{formatQty(qtyFor(o.orderId))}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(o.totalBillAmount)}</TD>
                  <TD>
                    <OrderStatusBadge status={orderStatus(o)} />
                  </TD>
                  <TD className="text-right">
                    <Link href={`/orders/${o.id}`} className={buttonClass("secondary", "sm")}>
                      {orderStatus(o) === "Pending" ? "Receive" : "Post to stock"}
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <LowStockCard rows={lowStock} needed={needed} />
      </div>

      {unmatched.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Unmatched items"
            description="Deliveries where the received quantity differs from what was ordered."
            actions={
              <Link href="/order-items" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                Order items <ArrowRight className="size-4" />
              </Link>
            }
          />
          <Table>
            <THead>
              <tr>
                <TH>Order ID</TH>
                <TH>Item</TH>
                <TH className="text-right">Ordered</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">Difference</TH>
                <TH>Remarks</TH>
              </tr>
            </THead>
            <TBody>
              {unmatched.map((l) => {
                const order = orderMap.get(l.orderId);
                const diff = l.receivedQty - l.orderedQty;
                return (
                  <TR key={l.id}>
                    <TD className="font-semibold text-brand-700">
                      {order ? (
                        <Link href={`/orders/${order.id}`} className="hover:underline">
                          {l.orderId}
                        </Link>
                      ) : (
                        l.orderId
                      )}
                    </TD>
                    <TD>
                      <span className="font-medium text-slate-900">{itemMap.get(l.itemCode)?.description ?? l.itemCode}</span>
                      <span className="ml-2 font-mono text-xs text-slate-500">{l.itemCode}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{formatQty(l.orderedQty)}</TD>
                    <TD className="text-right tabular-nums">{formatQty(l.receivedQty)}</TD>
                    <TD className={cn("text-right font-medium tabular-nums", diff < 0 ? "text-red-600" : "text-amber-600")}>
                      {diff > 0 ? `+${diff}` : diff}
                    </TD>
                    <TD className="text-slate-600">{l.remarks || "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
