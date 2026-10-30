import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LineStatus, Order, OrderInvoice, OrderItem, OrderPayment, OrderStatus } from "./types";

/** Stock at or below this quantity is flagged as low */
export const LOW_STOCK_LEVEL = 10;
/** Stock at or below this quantity is critical (reorder now) */
export const CRITICAL_STOCK_LEVEL = 5;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function newId() {
  return crypto.randomUUID();
}

/** "2026-10-21" -> "21/10/2026" (same format as the sheets) */
export function formatDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function formatMoney(value: number) {
  return `Rs. ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact rupees for chart axes: 12,500 -> "12.5K", -3,000 -> "-3K" */
export function formatCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatQty(value: number) {
  return value.toLocaleString("en-US");
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Next code in a series, e.g. nextCode(["ST - 0009"], "ST", 4) -> "ST - 0010" */
export function nextCode(codes: string[], prefix: string, width: number) {
  const max = codes.reduce((acc, code) => {
    const n = Number(code.replace(/\D/g, ""));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${prefix} - ${String(max + 1).padStart(width, "0")}`;
}

/** "ORD - 0007" from the highest existing number */
export function nextOrderId(orders: Pick<Order, "orderId">[]) {
  return nextCode(orders.map((o) => o.orderId), "ORD", 4);
}

export const NOT_PAID: OrderPayment = { paymentMethod: "", paidDate: "", chequeNumber: "", chequeDepositDate: "", paymentReference: "" };

/** Just the payment fields of an order */
export const paymentOf = (o: OrderPayment): OrderPayment => ({
  paymentMethod: o.paymentMethod,
  paidDate: o.paidDate,
  chequeNumber: o.chequeNumber,
  chequeDepositDate: o.chequeDepositDate,
  paymentReference: o.paymentReference,
});

/** "LOC - 006" from the highest existing number */
export function nextLocationNumber(locations: { locationNumber: string }[]) {
  return nextCode(locations.map((l) => l.locationNumber), "LOC", 3);
}

/** ISO date plus a number of days */
export function addDays(iso: string, days: number) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Days from today until an ISO date (negative = in the past) */
export function daysUntil(iso: string) {
  return -daysSinceSigned(iso);
}

function daysSinceSigned(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / 86_400_000);
}

/** Whole days from an ISO date until today (0 = today) */
export function daysSince(iso: string) {
  if (!iso) return 0;
  return Math.max(0, daysSinceSigned(iso));
}

/** First day of the current month, ISO */
export function monthStartISO() {
  return todayISO().slice(0, 8) + "01";
}

/** Last day of the current month, ISO */
export function monthEndISO() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

/** "2026-10-22" -> "Thu" */
export function weekdayOf(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

/** Monday of the week an ISO date falls in */
export function weekStartISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const sinceMonday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return addDays(iso, -sinceMonday);
}

/** Raigam deposits our cheque for a delivery this many days after the goods come */
export const RAIGAM_CHEQUE_DAYS = 21;
/** The app reminds this many days before the deposit, so the money is in the bank */
export const CHEQUE_REMIND_DAYS = 5;

/**
 * The day Raigam deposits our cheque for a received order: the date on the cheque, or 21 days
 * after the goods came while no cheque is entered. "" = not received yet, or paid another way.
 */
export function raigamChequeDate(order: Pick<Order, "receivedDate" | "paymentMethod" | "chequeDepositDate">) {
  if (!order.receivedDate || (order.paymentMethod && order.paymentMethod !== "Cheque")) return "";
  return order.chequeDepositDate || addDays(order.receivedDate, RAIGAM_CHEQUE_DAYS);
}

/**
 * Received orders to remind about: the cheque deposits within the next 5 days (or today), or
 * the date has passed and no payment is entered yet. Soonest first.
 */
