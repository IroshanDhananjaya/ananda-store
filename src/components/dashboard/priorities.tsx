"use client";

import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, HandCoins, Info, PackageCheck, PackageSearch, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/layout";
import { saleTotal } from "@/lib/ledger";
import { useAppStore, useItemMap, useSaleDues, useShopBalances, useShopMap } from "@/lib/store";
import { addDays, cn, daysSince, daysUntil, formatDate, formatMoney, formatQty, orderStatus, todayISO } from "@/lib/utils";

// What needs attention now, most urgent first. Every level has an icon + a word,
// so it never relies on colour alone (status colours: critical / serious / warning / info).

type Level = "urgent" | "high" | "soon" | "todo";
type Area = "Stock" | "Collect" | "Lorry" | "Raigam";

type Priority = {
  key: string;
  level: Level;
  area: Area;
  title: string;
  detail: string;
  href: string;
  action: string;
};

// Urgency in plain words: when to do it
const LEVELS: Record<Level, { label: string; icon: LucideIcon; color: string; tint: string; rank: number }> = {
  urgent: { label: "Now", icon: AlertOctagon, color: "#d03b3b", tint: "bg-red-50", rank: 0 },
  high: { label: "Today", icon: AlertTriangle, color: "#ec835a", tint: "bg-orange-50", rank: 1 },
  soon: { label: "This week", icon: Clock, color: "#b7800b", tint: "bg-amber-50", rank: 2 },
  todo: { label: "To do", icon: Info, color: "#2a78d6", tint: "bg-sky-50", rank: 3 },
};
const AREA_RANK: Record<Area, number> = { Stock: 0, Collect: 1, Lorry: 2, Raigam: 3 };

// Jobs are grouped under these headings
const AREAS: Record<Area, { title: string; hint: string; icon: LucideIcon; count: (n: number) => string }> = {
  Stock: { title: "Order from Raigam", hint: "Items that are selling and will run out", icon: PackageSearch, count: (n) => `${n} to order` },
  Collect: { title: "Collect money", hint: "Bills due or overdue, and stores over their credit limit", icon: HandCoins, count: (n) => `${n} to collect` },
  Lorry: { title: "Lorry", hint: "Bills waiting to load, or loaded but not delivered", icon: Truck, count: (n) => `${n} lorry job${n > 1 ? "s" : ""}` },
  Raigam: { title: "Loads from Raigam", hint: "Deliveries to add to stock or still to arrive", icon: PackageCheck, count: (n) => `${n} Raigam job${n > 1 ? "s" : ""}` },
};

/** Selling speed is the average over this many days */
const SALES_WINDOW_DAYS = 30;
/** Stock lasting fewer days than this is "High", then "Soon" */
const HIGH_DAYS = 3;
const SOON_DAYS = 7;

