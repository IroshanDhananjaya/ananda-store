import { chargedQty, isDelivered, lineValue, returnsTotal, saleTotal } from "./ledger";
import type { Expense, ExpenseCategory, Sale, Shop } from "./types";
import { round2, todayISO } from "./utils";

// Profit (accrual): a bill counts in the month it was DELIVERED.
//   sales        = invoice value + return items (the store's credit for good and market
//                  returns is claimed back from Raigam, so returns don't lower profit)
//   cost         = charged qty (less missing and cancelled) × cost price saved on each bill line.
//                  Free issue isn't a cost: Raigam pays it back.
//   gross profit = sales − cost
//   net profit   = gross profit − expenses
// Money collected (payments) does not change profit; it only changes cash balances.

export type Period = { year: number; month: number | null };

export function inPeriod(iso: string, p: Period) {
  if (!iso) return false;
  if (Number(iso.slice(0, 4)) !== p.year) return false;
  return p.month === null || Number(iso.slice(5, 7)) === p.month;
}

export function saleCost(sale: Pick<Sale, "lines">) {
  return round2(sale.lines.reduce((sum, l) => sum + chargedQty(l) * l.costPrice, 0));
}

/** What a delivered bill earns: the invoice value plus the return credit Raigam pays back */
export function saleRevenue(sale: Sale) {
  return round2(saleTotal(sale) + returnsTotal(sale));
}

export type ProfitFigures = {
  sales: number;
  cost: number;
  gross: number;
  expenses: number;
  net: number;
  bills: number;
  units: number;
};

const emptyFigures = (): ProfitFigures => ({ sales: 0, cost: 0, gross: 0, expenses: 0, net: 0, bills: 0, units: 0 });

function finish(f: ProfitFigures): ProfitFigures {
  const sales = round2(f.sales);
  const cost = round2(f.cost);
  const expenses = round2(f.expenses);
  const gross = round2(sales - cost);
  return { ...f, sales, cost, expenses, gross, net: round2(gross - expenses) };
}

export function marginPct(f: Pick<ProfitFigures, "sales" | "gross">) {
  return f.sales > 0 ? (f.gross / f.sales) * 100 : 0;
}

const deliveredIn = (sales: Sale[], p: Period) => sales.filter((s) => isDelivered(s) && inPeriod(s.deliveredDate, p));

export function profitFor(sales: Sale[], expenses: Expense[], p: Period): ProfitFigures {
  const f = emptyFigures();
  for (const s of deliveredIn(sales, p)) {
    f.sales += saleRevenue(s);
    f.cost += saleCost(s);
    f.bills += 1;
    f.units += s.lines.reduce((n, l) => n + chargedQty(l), 0);
  }
  for (const e of expenses) if (inPeriod(e.date, p)) f.expenses += e.amount;
  return finish(f);
}

/** Jan..Dec figures for one year */
export function monthlyProfit(sales: Sale[], expenses: Expense[], year: number): ProfitFigures[] {
  return Array.from({ length: 12 }, (_, i) => profitFor(sales, expenses, { year, month: i + 1 }));
}

/** Years that have deliveries or expenses, plus this year; newest first */
export function profitYears(sales: Sale[], expenses: Expense[]): number[] {
  const years = new Set<number>([Number(todayISO().slice(0, 4))]);
  for (const s of sales) if (isDelivered(s) && s.deliveredDate) years.add(Number(s.deliveredDate.slice(0, 4)));
  for (const e of expenses) years.add(Number(e.date.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

export type ItemProfit = { sapCode: string; qty: number; sales: number; cost: number; profit: number };

/** Per item, after item and bill discounts (returns don't count: Raigam pays them back) */
export function profitByItem(sales: Sale[], p: Period): ItemProfit[] {
  const map = new Map<string, ItemProfit>();
  for (const s of deliveredIn(sales, p)) {
    const keep = 1 - s.discountPercent / 100;
    for (const l of s.lines) {
      const row = map.get(l.sapCode) ?? { sapCode: l.sapCode, qty: 0, sales: 0, cost: 0, profit: 0 };
      row.qty += chargedQty(l);
      row.sales += lineValue(l) * keep;
      row.cost += chargedQty(l) * l.costPrice;
      map.set(l.sapCode, row);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, sales: round2(r.sales), cost: round2(r.cost), profit: round2(r.sales - r.cost) }))
    .sort((a, b) => b.profit - a.profit);
}

export type RouteProfit = { routeId: string; bills: number; sales: number; cost: number; profit: number };

export function profitByRoute(sales: Sale[], shops: Shop[], p: Period): RouteProfit[] {
  const routeOf = new Map(shops.map((s) => [s.id, s.routeId]));
  const map = new Map<string, RouteProfit>();
  for (const s of deliveredIn(sales, p)) {
    const routeId = routeOf.get(s.shopId) ?? "";
    const row = map.get(routeId) ?? { routeId, bills: 0, sales: 0, cost: 0, profit: 0 };
    row.bills += 1;
    row.sales += saleRevenue(s);
    row.cost += saleCost(s);
    map.set(routeId, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, sales: round2(r.sales), cost: round2(r.cost), profit: round2(r.sales - r.cost) }))
    .sort((a, b) => b.profit - a.profit);
}

export type CategoryTotal = { category: ExpenseCategory; amount: number; count: number };

export function expensesByCategory(expenses: Expense[], p: Period): CategoryTotal[] {
  const map = new Map<ExpenseCategory, CategoryTotal>();
  for (const e of expenses) {
    if (!inPeriod(e.date, p)) continue;
    const row = map.get(e.category) ?? { category: e.category, amount: 0, count: 0 };
    row.amount += e.amount;
    row.count += 1;
    map.set(e.category, row);
  }
  return [...map.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort((a, b) => b.amount - a.amount);
}

/** Delivered lines in the period whose item had no cost price (profit for them is overstated) */
export function linesWithoutCost(sales: Sale[], p: Period) {
  return deliveredIn(sales, p).flatMap((s) => s.lines.filter((l) => !(l.costPrice > 0)).map((l) => ({ sale: s, line: l })));
}