export function chequeReminders(orders: Order[]) {
  return orders
    .map((order) => ({ order, date: raigamChequeDate(order) }))
    .filter(({ order, date }) => date && (daysUntil(date) < 0 ? !order.paymentMethod : daysUntil(date) <= CHEQUE_REMIND_DAYS))
    .map((r) => ({ ...r, days: daysUntil(r.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** `orderItems` (any order's) tell a received order with some items already in stock apart ("Partial") */
export function orderStatus(order: Order, orderItems: OrderItem[] = []): OrderStatus {
  if (order.postedToStock) return "Posted";
  if (orderItems.some((l) => l.orderId === order.orderId && l.postedLocation)) return "Partial";
  if (order.receivedDate) return "Received";
  return "Pending";
}

/**
 * SAP code -> unit price on the latest Raigam invoice / order (order IDs count up).
 * New order lines start at this price, not the cost price: cost is net of the invoice discount,
 * which the order takes off again.
 */
export function lastInvoicePrices(orderItems: OrderItem[]) {
  const latest = new Map<string, { orderId: string; price: number }>();
  for (const l of orderItems) {
    if (!(l.unitPrice > 0)) continue;
    const seen = latest.get(l.itemCode);
    if (!seen || l.orderId > seen.orderId) latest.set(l.itemCode, { orderId: l.orderId, price: l.unitPrice });
  }
  return new Map([...latest].map(([code, v]) => [code, v.price]));
}

/**
 * Value of an order line: qty × price − discount. Before the goods come it's the ordered qty; once
 * received, the qty on its Raigam invoice (what Raigam charges for), 0 when it's on no invoice.
 */
export function orderLineValue(
  line: Pick<OrderItem, "orderedQty" | "unitPrice" | "discount"> & { invoicedQty?: number },
  order: Pick<Order, "receivedDate"> | undefined,
) {
  const qty = order?.receivedDate ? (line.invoicedQty ?? 0) : line.orderedQty;
  return qty > 0 ? round2(qty * line.unitPrice - line.discount) : 0;
}

/** One Raigam invoice as printed: its items, lines total, the discount % off it and its grand total */
export function invoiceTotals(invoice: Pick<OrderInvoice, "id" | "discountPercent">, orderItems: OrderItem[]) {
  const lines = orderItems.filter((l) => l.invoiceId === invoice.id);
  const linesTotal = round2(lines.reduce((sum, l) => sum + orderLineValue(l, { receivedDate: "received" }), 0));
  return { lines, units: lines.reduce((n, l) => n + l.invoicedQty, 0), linesTotal, ...invoiceDiscount(linesTotal, invoice.discountPercent) };
}

/** What we owe Raigam for an order: its invoices' grand totals added up (before the goods come: the ordered items at their prices) */
export function orderTotal(order: Pick<Order, "orderId" | "receivedDate">, invoices: OrderInvoice[], orderItems: OrderItem[]) {
  const lines = orderItems.filter((l) => l.orderId === order.orderId);
  if (!order.receivedDate) return round2(lines.reduce((sum, l) => sum + orderLineValue(l, order), 0));
  return round2(invoices.filter((i) => i.orderId === order.orderId).reduce((sum, i) => sum + invoiceTotals(i, lines).total, 0));
}

/** An order's invoice numbers, e.g. "131632, 161342" ("" = none entered yet) */
export function invoiceNumbersOf(order: Pick<Order, "orderId">, invoices: OrderInvoice[]) {
  return invoices
    .filter((i) => i.orderId === order.orderId && i.invoiceNumber)
    .map((i) => i.invoiceNumber)
    .join(", ");
}

/**
 * Raigam's "Discount % for Total Invoice": the Rs. off and the grand total, each rounded to the
 * cent the way the invoice prints them (903,079.00 at 10.5% → 94,823.30 off, 808,255.71 to pay)
 */
export function invoiceDiscount(linesTotal: number, percent: number) {
  const cents = Math.round(linesTotal * 100);
  const off = (cents * (percent || 0)) / 100;
  return { discount: Math.round(off) / 100, total: Math.round(cents - off) / 100 };
}

/** What one unit really cost: the line value after its discount and the invoice discount, per unit */
export function netUnitCost(line: { qty: number; unitPrice: number; discount: number }, invoiceDiscountPercent: number) {
  return round2(((line.qty * line.unitPrice - line.discount) * (1 - (invoiceDiscountPercent || 0) / 100)) / line.qty);
}

/** Match / Unmatch is only meaningful after the delivery has been received */
export function lineStatus(line: Pick<OrderItem, "orderedQty" | "receivedQty">, order: Pick<Order, "receivedDate"> | undefined): LineStatus {
  if (!order?.receivedDate) return "Pending";
  if (line.orderedQty === 0) return "Extra";
  if (line.receivedQty === 0) return "Missing";
  return line.receivedQty === line.orderedQty ? "Match" : "Unmatch";
}

export function includesText(haystack: (string | number | undefined)[], needle: string) {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((v) => String(v ?? "").toLowerCase().includes(q));
}