function usePriorities(): Priority[] {
  const stock = useAppStore((s) => s.stock);
  const sales = useAppStore((s) => s.sales);
  const shops = useAppStore((s) => s.shops);
  const orders = useAppStore((s) => s.orders);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const balances = useShopBalances();
  const dues = useSaleDues();

  return useMemo(() => {
    const list: Priority[] = [];
    const name = (sap: string) => itemMap.get(sap)?.description ?? sap;

    // ---- Stock: shortages for bills waiting to load, then out / critical / low
    const demand = new Map<string, { qty: number; bills: number }>();
    for (const s of sales.filter((x) => x.status === "Ordered")) {
      for (const l of s.lines) {
        const key = `${l.sapCode}|${l.locationNumber}`;
        const d = demand.get(key) ?? { qty: 0, bills: 0 };
        demand.set(key, { qty: d.qty + l.qty, bills: d.bills + 1 });
      }
    }
    const flagged = new Set<string>();
    for (const [key, d] of demand) {
      const [sap, loc] = key.split("|");
      const have = stock.find((r) => r.sapCode === sap && r.locationNumber === loc)?.availableQty ?? 0;
      if (d.qty > have) {
        flagged.add(key);
        list.push({
          key: `short-${key}`,
          level: "urgent",
          area: "Stock",
          title: `Not enough ${name(sap)} for bills waiting to load`,
          detail: `Need ${formatQty(d.qty)} for ${d.bills} bill${d.bills > 1 ? "s" : ""}, only ${formatQty(have)} at ${loc}`,
          href: "/orders/new",
          action: "Order from Raigam",
        });
      }
    }
    // Running low means a few days of selling left, judged by what went out on bills
    // (stock leaves at loading) in the last 30 days. Slow items, and free promo or
    // stationery stock (no selling price), don't raise alarms.
    const since = addDays(todayISO(), -SALES_WINDOW_DAYS);
    const soldPerDay = new Map<string, number>();
    for (const s of sales) {
      if (s.status === "Ordered" || !s.loadedDate || s.loadedDate < since) continue;
      for (const l of s.lines) soldPerDay.set(l.sapCode, (soldPerDay.get(l.sapCode) ?? 0) + l.qty / SALES_WINDOW_DAYS);
    }
    const onHand = new Map<string, number>();
    for (const r of stock) onHand.set(r.sapCode, (onHand.get(r.sapCode) ?? 0) + r.availableQty);
    const shortItems = new Set([...flagged].map((key) => key.split("|")[0]));
    for (const [sap, perDay] of soldPerDay) {
      if (shortItems.has(sap) || !((itemMap.get(sap)?.wholesalePrice ?? 0) > 0)) continue;
      const have = onHand.get(sap) ?? 0;
      const daysLeft = have / perDay;
      if (daysLeft >= SOON_DAYS) continue;
      const perWeek = Math.round(perDay * 7);
      const days = Math.floor(daysLeft);
      list.push({
        key: `stock-${sap}`,
        level: have === 0 ? "urgent" : daysLeft < HIGH_DAYS ? "high" : "soon",
        area: "Stock",
        title:
          have === 0
            ? `${name(sap)} is out of stock`
            : `${name(sap)}: ${formatQty(have)} left, ${days < 1 ? "less than a day" : `about ${days} day${days > 1 ? "s" : ""}`}`,
        detail: `${sap} · sells ${perWeek < 1 ? "less than 1" : `about ${formatQty(perWeek)}`} a week`,
        href: "/orders/new",
        action: "Order from Raigam",
      });
    }

    // ---- Collections: overdue bills, bills due in the next 3 days, stores over their limit
    for (const s of sales) {
      const d = dues.get(s.id);
      if (!d || d.due <= 0) continue;
      const shop = shopMap.get(s.shopId);
      const contact = shop?.phone ? ` · ${shop.phone}` : "";
      if (d.overdueDays > 0) {
        list.push({
          key: `overdue-${s.id}`,
          level: d.overdueDays > 7 ? "urgent" : "high",
          area: "Collect",
          title: `${s.saleNo} · ${shop?.shopName ?? "Store"} is ${d.overdueDays} day${d.overdueDays > 1 ? "s" : ""} overdue`,
          detail: `${formatMoney(d.due)} to collect (end date ${formatDate(s.dueDate)})${contact}`,
          href: `/sales/${s.id}`,
          action: "Collect",
        });
      } else if (s.dueDate && daysUntil(s.dueDate) <= 3) {
        const left = daysUntil(s.dueDate);
        list.push({
          key: `due-${s.id}`,
          level: "soon",
          area: "Collect",
          title: `Collect ${s.saleNo} from ${shop?.shopName ?? "store"} ${left === 0 ? "today" : `in ${left} day${left > 1 ? "s" : ""}`}`,
          detail: `${formatMoney(d.due)} · end date ${formatDate(s.dueDate)}${contact}`,
          href: `/sales/${s.id}`,
          action: "Collect",
        });
      }
    }
    for (const shop of shops) {
      const b = balances.get(shop.id);
      if (!b || b.balance <= shop.creditLimit || !shop.active) continue;
      list.push({
        key: `limit-${shop.id}`,
        level: "high",
        area: "Collect",
        title: `${shop.shopName} is over its credit limit`,
        detail: `Owes ${formatMoney(b.balance)}, limit ${formatMoney(shop.creditLimit)}. Collect before the next bill.`,
        href: `/stores/${shop.id}`,
        action: "View store",
      });
    }

    // ---- Lorry: bills waiting to load, bills on the lorry but not delivered
    const toLoad = sales.filter((s) => s.status === "Ordered");
    if (toLoad.length) {
      const oldest = toLoad.reduce((a, b) => (a.date <= b.date ? a : b));
      const waited = daysSince(oldest.date);
      list.push({
        key: "to-load",
        level: waited >= 2 ? "high" : "todo",
        area: "Lorry",
        title: `${toLoad.length} bill${toLoad.length > 1 ? "s" : ""} waiting to load`,
        detail: `${formatMoney(toLoad.reduce((sum, s) => sum + saleTotal(s), 0))} · oldest from ${formatDate(oldest.date)}${waited >= 2 ? ` (${waited} days)` : ""}`,
        href: "/invoices?load=1",
        action: "Load lorry",
      });
    }
    for (const s of sales.filter((x) => x.status === "Loaded")) {
      const days = daysSince(s.loadedDate);
      list.push({
        key: `lorry-${s.id}`,
        level: days >= 1 ? "soon" : "todo",
        area: "Lorry",
        title: `${s.saleNo} for ${shopMap.get(s.shopId)?.shopName ?? "store"} is on the lorry`,
        detail: `Loaded ${formatDate(s.loadedDate)}${s.vehicleNumber ? ` on ${s.vehicleNumber}` : ""} · not delivered yet`,
        href: `/sales/${s.id}`,
        action: "Deliver",
      });
    }

    // ---- Raigam: received orders not in stock yet, deliveries still to come
    for (const o of orders.filter((x) => orderStatus(x) === "Received")) {
      list.push({
        key: `post-${o.id}`,
        level: "high",
        area: "Raigam",
        title: `${o.orderId} received but not added to stock`,
        detail: `Received ${formatDate(o.receivedDate)} · post it so the items can be sold`,
        href: `/orders/${o.id}`,
        action: "Post to stock",
      });
    }
    const pendingPOs = orders.filter((x) => orderStatus(x) === "Pending");
    if (pendingPOs.length) {
      list.push({
        key: "po-pending",
        level: "todo",
        area: "Raigam",
        title: `${pendingPOs.length} purchase order${pendingPOs.length > 1 ? "s" : ""} waiting for delivery from Raigam`,
        detail: pendingPOs.map((o) => o.orderId).join(", "),
        href: "/orders",
        action: "View",
      });
    }

    return list.sort((a, b) => LEVELS[a.level].rank - LEVELS[b.level].rank || AREA_RANK[a.area] - AREA_RANK[b.area]);
  }, [stock, sales, shops, orders, itemMap, shopMap, balances, dues]);
}

