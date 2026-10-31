"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader, SummaryTile } from "@/components/ui/layout";
import { billFreeIssue, claimBySale } from "@/lib/free-issues";
import { useAppStore, useItemMap, useShopBalances, useShopMap } from "@/lib/store";
import { addDays, formatDate, formatMoney, todayISO } from "@/lib/utils";

// Data checks: problems in the data to fix, each one linking to where it's fixed.

/** Days a bill can wait at each step before it's flagged */
const ORDERED_DAYS = 3;
const LOADED_DAYS = 2;
const CLAIM_DAYS = 30;
/** Rows shown per check before "Show all" */
const SHOWN = 8;

type Row = { key: string; href: string; label: string; detail: string };
type Check = { id: string; title: string; why: string; tone: "red" | "amber"; rows: Row[] };

export function ChecksPage() {
  const sales = useAppStore((s) => s.sales);
  const items = useAppStore((s) => s.items);
  const freeClaims = useAppStore((s) => s.freeClaims);
  const shops = useAppStore((s) => s.shops);
  const shopMap = useShopMap();
  const itemMap = useItemMap();
  const balances = useShopBalances();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const checks: Check[] = useMemo(() => {
    const today = todayISO();
    const live = sales.filter((s) => s.status !== "Cancelled");
    const shopName = (id: string) => shopMap.get(id)?.shopName ?? "Unknown store";
    const bill = (s: (typeof sales)[number], detail: string): Row => ({
      key: s.id,
      href: `/sales/${s.id}`,
      label: s.saleNo,
      detail: `${shopName(s.shopId)} · ${detail}`,
    });
    const oldestFirst = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

    const byInvoice = Map.groupBy(
      live.filter((s) => s.invoiceNo.trim()),
      (s) => s.invoiceNo.trim().toUpperCase(),
    );
    const claimed = claimBySale(freeClaims);

    return [
      {
        id: "no-invoice",
        title: "Delivered bills with no invoice no.",
        why: "Enter Raigam's invoice no. on the bill so it can be matched with their system.",
        tone: "amber",
        rows: live
          .filter((s) => s.status === "Delivered" && !s.invoiceNo.trim())
          .sort(oldestFirst)
          .map((s) => bill(s, `delivered ${formatDate(s.deliveredDate)}`)),
      },
      {
        id: "dup-invoice",
        title: "Same invoice no. on more than one bill",
        why: "One Raigam invoice should be on one bill. Fix the wrong invoice no., or cancel the extra bill.",
        tone: "red",
        rows: [...byInvoice.entries()]
          .filter(([, list]) => list.length > 1)
          .flatMap(([no, list]) =>
            list.map((s) =>
              bill(
                s,
                `invoice ${no} is also on ${list
                  .filter((o) => o.id !== s.id)
                  .map((o) => o.saleNo)
                  .join(", ")}`,
              ),
            ),
          ),
      },
      {
        id: "loaded-long",
        title: `Loaded ${LOADED_DAYS}+ days ago, not delivered`,
        why: "Deliver the bill, or mark it late so it goes back to wait for loading.",
        tone: "red",
        rows: live
          .filter((s) => s.status === "Loaded" && s.loadedDate && s.loadedDate <= addDays(today, -LOADED_DAYS))
          .sort((a, b) => a.loadedDate.localeCompare(b.loadedDate))
          .map((s) => bill(s, `loaded ${formatDate(s.loadedDate)}${s.vehicleNumber ? ` on ${s.vehicleNumber}` : ""}`)),
      },
      {
        id: "ordered-long",
        title: `Ordered ${ORDERED_DAYS}+ days ago, not loaded`,
        why: "Load the bill, or cancel it if the store no longer wants it.",
        tone: "amber",
        rows: live
          .filter((s) => s.status === "Ordered" && s.date <= addDays(today, -ORDERED_DAYS))
          .sort(oldestFirst)
          .map((s) => bill(s, `ordered ${formatDate(s.date)}${s.late ? " · late" : ""}`)),
      },
      {
        id: "unclaimed",
        title: `Free issue not claimed ${CLAIM_DAYS}+ days after delivery`,
        why: "Claim it from Raigam on the Free Issues page (New claim) so the money isn't missed.",
        tone: "red",
        rows: live
          .filter((s) => s.status === "Delivered" && s.deliveredDate <= addDays(today, -CLAIM_DAYS) && !claimed.has(s.id))
          .map((s) => ({ s, value: billFreeIssue(s).reduce((n, f) => n + f.value, 0) }))
          .filter((x) => x.value > 0)
          .sort((a, b) => a.s.deliveredDate.localeCompare(b.s.deliveredDate))
          .map((x) => bill(x.s, `delivered ${formatDate(x.s.deliveredDate)} · ${formatMoney(x.value)} free issue`)),
      },
      {
        id: "credit-limit",
        title: "Stores over their credit limit",
        why: "Collect money before giving more on credit, or raise the store's credit limit.",
        tone: "red",
        rows: shops
          .filter((s) => s.active && s.creditLimit > 0 && (balances.get(s.id)?.balance ?? 0) > s.creditLimit)
          .map((s) => ({ s, balance: balances.get(s.id)?.balance ?? 0 }))
          .sort((a, b) => b.balance - b.s.creditLimit - (a.balance - a.s.creditLimit))
          .map(({ s, balance }) => ({
            key: s.id,
            href: `/stores/${s.id}`,
            label: s.shopName,
            detail: `owes ${formatMoney(balance)} · limit ${formatMoney(s.creditLimit)} · over by ${formatMoney(balance - s.creditLimit)}`,
          })),
      },
      {
        id: "items",
        title: "Items missing details",
        why: "Without a cost price profit is wrong; without a stock location new loads have nowhere to go.",
        tone: "amber",
        rows: items
          .map((i) => ({
            i,
            missing: [!i.locationNumber && "stock location", !(i.costPrice > 0) && "cost price", !(i.wholesalePrice > 0) && "wholesale price"].filter(Boolean),
          }))
          .filter((x) => x.missing.length > 0)
          .map(({ i, missing }) => ({ key: i.id, href: "/items", label: i.sapCode, detail: `${itemMap.get(i.sapCode)?.description ?? ""} · no ${missing.join(", ")}` })),
      },
    ];
  }, [sales, items, freeClaims, shops, shopMap, itemMap, balances]);

  const problems = checks.reduce((n, c) => n + c.rows.length, 0);
  const failing = checks.filter((c) => c.rows.length > 0);

  return (
    <>
      <PageHeader title="Data Checks" description="Things in the data to fix or follow up. Each one links to where you fix it." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryTile label="To fix" value={problems} sub={`In ${failing.length} of ${checks.length} checks`} tone={problems ? "danger" : "good"} />
        <SummaryTile label="Urgent" value={failing.filter((c) => c.tone === "red").reduce((n, c) => n + c.rows.length, 0)} sub="Money or deliveries at risk" />
        <SummaryTile label="All clear" value={checks.length - failing.length} sub="Checks with nothing to fix" tone="good" />
      </div>

      <div className="flex flex-col gap-4">
        {[...failing, ...checks.filter((c) => c.rows.length === 0)].map((c) => {
          const all = expanded.has(c.id);
          const rows = all ? c.rows : c.rows.slice(0, SHOWN);
          return (
            <Card key={c.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {c.title}
                    {c.rows.length ? (
                      <Badge tone={c.tone}>{c.rows.length}</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <CircleCheck className="size-4" /> All clear
                      </span>
                    )}
                  </span>
                }
                description={c.rows.length ? c.why : undefined}
              />
              {c.rows.length > 0 && (
                <ul className="divide-y divide-slate-200">
                  {rows.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
                      <Link href={r.href} className="font-medium text-brand-700 hover:underline">
                        {r.label}
                      </Link>
                      <span className="text-slate-600">{r.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              {c.rows.length > SHOWN && (
                <div className="border-t border-slate-200 px-5 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (!next.delete(c.id)) next.add(c.id);
                        return next;
                      })
                    }
                  >
                    {all ? "Show fewer" : `Show all ${c.rows.length}`}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
