import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LineStatus, Order, OrderItem, OrderPayment, OrderStatus } from "./types";

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

export function orderStatus(order: Order): OrderStatus {
  if (order.postedToStock) return "Posted";
  if (order.receivedDate) return "Received";
  return "Pending";
}

/** Value of a supplier invoice line: qty × price − discount (the received qty once the order has arrived) */
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

export function orderLineValue(line: Pick<OrderItem, "orderedQty" | "receivedQty" | "unitPrice" | "discount">, order: Pick<Order, "receivedDate"> | undefined) {
  const qty = order?.receivedDate ? line.receivedQty : line.orderedQty;
  return round2(qty * line.unitPrice - line.discount);
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
export function lineStatus(line: OrderItem, order: Order | undefined): LineStatus {
  if (!order?.receivedDate) return "Pending";
  return line.receivedQty === line.orderedQty ? "Match" : "Unmatch";
}

export function includesText(haystack: (string | number | undefined)[], needle: string) {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((v) => String(v ?? "").toLowerCase().includes(q));
}
