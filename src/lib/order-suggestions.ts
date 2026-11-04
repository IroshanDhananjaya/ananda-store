import type { Item, Order, OrderItem, Sale, StockRecord } from "./types";
import { addDays, LOW_STOCK_LEVEL } from "./utils";

// What to put on the next purchase order, worked out from the bills: how fast each item goes
// (past bills, delivered or not), what's still to deliver, what's in the store and what's already
// ordered from Raigam but not here yet.

export type OrderSuggestion = {
  sapCode: string;
  /** Units on bills dated in the look-back days (qty + free, less what stores didn't take at delivery), delivered or not */
  sold: number;
  /** Of sold: reduced on the bills because the store didn't have them (asked for, so it counts in the rate) */
  short: number;
  /** sold ÷ look-back days */
  perDay: number;
  /** On bills not loaded yet: still has to come out of the store */
  toLoad: number;
  /** On the lorry now (out of the store already, not delivered yet) */
  onLorry: number;
  /** Available in the store now, all locations */
  stock: number;
  /** On purchase orders not received yet */
  onOrder: number;
  /** Days the stock lasts at this rate once the booked bills are loaded (Infinity: not selling) */
  daysLeft: number;
  /** What to order: booked bills + sales for the cover days − stock − on order (0 = enough) */
  suggest: number;
  /** Pack size from the package details, "(90gx50)" → 50; suggestions are rounded up to it */
  pack: number | null;
  /** Why it's suggested; "" when it isn't */
  reason: SuggestionReason | "";
};

/** short: bills to load need more than the store has · out / low: (almost) none left · selling: won't last the cover days */
export type SuggestionReason = "short" | "out" | "low" | "selling";

/** Pack size from the package details: "(90gx50)" → 50 */
export function packOf(item?: Item) {
  if (!item || item.uom === "CARD") return null;
  const match = /x\s*0*(\d+)\s*\)?\s*$/i.exec(item.packageDetails);
  return match ? Number(match[1]) : null;
}

export function orderSuggestions({
  items,
  sales,
  stock,
  orders,
  orderItems,
  today,
  lookbackDays,
  coverDays,
  roundToPack,
  restockLow,
  countOnOrder,
  exceptOrderId = "",
}: {
  items: Item[];
  sales: Sale[];
  stock: StockRecord[];
  orders: Order[];
  orderItems: OrderItem[];
  today: string;
  lookbackDays: number;
  coverDays: number;
  roundToPack: boolean;
  /** Selling (or on bills not delivered) and at or below the low stock level: order at least one pack (or up to the low level) */
  restockLow: boolean;
  /** Take off what's on purchase orders not received yet */
  countOnOrder: boolean;
  /** The order being edited: its own lines aren't "on order" */
  exceptOrderId?: string;
}): OrderSuggestion[] {
  const from = addDays(today, -(lookbackDays - 1));
  const rows = new Map<string, Omit<OrderSuggestion, "perDay" | "daysLeft" | "suggest" | "pack" | "reason">>();
  const rowFor = (sapCode: string) => {
    let row = rows.get(sapCode);
    if (!row) rows.set(sapCode, (row = { sapCode, sold: 0, short: 0, toLoad: 0, onLorry: 0, stock: 0, onOrder: 0 }));
    return row;
  };

  for (const s of sales) {
    if (s.status === "Cancelled") continue;
    for (const l of s.lines) {
      // Asked for: reduced units (not in the store) count, units the store refused at delivery don't
      const asked = l.qty + l.freeQty - (s.status === "Delivered" ? l.cancelQty : 0);
      const out = asked - l.missingQty;
      if (asked <= 0) continue;
      const row = rowFor(l.sapCode);
      if (s.date >= from && s.date <= today) {
        row.sold += asked;
        row.short += l.missingQty;
      }
      if (s.status === "Ordered") row.toLoad += out;
      else if (s.status === "Loaded") row.onLorry += out;
    }
  }
  // Every item on Raigam's order sheet (or sold to stores), even with no stock record or bills yet
  for (const i of items) if (i.sheetSection || i.wholesalePrice > 0) rowFor(i.sapCode);
  for (const r of stock) rowFor(r.sapCode).stock += r.availableQty;
  const pending = new Set(countOnOrder ? orders.filter((o) => !o.receivedDate && o.orderId !== exceptOrderId).map((o) => o.orderId) : []);
  for (const l of orderItems) if (pending.has(l.orderId)) rowFor(l.itemCode).onOrder += l.orderedQty;

  const itemMap = new Map(items.map((i) => [i.sapCode, i]));
  return [...rows.values()]
    .filter((r) => itemMap.has(r.sapCode))
    .map((r) => {
      const perDay = r.sold / lookbackDays;
      const free = r.stock + r.onOrder - r.toLoad;
      const pack = packOf(itemMap.get(r.sapCode));
      // Only items that sell or are on bills not delivered yet; an item nobody buys isn't restocked just for being at 0
      const active = r.sold > 0 || r.toLoad > 0 || r.onLorry > 0;
      const low = restockLow && active && free <= LOW_STOCK_LEVEL;
      // Enough for the cover days; a low item gets at least a pack (or back above the low level) on top of its bills
      const target = Math.max(perDay * coverDays, low ? (pack ?? LOW_STOCK_LEVEL + 1) : 0);
      const raw = Math.ceil(r.toLoad + target - r.stock - r.onOrder);
      const suggest = raw <= 0 ? 0 : roundToPack && pack ? Math.ceil(raw / pack) * pack : raw;
      const reason: SuggestionReason | "" = !suggest ? "" : r.toLoad > r.stock + r.onOrder ? "short" : free <= 0 ? "out" : low ? "low" : "selling";
      return { ...r, perDay, daysLeft: perDay > 0 ? Math.max(0, free) / perDay : free <= 0 ? 0 : Infinity, suggest, pack, reason };
    });
}
