import { OPENING_BILL, type BillStatus, type Payment, type PaymentAllocation, type Sale, type Shop } from "./types";
import { daysUntil, round2 } from "./utils";

// Cash balance = money we still need to get from a store:
//   opening balance + delivered order totals − payments
//
// Orders still waiting for delivery are not owed yet. Every collection (at
// delivery or later) is a Payment linked to bills (delivered orders, or the
// opening balance) through allocations, so each order has its own cash balance
// and end date for collecting it.

export const isDelivered = (sale: Pick<Sale, "status">) => sale.status === "Delivered";
/** Loaded or delivered: the bill's items have left the warehouse */
export const stockIsOut = (sale: Pick<Sale, "status">) => sale.status === "Loaded" || sale.status === "Delivered";

/** Days past the end date (0 if not overdue or nothing to collect) */
export function overdueDays(dueDate: string, due: number) {
  if (!dueDate || due <= EPS_DUE) return 0;
  return Math.max(0, -daysUntil(dueDate));
}
const EPS_DUE = 0.004;

type PricedLine = { qty: number; unitPrice: number; discountPct?: number; cancelQty?: number };
type PricedLines = { lines: PricedLine[]; returns?: { qty: number; unitPrice: number }[] };

const EPS = 0.004;

// A bill, as on Raigam's invoice:
//   item value   = (qty − cancelled) × unit price, less the item discount %   (free qty is never charged)
//   items total  = sum of item values
//   returns      = qty × unit price of goods the store gave back (good + market)
//   gross value  = items total − returns          (saleSubtotal)
//   bill discount = gross value × bill discount %  (stored on the bill in Rs.)
//   invoice value = gross value − bill discount     (saleTotal)

export function lineValue(l: PricedLine) {
  return round2((l.qty - (l.cancelQty ?? 0)) * l.unitPrice * (1 - (l.discountPct ?? 0) / 100));
}

export function itemsTotal(sale: PricedLines) {
  return round2(sale.lines.reduce((sum, l) => sum + lineValue(l), 0));
}

export function returnsTotal(sale: Pick<PricedLines, "returns">) {
  return round2((sale.returns ?? []).reduce((sum, r) => sum + round2(r.qty * r.unitPrice), 0));
}

/** Gross value: items less returns, before the bill discount */
export function saleSubtotal(sale: PricedLines) {
  return round2(itemsTotal(sale) - returnsTotal(sale));
}

/** Bill discount in Rs. for a gross value */
export function billDiscount(subtotal: number, percent: number) {
  return round2((subtotal * percent) / 100);
}

/** Invoice value: what the store owes for the bill */
export function saleTotal(sale: PricedLines & { discount: number }) {
  return round2(saleSubtotal(sale) - sale.discount);
}


export function linkedAmount(payment: Pick<Payment, "allocations">) {
  return round2(payment.allocations.reduce((sum, a) => sum + a.amount, 0));
}

/** Part of a payment not linked to any bill (kept as an advance) */
export function unlinkedAmount(payment: Pick<Payment, "amount" | "allocations">) {
  return round2(payment.amount - linkedAmount(payment));
}

export function billStatus(total: number, due: number): BillStatus {
  if (due <= EPS) return "Paid";
  return due < total - EPS ? "Part paid" : "Unpaid";
}

const byDateThenNo = (a: Sale, b: Sale) => a.date.localeCompare(b.date) || a.saleNo.localeCompare(b.saleNo);
const paymentOrder = (a: Payment, b: Payment) => a.date.localeCompare(b.date) || a.receiptNo.localeCompare(b.receiptNo);

// ---------- Per-sale cash balance ----------

export type SaleDue = {
  total: number;
  /** Paid through payments linked to this bill (before delivery too: paid in advance) */
  paid: number;
  /** Cash balance still to collect for this order (0 until delivered) */
  due: number;
  delivered: boolean;
  /** Ordered / Loaded until delivered, then Paid / Part paid / Unpaid; or Cancelled */
  status: BillStatus | "Ordered" | "Loaded" | "Cancelled";
  dueDate: string;
  /** Days past the end date for collecting */
  overdueDays: number;
  payments: { paymentId: string; receiptNo: string; date: string; amount: number }[];
};