/** Jobs shown per group before "Show more" */
const SHOW = 3;

function AreaGroup({ area, jobs }: { area: Area; jobs: Priority[] }) {
  const [all, setAll] = useState(false);
  const A = AREAS[area];
  const shown = all ? jobs : jobs.slice(0, SHOW);
  return (
    <section>
      <div className="flex items-center gap-3 bg-slate-50/80 px-5 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-brand-700 shadow-sm ring-1 ring-slate-200">
          <A.icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {A.title} <span className="font-normal text-slate-500">· {jobs.length}</span>
          </h3>
          <p className="text-xs text-slate-500">{A.hint}</p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {shown.map((p) => {
          const L = LEVELS[p.level];
          return (
            <li key={p.key} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
              <span
                className={cn("inline-flex w-28 shrink-0 items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-semibold text-slate-800 sm:self-center", L.tint)}
                title="When to do it"
              >
                <L.icon className="size-4" style={{ color: L.color }} aria-hidden />
                {L.label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{p.title}</p>
                <p className="text-xs text-slate-500">{p.detail}</p>
              </div>
              <Link href={p.href} className={buttonClass(p.level === "urgent" ? "primary" : "secondary", "sm", "shrink-0 self-start sm:self-center")}>
                {p.action}
              </Link>
            </li>
          );
        })}
      </ul>
      {jobs.length > SHOW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="w-full border-t border-slate-100 px-5 py-2 text-left text-xs font-medium text-brand-700 hover:bg-slate-50"
        >
          {all ? "Show fewer" : `Show ${jobs.length - SHOW} more`}
        </button>
      )}
    </section>
  );
}

/** Dashboard to-do list: jobs the app finds in stock, bills and money, grouped by kind, most urgent first */
export function Priorities() {
  const items = usePriorities();
  // Groups in order of their most urgent job (items are already sorted by urgency)
  const groups = [...Map.groupBy(items, (p) => p.area)];

  return (
    <Card className="mb-8 border-slate-300">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Jobs to do</h2>
          <p className="text-xs text-slate-500">The app checks your stock, bills and money, and lists what needs you. Most urgent first.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.map(([area, jobs]) => (
            <span key={area} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {AREAS[area].count(jobs.length)}
            </span>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex gap-3 px-5 py-6">
          <CheckCircle2 className="size-5 shrink-0 text-[#0ca30c]" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-slate-900">Nothing to do right now.</p>
            <p className="mt-1 text-slate-500">
              Jobs appear here by themselves when an item that is selling is about to run out, a store&apos;s money is due, bills are waiting
              to load or deliver, or a Raigam load needs adding to stock.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {groups.map(([area, jobs]) => (
            <AreaGroup key={area} area={area} jobs={jobs} />
          ))}
        </div>
      )}
    </Card>
  );
}
