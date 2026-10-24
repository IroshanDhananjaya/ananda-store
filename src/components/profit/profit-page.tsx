"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/form";
import { Card, CardHeader, PageHeader, SummaryTile, TableFooter } from "@/components/ui/layout";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  expensesByCategory,
  linesWithoutCost,
  marginPct,
  monthlyProfit,
  profitByItem,
  profitByRoute,
  profitFor,
  profitYears,
  type Period,
} from "@/lib/profit";
import { useAppStore, useItemMap, useRouteMap } from "@/lib/store";
import { cn, formatMoney, formatQty, todayISO } from "@/lib/utils";
import { NetProfitChart } from "./net-profit-chart";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const money = (v: number) => (v < 0 ? <span className="text-red-600">− {formatMoney(-v)}</span> : formatMoney(v));
const pct = (v: number) => `${v.toFixed(1)}%`;

export function ProfitPage() {
  const sales = useAppStore((s) => s.sales);
  const expenses = useAppStore((s) => s.expenses);
  const shops = useAppStore((s) => s.shops);
  const itemMap = useItemMap();
  const routeMap = useRouteMap();

  const today = todayISO();
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  const years = useMemo(() => profitYears(sales, expenses), [sales, expenses]);
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState<number | null>(null);
  const period: Period = { year, month };

  const figures = profitFor(sales, expenses, period);
  const monthly = useMemo(() => monthlyProfit(sales, expenses, year), [sales, expenses, year]);
  const yearTotal = profitFor(sales, expenses, { year, month: null });
  const byItem = profitByItem(sales, period);
  const byRoute = profitByRoute(sales, shops, period);
  const byCategory = expensesByCategory(expenses, period);
  const noCost = linesWithoutCost(sales, period);
  const periodLabel = month ? `${MONTHS[month - 1]} ${year}` : String(year);
  const isFuture = (m: number) => year > thisYear || (year === thisYear && m > thisMonth);

  return (
    <>
      <PageHeader
        title="Profit"
        description="Delivered bills − cost of the items sold = gross profit. Gross profit − expenses = net profit."
        actions={
          <div className="flex gap-2">
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" aria-label="Year">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Select
              value={month ?? ""}
              onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)}
              className="w-40"
              aria-label="Month"
            >
              <option value="">Whole year</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {noCost.length > 0 && (
        <p className="mb-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {noCost.length} bill line{noCost.length > 1 ? "s" : ""} in {periodLabel} {noCost.length > 1 ? "have" : "has"} items with no cost price, so
            profit shows higher than it is.{" "}
            <Link href="/items" className="font-medium underline">
              Set cost prices in Items
            </Link>
          </span>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryTile label={`Sales · ${periodLabel}`} value={formatMoney(figures.sales)} sub={`${figures.bills} bills delivered · ${formatQty(figures.units)} units`} />
        <SummaryTile label="Cost of items" value={formatMoney(figures.cost)} sub="What those items cost from Raigam" />
        <SummaryTile label="Gross profit" value={formatMoney(figures.gross)} sub={`${pct(marginPct(figures))} margin`} tone={figures.gross < 0 ? "danger" : "default"} />
        <SummaryTile label="Expenses" value={formatMoney(figures.expenses)} sub={<Link href="/expenses" className="hover:underline">View expenses</Link>} />
        <SummaryTile
          label="Net profit"
          value={figures.net < 0 ? `− ${formatMoney(-figures.net)}` : formatMoney(figures.net)}
          sub={figures.net < 0 ? "Loss for this period" : figures.sales > 0 ? `${pct((figures.net / figures.sales) * 100)} of sales` : "—"}
          tone={figures.net < 0 ? "danger" : figures.net > 0 ? "good" : "default"}
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title={`Net profit by month · ${year}`}
          description="Click a month to see it in detail. Click it again for the whole year."
          actions={
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[#2a78d6]" aria-hidden /> Profit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[#e34948]" aria-hidden /> Loss
              </span>
            </div>
          }
        />
        <div className="px-3 pt-4 pb-2 sm:px-5">
          <NetProfitChart data={monthly} year={year} selected={month} onSelect={setMonth} />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title={`Month by month · ${year}`} />
        <Table>
          <THead>
            <tr>
              <TH>Month</TH>
              <TH className="text-right">Bills</TH>
              <TH className="text-right">Sales</TH>
              <TH className="text-right">Cost of items</TH>
              <TH className="text-right">Gross profit</TH>
              <TH className="text-right">Margin</TH>
              <TH className="text-right">Expenses</TH>
              <TH className="text-right">Net profit</TH>
            </tr>
          </THead>
          <TBody>
            {monthly.map((f, i) => {
              const empty = f.bills === 0 && f.expenses === 0;
              return (
                <TR
                  key={i}
                  onClick={() => setMonth(month === i + 1 ? null : i + 1)}
                  className={cn("cursor-pointer", month === i + 1 && "bg-brand-50", empty && isFuture(i + 1) && "text-slate-400")}
                >
                  <TD className={cn("font-medium", month === i + 1 ? "text-brand-800" : "text-slate-900")}>{MONTHS[i]}</TD>
                  <TD className="text-right tabular-nums">{empty ? "—" : f.bills}</TD>
                  <TD className="text-right tabular-nums">{empty ? "—" : formatMoney(f.sales)}</TD>
                  <TD className="text-right tabular-nums">{empty ? "—" : formatMoney(f.cost)}</TD>
                  <TD className="text-right tabular-nums">{empty ? "—" : money(f.gross)}</TD>
                  <TD className="text-right tabular-nums">{f.sales > 0 ? pct(marginPct(f)) : "—"}</TD>
                  <TD className="text-right tabular-nums">{empty ? "—" : formatMoney(f.expenses)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{empty ? "—" : money(f.net)}</TD>
                </TR>
              );
            })}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
              <TD className="text-slate-900">Year {year}</TD>
              <TD className="text-right tabular-nums">{yearTotal.bills}</TD>
              <TD className="text-right tabular-nums">{formatMoney(yearTotal.sales)}</TD>
              <TD className="text-right tabular-nums">{formatMoney(yearTotal.cost)}</TD>
              <TD className="text-right tabular-nums">{money(yearTotal.gross)}</TD>
              <TD className="text-right tabular-nums">{yearTotal.sales > 0 ? pct(marginPct(yearTotal)) : "—"}</TD>
              <TD className="text-right tabular-nums">{formatMoney(yearTotal.expenses)}</TD>
              <TD className="text-right tabular-nums">{money(yearTotal.net)}</TD>
            </tr>
          </TBody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title={`Profit by item · ${periodLabel}`} description="Most profitable first." />
          <Table>
            <THead>
              <tr>
                <TH>Item</TH>
                <TH className="text-right">Qty sold</TH>
                <TH className="text-right">Sales</TH>
                <TH className="text-right">Gross profit</TH>
                <TH className="text-right">Margin</TH>
              </tr>
            </THead>
            <TBody>
              {byItem.length === 0 && <EmptyRow colSpan={5}>No delivered bills in {periodLabel}.</EmptyRow>}
              {byItem.map((r) => (
                <TR key={r.sapCode}>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? r.sapCode}</span>
                    <span className="font-mono text-xs text-slate-500">{r.sapCode}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{formatQty(r.qty)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(r.sales)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{money(r.profit)}</TD>
                  <TD className="text-right tabular-nums">{r.sales > 0 ? pct((r.profit / r.sales) * 100) : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader title={`Profit by route · ${periodLabel}`} />
            <Table>
              <THead>
                <tr>
                  <TH>Route</TH>
                  <TH className="text-right">Bills</TH>
                  <TH className="text-right">Gross profit</TH>
                </tr>
              </THead>
              <TBody>
                {byRoute.length === 0 && <EmptyRow colSpan={3}>No delivered bills.</EmptyRow>}
                {byRoute.map((r) => {
                  const route = routeMap.get(r.routeId);
                  return (
                    <TR key={r.routeId || "none"}>
                      <TD className="whitespace-normal">
                        <span className="block font-medium text-slate-900">{route ? route.routeName : "No route"}</span>
                        <span className="text-xs text-slate-500">
                          {route?.routeCode} · sales {formatMoney(r.sales)}
                        </span>
                      </TD>
                      <TD className="text-right tabular-nums">{r.bills}</TD>
                      <TD className="text-right font-semibold tabular-nums">{money(r.profit)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader title={`Expenses by category · ${periodLabel}`} actions={<Link href="/expenses" className="text-sm font-medium text-brand-700 hover:underline">Expenses</Link>} />
            <Table>
              <THead>
                <tr>
                  <TH>Category</TH>
                  <TH className="text-right">Entries</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {byCategory.length === 0 && <EmptyRow colSpan={3}>No expenses.</EmptyRow>}
                {byCategory.map((c) => (
                  <TR key={c.category}>
                    <TD className="font-medium text-slate-900">{c.category}</TD>
                    <TD className="text-right tabular-nums">{c.count}</TD>
                    <TD className="text-right font-semibold tabular-nums">{formatMoney(c.amount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {byCategory.length > 0 && <TableFooter>Total {formatMoney(figures.expenses)}</TableFooter>}
          </Card>
        </div>
      </div>
    </>
  );
}