export function computeSaleDues(sales: Sale[], payments: Payment[]) {
  const linked = new Map<string, SaleDue["payments"]>();
  for (const p of payments) {
    for (const a of p.allocations) {
      if (a.saleId === OPENING_BILL) continue;
      const list = linked.get(a.saleId) ?? [];
      list.push({ paymentId: p.id, receiptNo: p.receiptNo, date: p.date, amount: a.amount });
      linked.set(a.saleId, list);
    }
  }
  const map = new Map<string, SaleDue>();
  for (const s of sales) {
    const total = saleTotal(s);
    const list = (linked.get(s.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const paid = round2(list.reduce((sum, x) => sum + x.amount, 0));
    if (!isDelivered(s)) {
      // Not owed until delivered; anything paid so far was paid in advance
      map.set(s.id, { total, paid, due: 0, delivered: false, status: s.status === "Delivered" ? "Ordered" : s.status, dueDate: s.dueDate, overdueDays: 0, payments: list });
      continue;
    }
    const due = round2(total - paid);
    map.set(s.id, {
      total,
      paid,
      due,
      delivered: true,
      status: billStatus(total, due),
      dueDate: s.dueDate,
      overdueDays: overdueDays(s.dueDate, due),
      payments: list,
    });
  }
  return map;
}

// ---------- Open bills for one store ----------

export type OpenBill = {
  /** Sale id, or OPENING_BILL */
  id: string;
  ref: string;
  /** Delivered date (empty for the opening balance) */
  date: string;
  /** End date for collecting (empty for the opening balance) */
  dueDate: string;
  total: number;
  paid: number;
  due: number;
  overdueDays: number;
};

/** Bills with money still to collect: opening balance first, then delivered orders oldest first */
export function openBills(shop: Shop, sales: Sale[], payments: Payment[]): OpenBill[] {
  const allocated = new Map<string, number>();
  for (const p of payments) {
    if (p.shopId !== shop.id) continue;
    for (const a of p.allocations) allocated.set(a.saleId, (allocated.get(a.saleId) ?? 0) + a.amount);
  }
  const bills: OpenBill[] = [];
  const openingPaid = round2(allocated.get(OPENING_BILL) ?? 0);
  const openingDue = round2(shop.openingBalance - openingPaid);
  if (openingDue > EPS) {
    bills.push({ id: OPENING_BILL, ref: "Opening balance", date: "", dueDate: "", total: shop.openingBalance, paid: openingPaid, due: openingDue, overdueDays: 0 });
  }
  for (const s of sales.filter((x) => x.shopId === shop.id && isDelivered(x)).sort(byDateThenNo)) {
    const total = saleTotal(s);
    const paid = round2(allocated.get(s.id) ?? 0);
    const due = round2(total - paid);
    if (due > EPS) {
      bills.push({ id: s.id, ref: s.saleNo, date: s.deliveredDate, dueDate: s.dueDate, total, paid, due, overdueDays: overdueDays(s.dueDate, due) });
    }
  }
  return bills;
}

/** Bills a payment can be linked to: delivered ones with money to collect, and bills not
 *  delivered yet (paid in advance, up to their total) */
export function payableBills(shop: Shop, sales: Sale[], payments: Payment[]): { id: string; ref: string; left: number }[] {
  const allocated = new Map<string, number>();
  for (const p of payments) {
    if (p.shopId !== shop.id) continue;
    for (const a of p.allocations) allocated.set(a.saleId, (allocated.get(a.saleId) ?? 0) + a.amount);
  }
  const waiting = sales
    .filter((s) => s.shopId === shop.id && (s.status === "Ordered" || s.status === "Loaded"))
    .map((s) => ({ id: s.id, ref: s.saleNo, left: round2(saleTotal(s) - (allocated.get(s.id) ?? 0)) }))
    .filter((b) => b.left > EPS);
  return [...openBills(shop, sales, payments).map((b) => ({ id: b.id, ref: b.ref, left: b.due })), ...waiting];
}

/** Spread an amount over bills, oldest first */
export function autoAllocate(amount: number, bills: Pick<OpenBill, "id" | "due">[]): PaymentAllocation[] {
  let left = round2(amount);
  const out: PaymentAllocation[] = [];
  for (const b of bills) {
    if (left <= EPS) break;
    const pay = round2(Math.min(left, b.due));
    if (pay > EPS) {
      out.push({ saleId: b.id, amount: pay });
      left = round2(left - pay);
    }
  }
  return out;
}

function mergeAllocations(list: PaymentAllocation[]): PaymentAllocation[] {
  const map = new Map<string, number>();
  for (const a of list) map.set(a.saleId, round2((map.get(a.saleId) ?? 0) + a.amount));
  return [...map.entries()].filter(([, amount]) => amount > EPS).map(([saleId, amount]) => ({ saleId, amount }));
}

/** Link any unlinked payment money of one store to its oldest open bills */
export function linkUnlinkedPayments(shop: Shop, sales: Sale[], payments: Payment[]): Payment[] {
  let result = payments;
  for (const p of payments.filter((x) => x.shopId === shop.id).sort(paymentOrder)) {
    const current = result.find((x) => x.id === p.id)!;
    const free = unlinkedAmount(current);
    if (free <= EPS) continue;
    const extra = autoAllocate(free, openBills(shop, sales, result));
    if (extra.length === 0) continue;
    result = result.map((x) => (x.id === p.id ? { ...x, allocations: mergeAllocations([...x.allocations, ...extra]) } : x));
  }
  return result;
}

/** Link every store's unlinked payments (used for sample data and upgrades) */
export function linkAllPayments(shops: Shop[], sales: Sale[], payments: Payment[]): Payment[] {
  return shops.reduce((acc, shop) => linkUnlinkedPayments(shop, sales, acc), payments);
}

/**
 * Keep payment links valid after a sale or store changes: drop links to sales that
 * no longer exist or belong to another store, and trim links that now pay more than
 * the bill (later payments are trimmed first). Trimmed money becomes unlinked credit.
 */
export function normalizeAllocations(shops: Shop[], sales: Sale[], payments: Payment[]): Payment[] {
  const saleMap = new Map(sales.map((s) => [s.id, s]));
  const shopMap = new Map(shops.map((s) => [s.id, s]));
  const used = new Map<string, number>();
  const fixed = new Map<string, PaymentAllocation[]>();

  for (const p of [...payments].sort(paymentOrder)) {
    const keep: PaymentAllocation[] = [];
    for (const a of p.allocations) {
      let cap: number;
      if (a.saleId === OPENING_BILL) {
        cap = Math.max(0, shopMap.get(p.shopId)?.openingBalance ?? 0);
      } else {
        const sale = saleMap.get(a.saleId);
        // Any bill of the store can be paid against (before delivery too), except a cancelled one
        if (!sale || sale.shopId !== p.shopId || sale.status === "Cancelled") continue;
        cap = Math.max(0, saleTotal(sale));
      }
      const key = `${p.shopId}|${a.saleId}`;
      const amount = round2(Math.min(a.amount, cap - (used.get(key) ?? 0)));
      if (amount > EPS) {
        keep.push({ saleId: a.saleId, amount });
        used.set(key, round2((used.get(key) ?? 0) + amount));
      }
    }
    fixed.set(p.id, keep);
  }

  return payments.map((p) => {
    const next = fixed.get(p.id)!;
    const same = next.length === p.allocations.length && next.every((a, i) => a.saleId === p.allocations[i].saleId && a.amount === p.allocations[i].amount);
    return same ? p : { ...p, allocations: next };
  });
}

// ---------- Store totals ----------

export type ShopBalance = {
  opening: number;
  sales: number;
  /** All payments (collections) */
  paid: number;
  /** Cash balance: what we still need to get from the store */
  balance: number;
  /** Payment money not linked to any bill */
  unlinked: number;
  /** Number of bills (incl. opening balance) with money to collect */
  openBills: number;
  /** Cash balance of bills past their end date */
  overdue: number;
  overdueBills: number;
  /** Orders created by the rep but not delivered yet */
  toDeliver: number;
  toDeliverValue: number;
  lastSaleDate: string;
  lastPaymentDate: string;
};

export function computeBalances(shops: Shop[], sales: Sale[], payments: Payment[]) {
  const map = new Map<string, ShopBalance>();
  for (const s of shops) {
    map.set(s.id, {
      opening: s.openingBalance,
      sales: 0,
      paid: 0,
      balance: s.openingBalance,
      unlinked: 0,
      openBills: 0,
      overdue: 0,
      overdueBills: 0,
      toDeliver: 0,
      toDeliverValue: 0,
      lastSaleDate: "",
      lastPaymentDate: "",
    });
  }
  for (const sale of sales) {
    const b = map.get(sale.shopId);
    if (!b) continue;
    if (!isDelivered(sale)) {
      b.toDeliver += 1;
      b.toDeliverValue += saleTotal(sale);
      continue;
    }
    b.sales += saleTotal(sale);
    if (sale.deliveredDate > b.lastSaleDate) b.lastSaleDate = sale.deliveredDate;
  }
  for (const p of payments) {
    const b = map.get(p.shopId);
    if (!b) continue;
    b.paid += p.amount;
    b.unlinked += unlinkedAmount(p);
    if (p.date > b.lastPaymentDate) b.lastPaymentDate = p.date;
  }
  for (const s of shops) {
    const b = map.get(s.id)!;
    b.sales = round2(b.sales);
    b.paid = round2(b.paid);
    b.unlinked = round2(b.unlinked);
    b.toDeliverValue = round2(b.toDeliverValue);
    b.balance = round2(b.opening + b.sales - b.paid);
    const bills = openBills(s, sales, payments);
    b.openBills = bills.length;
    const late = bills.filter((x) => x.overdueDays > 0);
    b.overdueBills = late.length;
    b.overdue = round2(late.reduce((sum, x) => sum + x.due, 0));
  }
  return map;
}

// ---------- Statement ----------

export type LedgerEntry = {
  key: string;
  date: string;
  kind: "Opening" | "Sale" | "Payment";
  ref: string;
  /** Sale id or payment id, for linking */
  refId?: string;
  details: string;
  debit: number;
  credit: number;
  balance: number;
};

/** Statement for one shop, oldest first, with running balance */
export function shopLedger(shop: Shop, sales: Sale[], payments: Payment[]): LedgerEntry[] {
  const saleNo = new Map(sales.map((s) => [s.id, s.saleNo]));
  const rows: Omit<LedgerEntry, "balance">[] = [];
  // A bill is owed from the day it is delivered
  for (const s of sales.filter((x) => x.shopId === shop.id && isDelivered(x))) {
    const qty = s.lines.reduce((n, l) => n + l.qty, 0);
    rows.push({
      key: s.id,
      date: s.deliveredDate,
      kind: "Sale",
      ref: s.saleNo,
      refId: s.id,
      details: `Delivered ${s.lines.length} item${s.lines.length === 1 ? "" : "s"}, ${qty} units`,
      debit: saleTotal(s),
      credit: 0,
    });
  }
  for (const p of payments.filter((x) => x.shopId === shop.id)) {
    const method = p.method === "Cheque" ? `Cheque ${p.chequeNumber}` : p.method;
    const forBills = p.allocations.map((a) => (a.saleId === OPENING_BILL ? "opening balance" : saleNo.get(a.saleId))).filter(Boolean);
    rows.push({
      key: p.id,
      date: p.date,
      kind: "Payment",
      ref: p.receiptNo,
      refId: p.id,
      details: method + (forBills.length ? ` · for ${forBills.join(", ")}` : " · not linked to a bill"),
      debit: 0,
      credit: p.amount,
    });
  }
  // Same day: sales before payments, then by reference number
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.ref.localeCompare(b.ref) : a.kind === "Sale" ? -1 : 1));

  let balance = shop.openingBalance;
  const ledger: LedgerEntry[] = [
    { key: "opening", date: "", kind: "Opening", ref: "—", details: "Opening balance", debit: 0, credit: 0, balance },
  ];
  for (const r of rows) {
    balance = round2(balance + r.debit - r.credit);
    ledger.push({ ...r, balance });
  }
  return ledger;
}
