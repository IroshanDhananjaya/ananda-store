import type { StateCreator } from "zustand";
import { billDiscount, linkUnlinkedPayments, missingSold, normalizeAllocations, payableBills, saleSubtotal, stockIsOut, unlinkedAmount } from "./ledger";
import { isRaigamBill, NEW_STORE_CREDIT_DAYS, planRaigamSync, putLink, stockLocationFor, type ItemPicks, type RaigamBill } from "./raigam";
import { returnKey, returnStock, sentMoreThanCollected } from "./returns";
import {
  seedExpenses,
  seedItems,
  seedLocations,
  seedOrderItems,
  seedOrders,
  seedPayments,
  seedRoutes,
  seedSales,
  seedShops,
  seedStock,
} from "./seed";
import {
  PAYMENT_METHODS,
  type Expense,
  type ExpenseInput,
  EXPENSE_CATEGORIES,
  type Item,
  type ItemInput,
  type LocationInput,
  type Order,
  type OrderInput,
  type OrderItem,
  type OrderLineInput,
  type OrderInvoice,
  type OrderPayment,
  type Payment,
  type PaymentInput,
  type RaigamLink,
  type RaigamReturn,
  type RaigamReturnInput,
  type Result,
  type Route,
  type RouteInput,
  type Sale,
  type BillPaymentInput,
  type BillItemInput,
  type SaleInput,
  type SaleLine,
  type SaleLineInput,
  type SaleReturn,
  type SaleReturnInput,
  RETURN_KINDS,
  type Shop,
  type ShopInput,
  type StockInput,
  type StockRecord,
  type StoreLocation,
  type DeliveryInput,
  type LoadInput,
  type OrderItemInput,
  type ReceiveLoadInput,
} from "./types";
import { invoiceDiscount, netUnitCost, newId, nextCode, nextOrderId, NOT_PAID, orderLineValue, round2 } from "./utils";

// Business rules for every change to the data. Runs on the server (src/db/repo.ts)
// against the rows loaded from the database inside a transaction; whatever the
// action changes is written back. The browser store (store.ts) only calls these
// through the runAction server action.

export type Data = {
  items: Item[];
  locations: StoreLocation[];
  stock: StockRecord[];
  orders: Order[];
  orderItems: OrderItem[];
  routes: Route[];
  shops: Shop[];
  sales: Sale[];
  payments: Payment[];
  expenses: Expense[];
  raigamReturns: RaigamReturn[];
  raigamLinks: RaigamLink[];
};

export const DATA_KEYS = [
  "items",
  "locations",
  "stock",
  "orders",
  "orderItems",
  "routes",
  "shops",
  "sales",
  "payments",
  "expenses",
  "raigamReturns",
  "raigamLinks",
] as const satisfies readonly (keyof Data)[];

export type Actions = {
  addItem: (input: ItemInput) => Result;
  updateItem: (id: string, input: ItemInput) => Result;
  deleteItem: (id: string) => Result;

  addLocation: (input: LocationInput) => Result;
  updateLocation: (id: string, input: LocationInput) => Result;
  deleteLocation: (id: string) => Result;

  addStock: (input: StockInput) => Result;
  updateStock: (id: string, input: StockInput) => Result;
  deleteStock: (id: string) => Result;
  issueStock: (id: string, qty: number, date: string) => Result;

  createOrder: (input: OrderInput, lines: OrderLineInput[]) => Result;
  updateOrder: (id: string, input: OrderInput, lines: OrderLineInput[]) => Result;
  deleteOrder: (id: string) => Result;
  /** Record how a Raigam bill was paid; works on posted orders too */
  payOrder: (id: string, payment: OrderPayment) => Result;
  /** Add or change Raigam's invoice / PO number; works on posted orders too */
  setOrderInvoice: (id: string, invoice: OrderInvoice) => Result;
  /** Adds received quantities to stock. `locationByLine` maps OrderItem.id -> location number. */
  postOrderToStock: (id: string, locationByLine: Record<string, string>) => Result;
  reverseOrderPosting: (id: string) => Result;
  /** A load arrives from Raigam: saved as a received order, added to stock, item cost prices updated */
  receiveLoad: (input: ReceiveLoadInput) => Result;

  addOrderItem: (input: OrderItemInput) => Result;
  updateOrderItem: (id: string, input: OrderItemInput) => Result;
  deleteOrderItem: (id: string) => Result;

  addRoute: (input: RouteInput) => Result;
  updateRoute: (id: string, input: RouteInput) => Result;
  deleteRoute: (id: string) => Result;

  addShop: (input: ShopInput) => Result;
  updateShop: (id: string, input: ShopInput) => Result;
  deleteShop: (id: string) => Result;

  /** Rep creates a bill (store order). No stock moves until it is loaded. */
  /** `payments`: money the store paid with the order (each becomes a receipt linked to the bill) */
  createSale: (input: SaleInput, payments?: BillPaymentInput[]) => Result;
  /** Edits an order; once loaded, the stock is adjusted to match */
  updateSale: (id: string, input: SaleInput) => Result;
  /** Deletes an order; loaded/delivered quantities go back into stock */
  deleteSale: (id: string) => Result;
  /** Change one item on a bill from its page, or add a free issue item (`lineId` null); the rest of the bill stays as it is */
  saveBillItem: (saleId: string, lineId: string | null, input: BillItemInput) => Result;
  /** Take one item off a bill from its page */
  removeBillItem: (saleId: string, lineId: string) => Result;
  /** Add a return item to a bill from its page (`returnId` null), or change one */
  saveBillReturn: (saleId: string, returnId: string | null, input: SaleReturnInput) => Result;
  /** Take one return item off a bill from its page */
  removeBillReturn: (saleId: string, returnId: string) => Result;
  /** Load bills on the lorry: deducts their quantities from stock (all or nothing) */
  loadSales: (ids: string[], input: LoadInput) => Result;
  /** Take a loaded bill off the lorry: quantities go back into stock */
  unloadSale: (id: string) => Result;
  /**
   * Items not in the store, on a bill not delivered yet (bill line id -> units; lines left out keep theirs):
   * not loaded and not charged. On a loaded bill they go back into stock.
   */
  markMissing: (id: string, missing: Record<string, number>) => Result;
  /** Items given to the store; any money collected is saved as a receipt linked to bills */
  deliverSale: (id: string, input: DeliveryInput) => Result;
  /** Undo a delivery entered by mistake: the bill is back on the lorry */
  undoDelivery: (id: string) => Result;
  /** "Late Delivery": not delivered on its day; loaded goods go back into stock and the bill waits to load again */
  markLate: (id: string) => Result;
  /** Cancel a bill that wasn't delivered: kept as a record; loaded goods go back into stock */
  cancelSale: (id: string) => Result;
  /** Undo a cancel: the bill waits to load again */
  restoreSale: (id: string) => Result;
  /** Tick (or untick) bills as compared with Raigam's printed bill */
  markChecked: (ids: string[], checked: boolean) => Result;

  addPayment: (input: PaymentInput) => Result;
  updatePayment: (id: string, input: PaymentInput) => Result;
  deletePayment: (id: string) => Result;
  /** Link a store's unlinked payment money to its oldest open bills */
  linkPayments: (shopId: string) => Result;
  /** A cheque was collected from the store on `date`; "" puts it back to still to collect */
  markChequeCollected: (id: string, date: string) => Result;

  addExpense: (input: ExpenseInput) => Result;
  updateExpense: (id: string, input: ExpenseInput) => Result;
  deleteExpense: (id: string) => Result;

  /** Return items leave the return items store for Raigam (saved as a return note) */
  sendReturnsToRaigam: (input: RaigamReturnInput) => Result;
  /** Delete a return note: its items are back in the return items store */
  deleteRaigamReturn: (id: string) => Result;

  /**
   * Sync from Raigam (src/lib/raigam.ts): adds new bills (and a store with just its name for a new outlet),
   * updates bills not delivered yet that changed on Raigam, and remembers the item matches picked.
   * Bills that can't be saved are left out and listed in `notes`; the rest is saved.
   */
  syncRaigamBills: (bills: RaigamBill[], itemPicks: ItemPicks) => Result;

  /** Replace everything with the sample data */
  resetDemoData: () => Result;
};

export type ActionName = keyof Actions;

export const ACTION_NAMES = [
  "addItem",
  "updateItem",
  "deleteItem",
  "addLocation",
  "updateLocation",
  "deleteLocation",
  "addStock",
  "updateStock",
  "deleteStock",
  "issueStock",
  "createOrder",
  "updateOrder",
  "deleteOrder",
  "payOrder",
  "setOrderInvoice",
  "postOrderToStock",
  "reverseOrderPosting",
  "receiveLoad",
  "addOrderItem",
  "updateOrderItem",
  "deleteOrderItem",
  "addRoute",
  "updateRoute",
  "deleteRoute",
  "addShop",
  "updateShop",
  "deleteShop",
  "createSale",
  "updateSale",
  "deleteSale",
  "saveBillItem",
  "removeBillItem",
  "saveBillReturn",
  "removeBillReturn",
  "loadSales",
  "unloadSale",
  "markMissing",
  "deliverSale",
  "undoDelivery",
  "markLate",
  "cancelSale",
  "restoreSale",
  "markChecked",
  "addPayment",
  "updatePayment",
  "deletePayment",
  "linkPayments",
  "markChequeCollected",
  "addExpense",
  "updateExpense",
  "deleteExpense",
  "sendReturnsToRaigam",
  "deleteRaigamReturn",
  "syncRaigamBills",
  "resetDemoData",
] as const satisfies readonly ActionName[];

// Fails to compile if an action is missing from ACTION_NAMES
const _allActionsListed: Exclude<ActionName, (typeof ACTION_NAMES)[number]> extends never ? true : never = true;
void _allActionsListed;

export type AppStore = Data & Actions;

export const emptyData = (): Data => ({
  items: [],
  locations: [],
  stock: [],
  orders: [],
  orderItems: [],
  routes: [],
  shops: [],
  sales: [],
  payments: [],
  expenses: [],
  raigamReturns: [],
  raigamLinks: [],
});

export const seedData = (): Data => ({
  items: seedItems,
  locations: seedLocations,
  stock: seedStock,
  orders: seedOrders,
  orderItems: seedOrderItems,
  routes: seedRoutes,
  shops: seedShops,
  sales: seedSales,
  payments: seedPayments,
  expenses: seedExpenses,
  raigamReturns: [],
  raigamLinks: [],
});

export const pickData = (s: Data): Data => Object.fromEntries(DATA_KEYS.map((k) => [k, s[k]])) as Data;

export const ok = (id?: string): Result => ({ ok: true, id });
export const fail = (error: string): Result => ({ ok: false, error });

const isWholeNumber = (n: number) => Number.isInteger(n) && n >= 0;
const isISODate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function validateLine(line: OrderLineInput, items: Item[]): string | null {
  if (!items.some((i) => i.sapCode === line.itemCode)) return `Unknown item code "${line.itemCode}".`;
  if (!isWholeNumber(line.orderedQty) || line.orderedQty === 0)
    return `Ordered quantity for ${line.itemCode} must be a whole number above 0.`;
  if (!isWholeNumber(line.receivedQty)) return `Received quantity for ${line.itemCode} must be a whole number.`;
  return validatePrice(line.itemCode, Math.max(line.orderedQty, line.receivedQty), line.unitPrice, line.discount);
}

/** Invoice price and line discount (Rs.): the discount can't be more than the line amount */
function validatePrice(itemCode: string, qty: number, unitPrice: number, discount: number): string | null {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return `Price for ${itemCode} must be 0 or more.`;
  if (!Number.isFinite(discount) || discount < 0) return `Discount for ${itemCode} must be 0 or more.`;
  if (discount > qty * unitPrice + 0.004) return `Discount for ${itemCode} is more than the line amount.`;
  return null;
}

function validateDiscountPercent(percent: number): string | null {
  return Number.isFinite(percent) && percent >= 0 && percent < 100 ? null : "Invoice discount must be 0% or more and under 100%.";
}

/** Another order already has this supplier invoice number (entering a load twice would double the stock) */
function duplicateInvoice(orders: Order[], invoiceNumber: string, exceptId?: string): Order | undefined {
  const key = invoiceNumber.trim().toUpperCase();
  return key ? orders.find((o) => o.id !== exceptId && o.invoiceNumber.trim().toUpperCase() === key) : undefined;
}

function validateLines(lines: OrderLineInput[], items: Item[]): string | null {
  if (lines.length === 0) return "Add at least one item to the order.";
  const seen = new Set<string>();
  for (const line of lines) {
    const err = validateLine(line, items);
    if (err) return err;
    if (seen.has(line.itemCode)) return `${line.itemCode} is added more than once.`;
    seen.add(line.itemCode);
  }
  return null;
}

// ---------- Sales helpers ----------

type StockMove = Pick<SaleLineInput, "sapCode" | "locationNumber" | "qty">;

/** Put sale quantities back into stock (sale edited or deleted) */
function returnToStock(stock: StockRecord[], lines: StockMove[], date: string): StockRecord[] {
  let next = [...stock];
  for (const l of lines) {
    const idx = next.findIndex((r) => r.sapCode === l.sapCode && r.locationNumber === l.locationNumber);
    if (idx >= 0) {
      const r = next[idx];
      next[idx] = { ...r, availableQty: r.availableQty + l.qty, issuedQty: Math.max(0, r.issuedQty - l.qty), lastUpdate: date };
    } else {
      next = [...next, { id: newId(), sapCode: l.sapCode, locationNumber: l.locationNumber, availableQty: l.qty, issuedQty: 0, lastUpdate: date }];
    }
  }
  return next;
}

/** Add received quantities to stock, creating the stock record if the item isn't at that location yet */
function receiveIntoStock(stock: StockRecord[], moves: StockMove[], date: string): StockRecord[] {
  let next = [...stock];
  for (const m of moves) {
    const idx = next.findIndex((r) => r.sapCode === m.sapCode && r.locationNumber === m.locationNumber);
    if (idx >= 0) next[idx] = { ...next[idx], availableQty: next[idx].availableQty + m.qty, lastUpdate: date };
    else next = [...next, { id: newId(), sapCode: m.sapCode, locationNumber: m.locationNumber, availableQty: m.qty, issuedQty: 0, lastUpdate: date }];
  }
  return next;
}

/** Take sale quantities out of stock; fails if a line needs more than is available */
function takeFromStock(stock: StockRecord[], lines: StockMove[], date: string): { stock: StockRecord[] } | { error: string } {
  const next = [...stock];
  for (const l of lines) {
    const idx = next.findIndex((r) => r.sapCode === l.sapCode && r.locationNumber === l.locationNumber);
    if (idx < 0) return { error: `${l.sapCode} has no stock at ${l.locationNumber}.` };
    const r = next[idx];
    if (r.availableQty < l.qty)
      return { error: `Only ${r.availableQty} of ${l.sapCode} available at ${l.locationNumber} (sale needs ${l.qty}).` };
    next[idx] = { ...r, availableQty: r.availableQty - l.qty, issuedQty: r.issuedQty + l.qty, lastUpdate: date };
  }
  return { stock: next };
}

/** Take out goods that already left the store (a bill delivered without loading): never blocks, short stock just stops at 0 */
function takeWhatIsThere(stock: StockRecord[], lines: StockMove[], date: string): StockRecord[] {
  const next = [...stock];
  for (const l of lines) {
    const idx = next.findIndex((r) => r.sapCode === l.sapCode && r.locationNumber === l.locationNumber);
    if (idx < 0) continue;
    const r = next[idx];
    next[idx] = { ...r, availableQty: Math.max(0, r.availableQty - l.qty), issuedQty: r.issuedQty + l.qty, lastUpdate: date };
  }
  return next;
}

// What a bill moves in and out of stock:
//   loading takes qty + free issue, less what was missing in the store; at delivery the cancelled qty comes back.
//   Return items never go into stock: they're held for Raigam (src/lib/returns.ts).
const loadMoves = (lines: SaleLine[]): StockMove[] =>
  lines.map((l) => ({ sapCode: l.sapCode, locationNumber: l.locationNumber, qty: l.qty + l.freeQty - l.missingQty })).filter((m) => m.qty > 0);
const cancelMoves = (lines: SaleLine[]): StockMove[] =>
  lines.filter((l) => l.cancelQty > 0).map((l) => ({ sapCode: l.sapCode, locationNumber: l.locationNumber, qty: l.cancelQty }));
const deliveredMoves = (lines: SaleLine[]): StockMove[] =>
  lines
    .map((l) => ({ sapCode: l.sapCode, locationNumber: l.locationNumber, qty: l.qty + l.freeQty - l.missingQty - l.cancelQty }))
    .filter((m) => m.qty > 0);

/** The bill with these units missing (bill line id -> units; lines left out keep theirs); the bill discount follows the new value */
function withMissing(sale: Sale, missing: Record<string, number>): Sale {
  const lines = sale.lines.map((l) => ({ ...l, missingQty: missing[l.id] ?? l.missingQty }));
  return { ...sale, lines, discount: billDiscount(saleSubtotal({ lines, returns: sale.returns }), sale.discountPercent) };
}

/** What's wrong with missing units for a bill's lines, if anything */
function validateMissing(sale: Sale, missing: Record<string, number>): string | null {
  for (const [lineId, qty] of Object.entries(missing)) {
    const line = sale.lines.find((l) => l.id === lineId);
    if (!line) return `One of the reduced items isn't on ${sale.saleNo}.`;
    if (!Number.isInteger(qty) || qty < 0 || qty > line.qty + line.freeQty)
      return `Qty reduced on ${line.sapCode} (${sale.saleNo}) must be a whole number from 0 to ${line.qty + line.freeQty}.`;
  }
  return null;
}
/** What a bill holds out of stock in its current status */
const outMoves = (sale: Sale): StockMove[] => (sale.status === "Delivered" ? deliveredMoves(sale.lines) : stockIsOut(sale) ? loadMoves(sale.lines) : []);

function validateReturns(returns: SaleReturnInput[], items: Item[]): string | null {
  const seen = new Set<string>();
  for (const r of returns) {
    if (!RETURN_KINDS.includes(r.kind)) return "Choose Good or Market for each return.";
    if (!items.some((i) => i.sapCode === r.sapCode)) return `Unknown returned item "${r.sapCode}".`;
    if (!Number.isInteger(r.qty) || r.qty <= 0) return `Returned qty for ${r.sapCode} must be a whole number above 0.`;
    if (!Number.isFinite(r.unitPrice) || r.unitPrice < 0) return `Return price for ${r.sapCode} must be 0 or more.`;
    const key = returnKey(r.kind, r.sapCode);
    if (seen.has(key)) return `${r.sapCode} is entered twice as a ${r.kind.toLowerCase()} return. Put it on one line.`;
    seen.add(key);
  }
  return null;
}

/** Return items as saved; an item already on the bill's returns keeps the cost it was saved with (like bill lines) */
function cleanReturns(input: SaleReturnInput[], items: Item[], existing: SaleReturn[] = []): SaleReturn[] {
  const savedCost = new Map(existing.map((r) => [r.sapCode, r.costPrice]));
  return input.map((r) => ({
    id: newId(),
    kind: r.kind,
    sapCode: r.sapCode,
    qty: r.qty,
    unitPrice: round2(r.unitPrice),
    costPrice: savedCost.get(r.sapCode) ?? items.find((i) => i.sapCode === r.sapCode)?.costPrice ?? 0,
  }));
}

function validateSale(input: SaleInput, items: Item[], shops: Shop[], sales: Sale[], existing?: Sale): string | null {
  if (!input.date) return "Order date is required.";
  const invoiceNo = input.invoiceNo.trim().toUpperCase();
  const dup = invoiceNo ? sales.find((s) => s.id !== existing?.id && s.invoiceNo === invoiceNo) : undefined;
  if (dup) return `Raigam invoice ${invoiceNo} is already on ${dup.saleNo}.`;
  if (!input.dueDate) return "Set the end date for collecting the balance.";
  if (input.dueDate < input.date) return "The end date for collecting can't be before the order date.";
  const shop = shops.find((s) => s.id === input.shopId);
  if (!shop) return "Select a store.";
  if (!shop.active && existing?.shopId !== shop.id) return `${shop.shopName} is inactive. Activate it before selling.`;
  if (input.lines.length === 0) return "Add at least one item to the order.";
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!items.some((i) => i.sapCode === l.sapCode)) return `Unknown item "${l.sapCode}".`;
    if (!l.locationNumber) return `Choose the stock location for ${l.sapCode}.`;
    const takenOff = l.takenOff ?? 0;
    if (!Number.isInteger(takenOff) || takenOff < 0) return `Qty taken off ${l.sapCode} must be a whole number, 0 or more.`;
    if (!Number.isInteger(l.qty) || l.qty < 0) return `Quantity for ${l.sapCode} must be a whole number, 0 or more.`;
    if (!Number.isInteger(l.freeQty) || l.freeQty < 0) return `Free issue qty for ${l.sapCode} must be a whole number, 0 or more.`;
    // Qty 0 only for a free item (free issue only) or an item taken off the bill on Raigam (kept to show as on Raigam's bill)
    if (l.qty === 0 && l.freeQty === 0 && takenOff === 0) return `Enter a qty or a free issue qty for ${l.sapCode}.`;
    if (l.missingQty !== undefined && (!Number.isInteger(l.missingQty) || l.missingQty < 0 || l.missingQty > l.qty + l.freeQty))
      return `Qty reduced on ${l.sapCode} must be a whole number from 0 to ${l.qty + l.freeQty}.`;
    if ((l.note?.length ?? 0) > 300) return `The note on ${l.sapCode} is too long (300 characters at most).`;
    if (!Number.isFinite(l.unitPrice) || l.unitPrice < 0) return `Unit price for ${l.sapCode} must be 0 or more.`;
    if (!(l.discountPct >= 0 && l.discountPct <= 100)) return `Discount for ${l.sapCode} must be a % from 0 to 100.`;
    const key = `${l.sapCode}|${l.locationNumber}`;
    if (seen.has(key)) return `${l.sapCode} from ${l.locationNumber} is added more than once.`;
    seen.add(key);
  }
  const returnsErr = validateReturns(input.returns, items);
  if (returnsErr) return returnsErr;
  if (!(input.discountPercent >= 0 && input.discountPercent < 100)) return "Bill discount must be a % from 0 to 99.99.";
  return null;
}

/**
 * Cleaned order fields (status, loading and delivery details are set by the caller).
 * Each line saves the item's cost price; when editing, a line keeps the cost it was saved with
 * so changing an item's price later doesn't rewrite past profit.
 */
function cleanSale(
  input: SaleInput,
  items: Item[],
  existing?: Sale,
): Omit<Sale, "id" | "saleNo" | "status" | "late" | "loadedDate" | "vehicleNumber" | "deliveredDate" | "checked" | "deliveryNote" | "extraCredit"> {
  const savedCost = new Map(existing?.lines.map((l) => [l.sapCode, l.costPrice]));
  // Editing a loaded or delivered bill keeps what was missing at loading and cancelled at delivery
  const savedLine = new Map(existing?.lines.map((l) => [`${l.sapCode}|${l.locationNumber}`, l]));
  const lines: SaleLine[] = input.lines.map((l) => {
    const saved = savedLine.get(`${l.sapCode}|${l.locationNumber}`);
    const takenOff = l.takenOff ?? 0;
    // Kept unless given; taken off on Raigam after it was marked missing here: the same units, so they aren't taken off twice
    const missingQty =
      l.missingQty ?? Math.min(Math.max(0, (saved?.missingQty ?? 0) - Math.max(0, takenOff - (saved?.takenOff ?? 0))), l.qty + l.freeQty);
    return {
      id: newId(),
      sapCode: l.sapCode,
      locationNumber: l.locationNumber,
      qty: l.qty,
      freeQty: l.freeQty,
      takenOff,
      missingQty,
      note: (l.note ?? saved?.note ?? "").trim(),
      freeWith: l.freeWith ?? saved?.freeWith ?? "",
      unitPrice: round2(l.unitPrice),
      discountPct: round2(l.discountPct),
      cancelQty: Math.min(saved?.cancelQty ?? 0, l.qty - Math.min(missingQty, l.qty)),
      costPrice: savedCost.get(l.sapCode) ?? items.find((i) => i.sapCode === l.sapCode)?.costPrice ?? 0,
    };
  });
  const returns = cleanReturns(input.returns, items, existing?.returns);
  const discountPercent = round2(input.discountPercent);
  return {
    ...input,
    invoiceNo: input.invoiceNo.trim().toUpperCase(),
    repName: input.repName.trim(),
    notes: input.notes.trim(),
    lines,
    returns,
    discountPercent,
    discount: billDiscount(saleSubtotal({ lines, returns }), discountPercent),
  };
}

/** A bill line as the bill form sends it (what was missing and cancelled is kept by cleanSale) */
const lineInputOf = (l: SaleLine): SaleLineInput => ({
  sapCode: l.sapCode,
  locationNumber: l.locationNumber,
  qty: l.qty,
  freeQty: l.freeQty,
  takenOff: l.takenOff,
  unitPrice: l.unitPrice,
  discountPct: l.discountPct,
});

/** A return item as the bill form sends it */
const returnInputOf = (r: SaleReturn): SaleReturnInput => ({ kind: r.kind, sapCode: r.sapCode, qty: r.qty, unitPrice: r.unitPrice });

/** A saved bill as the bill form sends it, with these lines (and return items) */
const saleInputOf = (sale: Sale, lines: SaleLineInput[], returns = sale.returns.map(returnInputOf)): SaleInput => ({
  date: sale.date,
  shopId: sale.shopId,
  repName: sale.repName,
  dueDate: sale.dueDate,
  notes: sale.notes,
  invoiceNo: sale.invoiceNo,
  discountPercent: sale.discountPercent,
  lines,
  returns,
});

function validateExpense(input: ExpenseInput): string | null {
  if (!input.date) return "Expense date is required.";
  if (!EXPENSE_CATEGORIES.includes(input.category)) return "Select a category.";
  if (!(input.amount > 0)) return "Amount must be more than 0.";
  if (!PAYMENT_METHODS.includes(input.method)) return "Select how it was paid.";
  return null;
}

const cleanExpense = (input: ExpenseInput): ExpenseInput => ({ ...input, amount: round2(input.amount), description: input.description.trim() });

function validateShop(input: ShopInput, shops: Shop[], routes: Route[], id?: string): string | null {
  const code = input.shopCode.trim().toUpperCase();
  if (!code) return "Store number is required.";
  if (shops.some((s) => s.id !== id && s.shopCode === code)) return `Store number ${code} already exists.`;
  if (!input.shopName.trim()) return "Store name is required.";
  if (!routes.some((r) => r.id === input.routeId)) return "Select a route.";
  if (!(input.creditLimit >= 0)) return "Credit limit must be 0 or more.";
  if (!Number.isInteger(input.creditDays) || input.creditDays < 0) return "Credit days must be a whole number (0 or more).";
  if (!Number.isFinite(input.openingBalance)) return "Opening balance must be a number.";
  return null;
}

function cleanShop(input: ShopInput): ShopInput {
  return {
    ...input,
    shopCode: input.shopCode.trim().toUpperCase(),
    shopName: input.shopName.trim(),
    ownerName: input.ownerName.trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    town: input.town.trim(),
    mapLink: input.mapLink.trim(),
    notes: input.notes.trim(),
    creditLimit: round2(input.creditLimit),
    openingBalance: round2(input.openingBalance),
  };
}

function validatePayment(input: PaymentInput, shops: Shop[], sales: Sale[], payments: Payment[], id?: string): string | null {
  if (!input.date) return "Payment date is required.";
  const shop = shops.find((s) => s.id === input.shopId);
  if (!shop) return "Select a store.";
  if (!(input.amount > 0)) return "Amount must be more than 0.";
  if (!PAYMENT_METHODS.includes(input.method)) return "Select a payment method.";
  // A cheque still to collect may not have its number yet
  if (input.method === "Cheque" && input.chequeCollectedDate && !input.chequeNumber.trim()) return "Enter the cheque number of the collected cheque.";
  if (input.method === "Cheque" && input.chequeCollectedDate && !isISODate(input.chequeCollectedDate)) return "Enter the date the cheque was collected.";

  // Bills this payment links to must be open (or not delivered yet), and not over-paid
  const bills = new Map(payableBills(shop, sales, payments.filter((p) => p.id !== id)).map((b) => [b.id, b]));
  for (const a of input.allocations) {
    if (!(a.amount > 0)) continue;
    const bill = bills.get(a.saleId);
    if (!bill) return "One of the selected bills is already paid, cancelled, or doesn't belong to this store.";
    if (a.amount > bill.left + 0.004) return `${bill.ref} only has ${bill.left.toFixed(2)} left to pay.`;
  }
  if (unlinkedAmount(input) < -0.004) return "The amounts for bills add up to more than the payment.";
  return null;
}

function cleanPayment(input: PaymentInput): PaymentInput {
  const cheque = input.method === "Cheque";
  return {
    ...input,
    amount: round2(input.amount),
    chequeNumber: cheque ? input.chequeNumber.trim() : "",
    chequeDate: cheque ? input.chequeDate : "",
    // Older screens don't send it: still to collect
    chequeCollectedDate: cheque ? (input.chequeCollectedDate ?? "") : "",
    reference: input.reference.trim(),
    allocations: input.allocations.filter((a) => a.amount > 0).map((a) => ({ saleId: a.saleId, amount: round2(a.amount) })),
  };
}



/** Prices are kept to the cent, as the database stores them */
const cleanItem = (input: ItemInput): ItemInput => ({
  ...input,
  description: input.description.trim(),
  costPrice: round2(input.costPrice),
  wholesalePrice: round2(input.wholesalePrice),
  retailPrice: round2(input.retailPrice),
  locationNumber: input.locationNumber ?? "",
  // Upper case, like the sheet's headings, so "Blue Pack Soya" and "BLUE PACK SOYA" are one section
  sheetSection: (input.sheetSection ?? "").trim().toUpperCase(),
  sheetNo: input.sheetNo || 0,
});

/** An item's location may be left unset, but if given it must exist */
const validItemLocation = (locations: StoreLocation[], input: ItemInput) =>
  !input.locationNumber || locations.some((l) => l.locationNumber === input.locationNumber);

function validateItem(locations: StoreLocation[], input: ItemInput): string | null {
  if (!validItemLocation(locations, input)) return `Location ${input.locationNumber} doesn't exist.`;
  if (!isWholeNumber(input.sheetNo || 0)) return "Order sheet SN must be a whole number.";
  return null;
}

function validateOrderPayment(p: OrderPayment): string | null {
  if (!p.paymentMethod) return null;
  if (!PAYMENT_METHODS.includes(p.paymentMethod)) return "Select a payment method.";
  if (!p.paidDate) return "Enter the date Raigam was paid.";
  if (p.paymentMethod === "Cheque" && !p.chequeNumber.trim()) return "Cheque number is required for cheque payments.";
  return null;
}

/** Not paid clears everything; cheque fields are kept only for cheques */
function cleanOrderPayment(p: OrderPayment): OrderPayment {
  if (!p.paymentMethod) return NOT_PAID;
  const cheque = p.paymentMethod === "Cheque";
  return {
    paymentMethod: p.paymentMethod,
    paidDate: p.paidDate,
    chequeNumber: cheque ? p.chequeNumber.trim() : "",
    chequeDepositDate: cheque ? p.chequeDepositDate : "",
    paymentReference: p.paymentReference.trim(),
  };
}

function cleanOrder(input: OrderInput): OrderInput {
  return {
    ...input,
    ...cleanOrderPayment(input),
    invoiceNumber: input.invoiceNumber.trim(),
    poNumber: input.poNumber.trim(),
    totalBillAmount: round2(input.totalBillAmount),
    discountPercent: round2(input.discountPercent || 0),
    // A received time without a received date is meaningless
    receivedTime: input.receivedDate ? input.receivedTime : "",
    territory: (input.territory ?? "").trim(),
    requiredDate: input.requiredDate ?? "",
  };
}

function cleanLine(line: OrderLineInput): OrderLineInput {
  return { ...line, unitPrice: round2(line.unitPrice), discount: round2(line.discount), remarks: line.remarks.trim() };
}

/**
 * The actions, as a zustand store creator. `getToday` gives the user's local date
 * (the server's clock may be in another time zone).
 */
export const createCore =
  (getToday: () => string): StateCreator<AppStore> =>
  (set, get) => ({
    ...emptyData(),

    // ---------- Items ----------
    addItem: (input) => {
      const sapCode = input.sapCode.trim().toUpperCase();
      if (get().items.some((i) => i.sapCode === sapCode)) return fail(`SAP code ${sapCode} already exists.`);
      const err = validateItem(get().locations, input);
      if (err) return fail(err);
      const item: Item = { ...cleanItem(input), sapCode, id: newId() };
      set((s) => ({ items: [...s.items, item] }));
      return ok(item.id);
    },
    updateItem: (id, input) => {
      const err = validateItem(get().locations, input);
      if (err) return fail(err);
      // SAP code is the key other tables reference, so it is not editable
      set((s) => ({
        items: s.items.map((i) =>
          i.id === id ? { ...i, ...cleanItem(input), sapCode: i.sapCode } : i,
        ),
      }));
      return ok(id);
    },
    deleteItem: (id) => {
      const { items, stock, orderItems } = get();
      const item = items.find((i) => i.id === id);
      if (!item) return fail("Item not found.");
      if (stock.some((s) => s.sapCode === item.sapCode))
        return fail(`${item.sapCode} has stock records. Delete those first.`);
      if (orderItems.some((l) => l.itemCode === item.sapCode))
        return fail(`${item.sapCode} is used in orders and cannot be deleted.`);
      if (get().sales.some((s) => s.lines.some((l) => l.sapCode === item.sapCode) || s.returns.some((r) => r.sapCode === item.sapCode)))
        return fail(`${item.sapCode} is used in sales and cannot be deleted.`);
      if (get().raigamReturns.some((r) => r.lines.some((l) => l.sapCode === item.sapCode)))
        return fail(`${item.sapCode} is on a return note sent to Raigam and cannot be deleted.`);
      set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      return ok();
    },

    // ---------- Store locations ----------
    addLocation: (input) => {
      const locationNumber = input.locationNumber.trim().toUpperCase();
      if (get().locations.some((l) => l.locationNumber === locationNumber))
        return fail(`${locationNumber} already exists.`);
      const loc: StoreLocation = { id: newId(), locationNumber, itemGroup: input.itemGroup.trim().toUpperCase() };
      set((s) => ({ locations: [...s.locations, loc] }));
      return ok(loc.id);
    },
    updateLocation: (id, input) => {
      set((s) => ({
        locations: s.locations.map((l) =>
          l.id === id ? { ...l, itemGroup: input.itemGroup.trim().toUpperCase() } : l,
        ),
      }));
      return ok(id);
    },
    deleteLocation: (id) => {
      const loc = get().locations.find((l) => l.id === id);
      if (!loc) return fail("Location not found.");
      if (get().stock.some((s) => s.locationNumber === loc.locationNumber))
        return fail(`${loc.locationNumber} still holds stock records.`);
      const mapped = get().items.filter((i) => i.locationNumber === loc.locationNumber).length;
      if (mapped)
        return fail(
          `${mapped === 1 ? "1 item is" : `${mapped} items are`} kept at ${loc.locationNumber}. Move ${mapped === 1 ? "it" : "them"} to another location on the Items page first.`,
        );
      set((s) => ({ locations: s.locations.filter((l) => l.id !== id) }));
      return ok();
    },

    // ---------- Stock (Store Details) ----------
    addStock: (input) => {
      const { stock, items, locations } = get();
      if (!items.some((i) => i.sapCode === input.sapCode)) return fail("Select a valid item.");
      if (!locations.some((l) => l.locationNumber === input.locationNumber)) return fail("Select a valid location.");
      if (!isWholeNumber(input.availableQty) || !isWholeNumber(input.issuedQty))
        return fail("Quantities must be whole numbers (0 or more).");
      if (stock.some((s) => s.sapCode === input.sapCode && s.locationNumber === input.locationNumber))
        return fail(`${input.sapCode} already has a stock record at ${input.locationNumber}. Edit that one instead.`);
      const record: StockRecord = { ...input, id: newId() };
      set((s) => ({ stock: [...s.stock, record] }));
      return ok(record.id);
    },
    updateStock: (id, input) => {
      if (!isWholeNumber(input.availableQty) || !isWholeNumber(input.issuedQty))
        return fail("Quantities must be whole numbers (0 or more).");
      const clash = get().stock.some(
        (s) => s.id !== id && s.sapCode === input.sapCode && s.locationNumber === input.locationNumber,
      );
      if (clash) return fail(`${input.sapCode} already has a stock record at ${input.locationNumber}.`);
      set((s) => ({ stock: s.stock.map((r) => (r.id === id ? { ...r, ...input } : r)) }));
      return ok(id);
    },
    deleteStock: (id) => {
      set((s) => ({ stock: s.stock.filter((r) => r.id !== id) }));
      return ok();
    },
    issueStock: (id, qty, date) => {
      const record = get().stock.find((r) => r.id === id);
      if (!record) return fail("Stock record not found.");
      if (!Number.isInteger(qty) || qty <= 0) return fail("Issue quantity must be a whole number above 0.");
      if (qty > record.availableQty) return fail(`Only ${record.availableQty} available to issue.`);
      set((s) => ({
        stock: s.stock.map((r) =>
          r.id === id
            ? { ...r, availableQty: r.availableQty - qty, issuedQty: r.issuedQty + qty, lastUpdate: date || getToday() }
            : r,
        ),
      }));
      return ok(id);
    },

    // ---------- Orders ----------
    createOrder: (input, lines) => {
      const err = validateLines(lines, get().items);
      if (err) return fail(err);
      if (!input.orderDate) return fail("Order date is required.");
      const pctErr = validateDiscountPercent(input.discountPercent || 0);
      if (pctErr) return fail(pctErr);
      const payErr = validateOrderPayment(input);
      if (payErr) return fail(payErr);
      const dup = duplicateInvoice(get().orders, input.invoiceNumber);
      if (dup) return fail(`Invoice ${input.invoiceNumber.trim()} is already entered as ${dup.orderId}.`);
      const order: Order ={ ...cleanOrder(input), id: newId(), orderId: nextOrderId(get().orders), postedToStock: false };
      const newLines: OrderItem[] = lines.map((l) => ({ ...cleanLine(l), id: newId(), orderId: order.orderId }));
      set((s) => ({ orders: [...s.orders, order], orderItems: [...s.orderItems, ...newLines] }));
      return ok(order.id);
    },
    updateOrder: (id, input, lines) => {
      const order = get().orders.find((o) => o.id === id);
      if (!order) return fail("Order not found.");
      if (order.postedToStock) return fail("This order is posted to stock. Reverse the posting before editing.");
      if (!input.orderDate) return fail("Order date is required.");
      const pctErr = validateDiscountPercent(input.discountPercent || 0);
      if (pctErr) return fail(pctErr);
      const payErr = validateOrderPayment(input);
      if (payErr) return fail(payErr);
      const dup = duplicateInvoice(get().orders, input.invoiceNumber, id);
      if (dup) return fail(`Invoice ${input.invoiceNumber.trim()} is already entered as ${dup.orderId}.`);
      const err = validateLines(lines, get().items);
      if (err) return fail(err);
      const newLines: OrderItem[] = lines.map((l) => ({ ...cleanLine(l), id: newId(), orderId: order.orderId }));
      set((s) => ({
        orders: s.orders.map((o) => (o.id === id ? { ...o, ...cleanOrder(input) } : o)),
        orderItems: [...s.orderItems.filter((l) => l.orderId !== order.orderId), ...newLines],
      }));
      return ok(id);
    },
    deleteOrder: (id) => {
      const order = get().orders.find((o) => o.id === id);
      if (!order) return fail("Order not found.");
      if (order.postedToStock) return fail("This order is posted to stock. Reverse the posting before deleting.");
      set((s) => ({
        orders: s.orders.filter((o) => o.id !== id),
        orderItems: s.orderItems.filter((l) => l.orderId !== order.orderId),
      }));
      return ok();
    },
    payOrder: (id, payment) => {
      // Raigam is usually paid after the load is in stock, so posted orders are allowed
      if (!get().orders.some((o) => o.id === id)) return fail("Order not found.");
      const err = validateOrderPayment(payment);
      if (err) return fail(err);
      const clean = cleanOrderPayment(payment);
      set((s) => ({ orders: s.orders.map((o) => (o.id === id ? { ...o, ...clean } : o)) }));
      return ok(id);
    },
    setOrderInvoice: (id, invoice) => {
      // The invoice comes after the order is sent, sometimes after the load is in stock, so posted orders are allowed
      if (!get().orders.some((o) => o.id === id)) return fail("Order not found.");
      const invoiceNumber = invoice.invoiceNumber.trim();
      const poNumber = invoice.poNumber.trim();
      const dup = duplicateInvoice(get().orders, invoiceNumber, id);
      if (dup) return fail(`Invoice ${invoiceNumber} is already entered as ${dup.orderId}.`);
      set((s) => ({ orders: s.orders.map((o) => (o.id === id ? { ...o, invoiceNumber, poNumber } : o)) }));
      return ok(id);
    },
    postOrderToStock: (id, locationByLine) => {
      const { orders, orderItems, locations } = get();
      const order = orders.find((o) => o.id === id);
      if (!order) return fail("Order not found.");
      if (order.postedToStock) return fail("This order is already posted to stock.");
      if (!order.receivedDate) return fail("Enter the received date before posting to stock.");

      const lines = orderItems.filter((l) => l.orderId === order.orderId && l.receivedQty > 0);
      if (lines.length === 0) return fail("No received quantities to post.");
      for (const line of lines) {
        const loc = locationByLine[line.id];
        if (!loc || !locations.some((l) => l.locationNumber === loc))
          return fail(`Choose a store location for ${line.itemCode}.`);
      }

      const stock = receiveIntoStock(
        get().stock,
        lines.map((l) => ({ sapCode: l.itemCode, locationNumber: locationByLine[l.id], qty: l.receivedQty })),
        getToday(),
      );

      set((s) => ({
        stock,
        orders: s.orders.map((o) => (o.id === id ? { ...o, postedToStock: true } : o)),
        orderItems: s.orderItems.map((l) =>
          l.orderId === order.orderId && l.receivedQty > 0 ? { ...l, postedLocation: locationByLine[l.id] } : l,
        ),
      }));
      return ok(id);
    },
    reverseOrderPosting: (id) => {
      const { orders, orderItems } = get();
      const order = orders.find((o) => o.id === id);
      if (!order) return fail("Order not found.");
      if (!order.postedToStock) return fail("This order is not posted to stock.");

      const lines = orderItems.filter((l) => l.orderId === order.orderId && l.postedLocation && l.receivedQty > 0);
      const today = getToday();
      const stock = [...get().stock];
      for (const line of lines) {
        const idx = stock.findIndex((r) => r.sapCode === line.itemCode && r.locationNumber === line.postedLocation);
        if (idx < 0) return fail(`Stock record for ${line.itemCode} at ${line.postedLocation} no longer exists.`);
        if (stock[idx].availableQty < line.receivedQty)
          return fail(
            `Cannot reverse: only ${stock[idx].availableQty} of ${line.itemCode} left at ${line.postedLocation} (needs ${line.receivedQty}).`,
          );
        stock[idx] = { ...stock[idx], availableQty: stock[idx].availableQty - line.receivedQty, lastUpdate: today };
      }

      set((s) => ({
        stock,
        orders: s.orders.map((o) => (o.id === id ? { ...o, postedToStock: false } : o)),
        orderItems: s.orderItems.map((l) => (l.orderId === order.orderId ? { ...l, postedLocation: undefined } : l)),
      }));
      return ok(id);
    },
    receiveLoad: (input) => {
      const { orders, items, locations } = get();
      const invoiceNumber = input.invoiceNumber.trim();
      if (!invoiceNumber) return fail("Enter the invoice number.");
      const dup = duplicateInvoice(orders, invoiceNumber);
      if (dup) return fail(`Invoice ${invoiceNumber} is already entered as ${dup.orderId}.`);
      if (!input.deliveryDate) return fail("Enter the delivery date.");
      const discountPercent = round2(input.discountPercent || 0);
      const pctErr = validateDiscountPercent(discountPercent);
      if (pctErr) return fail(pctErr);
      const payment = input.payment ?? NOT_PAID;
      const payErr = validateOrderPayment(payment);
      if (payErr) return fail(payErr);
      if (input.lines.length === 0) return fail("Add at least one item.");
      const seen = new Set<string>();
      // Each line goes to the stock location set on its item
      const locationOf = new Map(items.map((i) => [i.sapCode, i.locationNumber]));
      for (const l of input.lines) {
        if (!locationOf.has(l.itemCode)) return fail(`Unknown item "${l.itemCode}".`);
        if (seen.has(l.itemCode)) return fail(`${l.itemCode} is added more than once.`);
        seen.add(l.itemCode);
        if (!Number.isInteger(l.qty) || l.qty <= 0) return fail(`Quantity for ${l.itemCode} must be a whole number above 0.`);
        const err = validatePrice(l.itemCode, l.qty, l.unitPrice, l.discount);
        if (err) return fail(err);
        if (!locations.some((x) => x.locationNumber === locationOf.get(l.itemCode)))
          return fail(`${l.itemCode} has no stock location. Set it on the item first.`);
      }

      const orderId = nextOrderId(orders);
      const lines: OrderItem[] = input.lines.map((l) => ({
        id: newId(),
        orderId,
        itemCode: l.itemCode,
        orderedQty: l.qty,
        receivedQty: l.qty,
        unitPrice: round2(l.unitPrice),
        discount: round2(l.discount),
        remarks: "",
        postedLocation: locationOf.get(l.itemCode)!,
      }));
      const order: Order = {
        id: newId(),
        orderId,
        invoiceNumber,
        poNumber: input.poNumber.trim(),
        orderDate: input.deliveryDate,
        receivedDate: input.deliveryDate,
        receivedTime: "",
        ...cleanOrderPayment(payment),
        totalBillAmount: invoiceDiscount(
          lines.reduce((sum, l) => sum + orderLineValue(l, { receivedDate: input.deliveryDate }), 0),
          discountPercent,
        ).total,
        discountPercent,
        postedToStock: true,
        territory: "",
        requiredDate: "",
      };
      const stock = receiveIntoStock(
        get().stock,
        input.lines.map((l) => ({ sapCode: l.itemCode, locationNumber: locationOf.get(l.itemCode)!, qty: l.qty })),
        getToday(),
      );
      // Cost price = net price per unit after the line and invoice discounts (free items, price 0, leave it alone)
      const netCost = new Map(
        lines
          .filter((l) => l.unitPrice > 0)
          .map((l) => [l.itemCode, netUnitCost({ qty: l.receivedQty, unitPrice: l.unitPrice, discount: l.discount }, discountPercent)]),
      );

      set((s) => ({
        orders: [...s.orders, order],
        orderItems: [...s.orderItems, ...lines],
        stock,
        items: s.items.map((i) => (netCost.has(i.sapCode) ? { ...i, costPrice: netCost.get(i.sapCode)! } : i)),
      }));
      return ok(order.id);
    },

    // ---------- Order items (individual lines) ----------
    addOrderItem: (input) => {
      const { orders, orderItems, items } = get();
      const order = orders.find((o) => o.orderId === input.orderId);
      if (!order) return fail("Select a valid order.");
      if (order.postedToStock) return fail(`${order.orderId} is posted to stock and locked.`);
      const err = validateLine(input, items);
      if (err) return fail(err);
      if (orderItems.some((l) => l.orderId === input.orderId && l.itemCode === input.itemCode))
        return fail(`${input.itemCode} is already in ${input.orderId}.`);
      const line: OrderItem = { ...cleanLine(input), orderId: input.orderId, id: newId() };
      set((s) => ({ orderItems: [...s.orderItems, line] }));
      return ok(line.id);
    },
    updateOrderItem: (id, input) => {
      const { orders, orderItems, items } = get();
      const current = orderItems.find((l) => l.id === id);
      if (!current) return fail("Order item not found.");
      const from = orders.find((o) => o.orderId === current.orderId);
      const to = orders.find((o) => o.orderId === input.orderId);
      if (!to) return fail("Select a valid order.");
      if (from?.postedToStock || to.postedToStock) return fail("Posted orders are locked. Reverse the posting first.");
      const err = validateLine(input, items);
      if (err) return fail(err);
      if (orderItems.some((l) => l.id !== id && l.orderId === input.orderId && l.itemCode === input.itemCode))
        return fail(`${input.itemCode} is already in ${input.orderId}.`);
      set((s) => ({
        orderItems: s.orderItems.map((l) => (l.id === id ? { ...l, ...cleanLine(input), orderId: input.orderId } : l)),
      }));
      return ok(id);
    },
    deleteOrderItem: (id) => {
      const { orders, orderItems } = get();
      const line = orderItems.find((l) => l.id === id);
      if (!line) return fail("Order item not found.");
      if (orders.find((o) => o.orderId === line.orderId)?.postedToStock)
        return fail(`${line.orderId} is posted to stock and locked.`);
      if (orderItems.filter((l) => l.orderId === line.orderId).length === 1)
        return fail(`This is the only item in ${line.orderId}. Delete the order instead.`);
      set((s) => ({ orderItems: s.orderItems.filter((l) => l.id !== id) }));
      return ok();
    },

    // ---------- Routes ----------
    addRoute: (input) => {
      const routeCode = input.routeCode.trim().toUpperCase();
      if (!routeCode || !input.routeName.trim()) return fail("Route number and name are required.");
      if (get().routes.some((r) => r.routeCode === routeCode)) return fail(`Route ${routeCode} already exists.`);
      const route: Route = { ...input, routeCode, routeName: input.routeName.trim(), id: newId() };
      set((s) => ({ routes: [...s.routes, route] }));
      return ok(route.id);
    },
    updateRoute: (id, input) => {
      const routeCode = input.routeCode.trim().toUpperCase();
      if (!routeCode || !input.routeName.trim()) return fail("Route number and name are required.");
      if (get().routes.some((r) => r.id !== id && r.routeCode === routeCode)) return fail(`Route ${routeCode} already exists.`);
      set((s) => ({
        routes: s.routes.map((r) => (r.id === id ? { ...r, ...input, routeCode, routeName: input.routeName.trim() } : r)),
      }));
      return ok(id);
    },
    deleteRoute: (id) => {
      const route = get().routes.find((r) => r.id === id);
      if (!route) return fail("Route not found.");
      const count = get().shops.filter((s) => s.routeId === id).length;
      if (count) return fail(`${route.routeCode} has ${count} store${count > 1 ? "s" : ""}. Move them to another route first.`);
      set((s) => ({ routes: s.routes.filter((r) => r.id !== id) }));
      return ok();
    },

    // ---------- Stores (shops) ----------
    addShop: (input) => {
      const err = validateShop(input, get().shops, get().routes);
      if (err) return fail(err);
      const shop: Shop = { ...cleanShop(input), id: newId() };
      set((s) => ({ shops: [...s.shops, shop] }));
      return ok(shop.id);
    },
    updateShop: (id, input) => {
      const err = validateShop(input, get().shops, get().routes, id);
      if (err) return fail(err);
      set((s) => {
        const shops = s.shops.map((x) => (x.id === id ? { ...x, ...cleanShop(input) } : x));
        // Opening balance may have dropped below what payments already cover
        return { shops, payments: normalizeAllocations(shops, s.sales, s.payments) };
      });
      return ok(id);
    },
    deleteShop: (id) => {
      const { shops, sales, payments } = get();
      const shop = shops.find((s) => s.id === id);
      if (!shop) return fail("Store not found.");
      if (sales.some((s) => s.shopId === id) || payments.some((p) => p.shopId === id))
        return fail(`${shop.shopName} has sales or payments. Mark it inactive instead.`);
      set((s) => ({ shops: s.shops.filter((x) => x.id !== id) }));
      return ok();
    },

    // ---------- Sales ----------
    createSale: (input, billPayments = []) => {
      const { items, shops, sales, payments } = get();
      // Cash is collected on delivery (as a payment), not when the rep writes the bill
      const err = validateSale(input, items, shops, sales);
      if (err) return fail(err);
      const cleaned = cleanSale(input, items);
      if (saleSubtotal(cleaned) < -0.004) return fail("The returns on this bill are worth more than its items.");
      const sale: Sale = {
        ...cleaned,
        id: newId(),
        saleNo: nextCode(sales.map((s) => s.saleNo), "SI", 4),
        status: "Ordered",
        late: false,
        checked: false,
        deliveryNote: "",
        extraCredit: 0,
        loadedDate: "",
        vehicleNumber: "",
        deliveredDate: "",
      };
      // Money paid with the order: receipts linked to the new bill, checked like any payment
      const nextSales = [...sales, sale];
      let nextPayments = payments;
      for (const bp of billPayments) {
        const paymentInput: PaymentInput = { ...bp, shopId: sale.shopId, allocations: [{ saleId: sale.id, amount: bp.amount }] };
        const payErr = validatePayment(paymentInput, shops, nextSales, nextPayments);
        if (payErr) return fail(payErr);
        nextPayments = [
          ...nextPayments,
          { ...cleanPayment(paymentInput), id: newId(), receiptNo: nextCode(nextPayments.map((p) => p.receiptNo), "RC", 4) },
        ];
      }
      set({ sales: nextSales, payments: nextPayments });
      return ok(sale.id);
    },
    updateSale: (id, input) => {
      const { items, shops, sales, stock, raigamReturns } = get();
      const existing = sales.find((s) => s.id === id);
      if (!existing) return fail("Order not found.");
      if (existing.status === "Cancelled") return fail(`${existing.saleNo} is cancelled. Restore it before editing.`);
      const err = validateSale(input, items, shops, sales, existing);
      if (err) return fail(err);
      const cleaned = cleanSale(input, items, existing);
      if (saleSubtotal(cleaned) < -0.004) return fail("The returns on this bill would be worth more than its items.");

      // Once loaded, the items are out of stock: swap old quantities for new ones
      let nextStock = stock;
      if (stockIsOut(existing)) {
        const today = getToday();
        const newOut = existing.status === "Delivered" ? deliveredMoves(cleaned.lines) : loadMoves(cleaned.lines);
        const taken = takeFromStock(returnToStock(stock, outMoves(existing), today), newOut, today);
        if ("error" in taken) return fail(taken.error);
        nextStock = taken.stock;
      }
      const nextSales = sales.map((x) =>
        x.id === id
          ? {
              ...cleaned,
              id,
              saleNo: existing.saleNo,
              status: existing.status,
              late: existing.late,
              checked: existing.checked,
              deliveryNote: existing.deliveryNote,
              extraCredit: existing.extraCredit,
              loadedDate: existing.loadedDate,
              vehicleNumber: existing.vehicleNumber,
              deliveredDate: existing.deliveredDate,
            }
          : x,
      );
      // A delivered bill's returns can't drop below what was already sent to Raigam
      const sentErr = sentMoreThanCollected(nextSales, raigamReturns);
      if (sentErr) return fail(`Can't change the returns: ${sentErr}`);
      // A smaller total or a different store can leave linked payments over the bill
      set((s) => ({ sales: nextSales, stock: nextStock, payments: normalizeAllocations(s.shops, nextSales, s.payments) }));
      return ok(id);
    },
    deleteSale: (id) => {
      const { sales, raigamReturns } = get();
      const sale = sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      const nextSales = sales.filter((x) => x.id !== id);
      const sentErr = sentMoreThanCollected(nextSales, raigamReturns);
      if (sentErr) return fail(`Can't delete ${sale.saleNo}: ${sentErr}`);
      set((s) => ({
        // Goods out with the bill come back into stock
        stock: returnToStock(s.stock, outMoves(sale), getToday()),
        sales: nextSales,
        // Payments linked to this order become unlinked credit for the store
        payments: normalizeAllocations(s.shops, nextSales, s.payments),
      }));
      return ok();
    },
    saveBillItem: (saleId, lineId, input) => {
      const data = get();
      const sale = data.sales.find((s) => s.id === saleId);
      if (!sale) return fail("Order not found.");
      const line = lineId ? sale.lines.find((l) => l.id === lineId) : undefined;
      if (lineId && !line) return fail(`That item isn't on ${sale.saleNo} any more. Reload the page.`);
      // Missing items are marked before delivery; at delivery the store's cancelled qty is used instead
      if (sale.status === "Delivered" && input.missingQty !== (line?.missingQty ?? 0))
        return fail(`${sale.saleNo} is delivered. Undo the delivery to reduce or remove items.`);
      const { otherFree, ...fields } = input;
      let lines: SaleLineInput[];
      if (line) {
        const edited = { ...lineInputOf(line), ...fields, sapCode: line.sapCode, takenOff: fields.takenOff ?? line.takenOff };
        lines = sale.lines.map((l) => (l.id === line.id ? edited : lineInputOf(l)));
      } else {
        // A new item (sold, or a free issue item), from the item's own stock location
        if (!data.items.some((i) => i.sapCode === input.sapCode)) return fail("Pick the item.");
        if (sale.lines.some((l) => l.sapCode === input.sapCode)) return fail(`${input.sapCode} is already on ${sale.saleNo}. Change it on its own row.`);
        const locationNumber = stockLocationFor(input.sapCode, data);
        if (!locationNumber) return fail(`${input.sapCode} has no stock location yet. Set it on the Items page.`);
        lines = [...sale.lines.map(lineInputOf), { ...fields, locationNumber, takenOff: 0 }];
      }

      // Free issue of another item given with this one: replaces the one linked to it before (null = none)
      const mainCode = line?.sapCode ?? fields.sapCode;
      if (otherFree !== undefined && (line || fields.qty > 0)) {
        const linked = line ? sale.lines.find((l) => l.freeWith === mainCode && l.id !== line.id) : undefined;
        if (linked) lines = lines.filter((l) => l.sapCode !== linked.sapCode);
        if (otherFree) {
          const freeItem = data.items.find((i) => i.sapCode === otherFree.sapCode);
          if (!freeItem) return fail("Pick the other free issue item.");
          if (otherFree.sapCode === mainCode) return fail("For the same item, use its Free Issue box. Pick another item here.");
          if (!Number.isInteger(otherFree.freeQty) || otherFree.freeQty <= 0) return fail(`Free qty for ${freeItem.description} must be a whole number above 0.`);
          if (lines.some((l) => l.sapCode === otherFree.sapCode))
            return fail(`${freeItem.description} is already on ${sale.saleNo}. Give its free issue on its own row.`);
          const same = linked?.sapCode === otherFree.sapCode ? linked : undefined;
          const locationNumber = same?.locationNumber ?? stockLocationFor(otherFree.sapCode, data);
          if (!locationNumber) return fail(`${freeItem.description} has no stock location yet. Set it on the Items page.`);
          lines.push({
            sapCode: otherFree.sapCode,
            locationNumber,
            qty: 0,
            freeQty: otherFree.freeQty,
            takenOff: 0,
            // Valued at the wholesale price (what Raigam pays back), unless it was on the bill at another price
            unitPrice: same?.unitPrice ?? freeItem.wholesalePrice,
            discountPct: 0,
            freeWith: mainCode,
          });
        }
      }
      return data.updateSale(saleId, saleInputOf(sale, lines));
    },
    removeBillItem: (saleId, lineId) => {
      const { sales, updateSale } = get();
      const sale = sales.find((s) => s.id === saleId);
      if (!sale) return fail("Order not found.");
      const line = sale.lines.find((l) => l.id === lineId);
      if (!line) return fail(`That item isn't on ${sale.saleNo} any more. Reload the page.`);
      // A free issue item given with it goes too
      const kept = sale.lines.filter((l) => l.id !== lineId && l.freeWith !== line.sapCode);
      if (kept.length === 0) return fail(`It's the only item on ${sale.saleNo}. Delete the bill instead.`);
      return updateSale(saleId, saleInputOf(sale, kept.map(lineInputOf)));
    },
    saveBillReturn: (saleId, returnId, input) => {
      const { sales, updateSale } = get();
      const sale = sales.find((s) => s.id === saleId);
      if (!sale) return fail("Order not found.");
      if (returnId && !sale.returns.some((r) => r.id === returnId)) return fail(`That return isn't on ${sale.saleNo} any more. Reload the page.`);
      const returns = returnId
        ? sale.returns.map((r) => (r.id === returnId ? input : returnInputOf(r)))
        : [...sale.returns.map(returnInputOf), input];
      return updateSale(saleId, saleInputOf(sale, sale.lines.map(lineInputOf), returns));
    },
    removeBillReturn: (saleId, returnId) => {
      const { sales, updateSale } = get();
      const sale = sales.find((s) => s.id === saleId);
      if (!sale) return fail("Order not found.");
      if (!sale.returns.some((r) => r.id === returnId)) return fail(`That return isn't on ${sale.saleNo} any more. Reload the page.`);
      return updateSale(saleId, saleInputOf(sale, sale.lines.map(lineInputOf), sale.returns.filter((r) => r.id !== returnId).map(returnInputOf)));
    },
    loadSales: (ids, input) => {
      const { sales, stock, shops, payments } = get();
      if (ids.length === 0) return fail("Select at least one bill to load.");
      if (!input.date) return fail("Enter the loading date.");
      const toLoad = sales.filter((s) => ids.includes(s.id));
      const notReady = toLoad.find((s) => s.status !== "Ordered");
      if (notReady) return fail(notReady.status === "Cancelled" ? `${notReady.saleNo} is cancelled.` : `${notReady.saleNo} is already loaded.`);
      // Items not in the store: not loaded, and they come off the bill (lines left out keep what the bill has)
      const missing = input.missing ?? {};
      const onBills = new Set(toLoad.flatMap((s) => s.lines.map((l) => l.id)));
      if (Object.keys(missing).some((lineId) => !onBills.has(lineId))) return fail("One of the reduced items isn't on the bills being loaded.");
      for (const sale of toLoad) {
        const err = validateMissing(sale, Object.fromEntries(Object.entries(missing).filter(([lineId]) => sale.lines.some((l) => l.id === lineId))));
        if (err) return fail(err);
      }
      // All or nothing: every bill must fit in the stock that's left
      const loaded = new Map(toLoad.map((s) => [s.id, withMissing(s, missing)]));
      let nextStock = stock;
      for (const sale of loaded.values()) {
        const taken = takeFromStock(nextStock, loadMoves(sale.lines), input.date);
        if ("error" in taken) return fail(`${sale.saleNo}: ${taken.error}`);
        nextStock = taken.stock;
      }
      const vehicleNumber = input.vehicleNumber.trim().toUpperCase();
      const nextSales = sales.map((x) => {
        const sale = loaded.get(x.id);
        return sale ? { ...sale, status: "Loaded" as const, loadedDate: input.date, vehicleNumber } : x;
      });
      // A bill made smaller by missing items can leave money paid in advance over it: that stays with the store as an advance
      set({ stock: nextStock, sales: nextSales, payments: normalizeAllocations(shops, nextSales, payments) });
      return ok();
    },
    unloadSale: (id) => {
      const sale = get().sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      if (sale.status !== "Loaded") return fail(`${sale.saleNo} is not on a lorry.`);
      set((s) => ({
        stock: returnToStock(s.stock, loadMoves(sale.lines), getToday()),
        sales: s.sales.map((x) => (x.id === id ? { ...x, status: "Ordered" as const, loadedDate: "", vehicleNumber: "" } : x)),
      }));
      return ok(id);
    },
    markMissing: (id, missing) => {
      const { sales, stock, shops, payments } = get();
      const sale = sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      if (sale.status === "Cancelled") return fail(`${sale.saleNo} is cancelled.`);
      if (sale.status === "Delivered")
        return fail(`${sale.saleNo} is delivered. Undo the delivery to reduce or remove items (or cancel items when delivering).`);
      const err = validateMissing(sale, missing);
      if (err) return fail(err);
      const next = withMissing(sale, missing);
      // On the lorry already: units now missing go back into stock, units found again come out of it
      let nextStock = stock;
      if (sale.status === "Loaded") {
        const today = getToday();
        const taken = takeFromStock(returnToStock(stock, loadMoves(sale.lines), today), loadMoves(next.lines), today);
        if ("error" in taken) return fail(taken.error);
        nextStock = taken.stock;
      }
      const nextSales = sales.map((x) => (x.id === id ? next : x));
      // A smaller bill can leave money paid in advance over it: that stays with the store as an advance
      set({ stock: nextStock, sales: nextSales, payments: normalizeAllocations(shops, nextSales, payments) });
      return ok(id);
    },
    deliverSale: (id, input) => {
      const { sales, stock, shops, payments, items } = get();
      const sale = sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      if (sale.status === "Delivered") return fail(`${sale.saleNo} is already delivered.`);
      if (sale.status === "Cancelled") return fail(`${sale.saleNo} is cancelled. Restore it first.`);
      if (!input.date) return fail("Enter the delivery date.");
      if (!input.dueDate || input.dueDate < input.date) return fail("The end date for collecting must be on or after the delivery date.");
      // Not loaded yet? Delivering straight from the store takes the stock now.
      // The goods already reached the store, so stock that's short in the app doesn't stop it.
      let nextStock = stock;
      if (sale.status === "Ordered") nextStock = takeWhatIsThere(stock, loadMoves(sale.lines), input.date);

      // At the store: what it didn't take (cancelled) and goods it gave back (returns)
      const cancels = input.cancels ?? {};
      for (const [lineId, qty] of Object.entries(cancels)) {
        const line = sale.lines.find((l) => l.id === lineId);
        if (!line) return fail("One of the cancelled items isn't on this bill.");
        // Units missing at loading never reached the store
        const delivered = line.qty - missingSold(line);
        if (!Number.isInteger(qty) || qty < 0 || qty > delivered)
          return fail(`Cancelled qty for ${line.sapCode} must be a whole number from 0 to ${delivered}.`);
      }
      // The return items entered with the bill, as checked at the store (left out = keep them).
      // From now on they're held for Raigam in the return items store, not stock.
      const returnsIn = input.returns ?? sale.returns;
      const returnsErr = validateReturns(returnsIn, items);
      if (returnsErr) return fail(returnsErr);
      const lines = sale.lines.map((l) => ({ ...l, cancelQty: cancels[l.id] ?? 0 }));
      const returns = cleanReturns(returnsIn, items, sale.returns);
      const gross = saleSubtotal({ lines, returns });
      if (gross < -0.004) return fail("The returns are worth more than the items on this bill.");
      nextStock = returnToStock(nextStock, cancelMoves(lines), input.date);
      // Credit added on this bill (left out = keep what it had)
      const extraCredit = round2(input.extraCredit ?? sale.extraCredit);
      if (!Number.isFinite(extraCredit) || extraCredit < 0) return fail("Credit amount must be 0 or more.");

      const nextSales = sales.map((x) =>
        x.id === id
          ? {
              ...x,
              lines,
              returns,
              discount: billDiscount(gross, x.discountPercent),
              status: "Delivered" as const,
              loadedDate: x.loadedDate || input.date,
              deliveredDate: input.date,
              dueDate: input.dueDate,
              deliveryNote: input.note === undefined ? x.deliveryNote : input.note.trim(),
              extraCredit,
            }
          : x,
      );
      // Each payment collected at the door is a receipt linked to the bills it pays (this one and/or older ones).
      // Checked one after the other, so together they can't pay a bill more than it owes.
      const collections = Array.isArray(input.collections) ? input.collections : input.collection ? [input.collection] : [];
      let withReceipts = payments;
      let firstReceipt = "";
      for (const [i, collection] of collections.entries()) {
        if (!(collection?.amount > 0)) continue;
        const paymentInput: PaymentInput = { ...collection, shopId: sale.shopId, date: input.date };
        const err = validatePayment(paymentInput, shops, nextSales, withReceipts);
        if (err) return fail(collections.length > 1 ? `Payment ${i + 1}: ${err}` : err);
        const receipt: Payment = { ...cleanPayment(paymentInput), id: newId(), receiptNo: nextCode(withReceipts.map((p) => p.receiptNo), "RC", 4) };
        withReceipts = [...withReceipts, receipt];
        firstReceipt ||= receipt.id;
      }
      // Returns can make the bill smaller than what was paid in advance: the extra stays with the store as an advance
      set({ stock: nextStock, sales: nextSales, payments: normalizeAllocations(shops, nextSales, withReceipts) });
      return ok(firstReceipt || id);
    },
    undoDelivery: (id) => {
      const { sales, stock, raigamReturns } = get();
      const sale = sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      if (sale.status !== "Delivered") return fail(`${sale.saleNo} is not delivered.`);
      // The delivery didn't happen: cancelled goods go back on the lorry, and the return items
      // stay on the bill to collect at the next delivery (so they leave the return items store)
      const taken = takeFromStock(stock, cancelMoves(sale.lines), getToday());
      if ("error" in taken) return fail(`Can't undo: ${taken.error}`);
      const lines = sale.lines.map((l) => ({ ...l, cancelQty: 0 }));
      // Back on the lorry: stock stays out until it is unloaded
      const nextSales = sales.map((x) =>
        x.id === id
          ? {
              ...x,
              lines,
              discount: billDiscount(saleSubtotal({ lines, returns: x.returns }), x.discountPercent),
              status: "Loaded" as const,
              deliveredDate: "",
            }
          : x,
      );
      const sentErr = sentMoreThanCollected(nextSales, raigamReturns);
      if (sentErr) return fail(`Can't undo: ${sentErr}`);
      set((s) => ({
        stock: taken.stock,
        sales: nextSales,
        // Payments stay on the bill (any part over its total becomes the store's advance)
        payments: normalizeAllocations(s.shops, nextSales, s.payments),
      }));
      return ok(id);
    },
    markLate: (id) => {
      const sale = get().sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      if (sale.status === "Delivered") return fail(`${sale.saleNo} is already delivered.`);
      if (sale.status === "Cancelled") return fail(`${sale.saleNo} is cancelled.`);
      set((s) => ({
        // Off the lorry and back in the warehouse until it is loaded again
        stock: sale.status === "Loaded" ? returnToStock(s.stock, loadMoves(sale.lines), getToday()) : s.stock,
        sales: s.sales.map((x) => (x.id === id ? { ...x, status: "Ordered" as const, late: true, loadedDate: "", vehicleNumber: "" } : x)),
      }));
      return ok(id);
    },
    cancelSale: (id) => {
      const sale = get().sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      if (sale.status === "Delivered") return fail(`${sale.saleNo} is delivered. Undo the delivery before cancelling.`);
      if (sale.status === "Cancelled") return fail(`${sale.saleNo} is already cancelled.`);
      set((s) => ({
        stock: sale.status === "Loaded" ? returnToStock(s.stock, loadMoves(sale.lines), getToday()) : s.stock,
        sales: s.sales.map((x) => (x.id === id ? { ...x, status: "Cancelled" as const, loadedDate: "", vehicleNumber: "" } : x)),
      }));
      // Payments on a cancelled bill stay with the store as an advance
      set((s) => ({ payments: normalizeAllocations(s.shops, s.sales, s.payments) }));
      return ok(id);
    },
    restoreSale: (id) => {
      const sale = get().sales.find((s) => s.id === id);
      if (!sale) return fail("Order not found.");
      if (sale.status !== "Cancelled") return fail(`${sale.saleNo} is not cancelled.`);
      set((s) => ({ sales: s.sales.map((x) => (x.id === id ? { ...x, status: "Ordered" as const } : x)) }));
      return ok(id);
    },
    markChecked: (ids, checked) => {
      if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one bill.");
      const marking = new Set(ids);
      const bills = get().sales.filter((s) => marking.has(s.id));
      if (bills.length !== marking.size) return fail("One of the bills wasn't found. Refresh and try again.");
      const noInvoice = bills.find((s) => !s.invoiceNo);
      if (noInvoice) return fail(`${noInvoice.saleNo} has no Raigam invoice number to check it against.`);
      set((s) => ({ sales: s.sales.map((x) => (marking.has(x.id) ? { ...x, checked: checked === true } : x)) }));
      return ok();
    },

    // ---------- Payments ----------
    addPayment: (input) => {
      const { shops, sales, payments } = get();
      const err = validatePayment(input, shops, sales, payments);
      if (err) return fail(err);
      const payment: Payment = {
        ...cleanPayment(input),
        id: newId(),
        receiptNo: nextCode(get().payments.map((p) => p.receiptNo), "RC", 4),
      };
      set((s) => ({ payments: [...s.payments, payment] }));
      return ok(payment.id);
    },
    updatePayment: (id, input) => {
      const { shops, sales, payments } = get();
      const err = validatePayment(input, shops, sales, payments, id);
      if (err) return fail(err);
      set((s) => ({ payments: s.payments.map((p) => (p.id === id ? { ...p, ...cleanPayment(input) } : p)) }));
      return ok(id);
    },
    deletePayment: (id) => {
      set((s) => ({ payments: s.payments.filter((p) => p.id !== id) }));
      return ok();
    },
    linkPayments: (shopId) => {
      const { shops, sales, payments } = get();
      const shop = shops.find((s) => s.id === shopId);
      if (!shop) return fail("Store not found.");
      const next = linkUnlinkedPayments(shop, sales, payments);
      if (next === payments) return fail("There are no open bills to link these payments to.");
      set({ payments: next });
      return ok(shopId);
    },
    markChequeCollected: (id, date) => {
      const payment = get().payments.find((p) => p.id === id);
      if (!payment) return fail("Payment not found.");
      if (payment.method !== "Cheque") return fail(`${payment.receiptNo} isn't a cheque.`);
      if (date !== "" && !isISODate(date)) return fail("Enter the date the cheque was collected.");
      // Collected, it now pays its bills (any part over what's left becomes the store's advance)
      set((s) => {
        const payments = s.payments.map((p) => (p.id === id ? { ...p, chequeCollectedDate: date } : p));
        return { payments: normalizeAllocations(s.shops, s.sales, payments) };
      });
      return ok(id);
    },

    // ---------- Expenses ----------
    addExpense: (input) => {
      const err = validateExpense(input);
      if (err) return fail(err);
      const expense: Expense = {
        ...cleanExpense(input),
        id: newId(),
        expenseNo: nextCode(get().expenses.map((e) => e.expenseNo), "EX", 4),
      };
      set((s) => ({ expenses: [...s.expenses, expense] }));
      return ok(expense.id);
    },
    updateExpense: (id, input) => {
      const err = validateExpense(input);
      if (err) return fail(err);
      set((s) => ({ expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...cleanExpense(input) } : e)) }));
      return ok(id);
    },
    deleteExpense: (id) => {
      set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }));
      return ok();
    },

    // ---------- Return items sent back to Raigam ----------
    sendReturnsToRaigam: (input) => {
      const { items, sales, raigamReturns } = get();
      if (!input.date) return fail("Enter the date they were sent.");
      const lines = input.lines.filter((l) => l.qty !== 0);
      if (lines.length === 0) return fail("Enter how many of each item you're sending.");
      const store = returnStock(sales, raigamReturns);
      const seen = new Set<string>();
      for (const l of lines) {
        if (!RETURN_KINDS.includes(l.kind)) return fail("Choose Good or Market for each line.");
        if (!items.some((i) => i.sapCode === l.sapCode)) return fail(`Unknown item "${l.sapCode}".`);
        if (!Number.isInteger(l.qty) || l.qty < 0) return fail(`Qty for ${l.sapCode} must be a whole number.`);
        const key = returnKey(l.kind, l.sapCode);
        if (seen.has(key)) return fail(`${l.sapCode} is on the list twice as a ${l.kind.toLowerCase()} return.`);
        seen.add(key);
        const held = store.get(key)?.held ?? 0;
        const kind = `${l.kind.toLowerCase()} return${held === 1 ? "" : "s"}`;
        if (l.qty > held) return fail(held ? `Only ${held} ${kind} of ${l.sapCode} in Return Items.` : `No ${kind} of ${l.sapCode} in Return Items.`);
      }
      const note: RaigamReturn = {
        id: newId(),
        returnNo: nextCode(raigamReturns.map((r) => r.returnNo), "RN", 4),
        date: input.date,
        reference: input.reference.trim(),
        notes: input.notes.trim(),
        lines: lines.map((l) => ({ kind: l.kind, sapCode: l.sapCode, qty: l.qty })),
      };
      set((s) => ({ raigamReturns: [...s.raigamReturns, note] }));
      return ok(note.id);
    },
    deleteRaigamReturn: (id) => {
      if (!get().raigamReturns.some((r) => r.id === id)) return fail("Return note not found.");
      // Its items are back in the return items store, waiting to be sent
      set((s) => ({ raigamReturns: s.raigamReturns.filter((r) => r.id !== id) }));
      return ok();
    },

    // ---------- Sync from Raigam ----------
    syncRaigamBills: (bills, itemPicks) => {
      if (!Array.isArray(bills) || !itemPicks || typeof itemPicks !== "object") return fail("Nothing to sync.");
      const notes: string[] = [];
      const valid = bills.filter(isRaigamBill);
      if (valid.length < bills.length) notes.push(`${bills.length - valid.length} bill(s) from Raigam couldn't be read.`);

      // Item matches picked in the sync dialog are remembered (a new pick replaces the old match)
      const codes = new Set(get().items.map((i) => i.sapCode));
      let links = get().raigamLinks;
      for (const [raigamId, sapCode] of Object.entries(itemPicks)) {
        if (Number.isInteger(Number(raigamId)) && codes.has(sapCode)) links = putLink(links, "Item", Number(raigamId), sapCode);
      }
      set({ raigamLinks: links });

      const plan = planRaigamSync(get(), valid, {});
      const saving = plan.rows.filter((r) => r.action === "add" || r.action === "update");

      // Stores: links learned from bills already here or the same name; new outlets get a store
      // (and route) with just the name, but only if a bill is going on it
      const wanted = new Set(saving.map((r) => r.bill.outletId));
      const shopOf = new Map<number, string>();
      const routeAdded = new Map<number, string>();
      for (const [outletId, ref] of plan.stores) {
        if (!("name" in ref)) {
          if (ref.learnt) links = putLink(links, "Store", outletId, ref.shopId);
          shopOf.set(outletId, ref.shopId);
          continue;
        }
        if (!wanted.has(outletId)) continue;
        let routeId = ref.routeId || routeAdded.get(ref.raigamRouteId) || "";
        if (!routeId) {
          const route = get().addRoute({
            routeCode: nextCode(get().routes.map((r) => r.routeCode), "RT", 3),
            routeName: ref.routeName || "Raigam route",
            area: "",
            visitDays: [],
            salesRep: "",
            vehicleNumber: "",
            active: true,
          });
          if (!route.ok) {
            notes.push(`${ref.name}: ${route.error}`);
            continue;
          }
          routeId = route.id!;
          routeAdded.set(ref.raigamRouteId, routeId);
          links = putLink(links, "Route", ref.raigamRouteId, routeId);
        }
        const shop = get().addShop({
          shopCode: nextCode(get().shops.map((s) => s.shopCode), "ST", 4),
          shopName: ref.name,
          ownerName: "",
          phone: "",
          address: "",
          town: "",
          mapLink: "",
          routeId,
          creditLimit: 0,
          creditDays: NEW_STORE_CREDIT_DAYS,
          openingBalance: 0,
          active: true,
          notes: "",
        });
        if (!shop.ok) {
          notes.push(`${ref.name}: ${shop.error}`);
          continue;
        }
        shopOf.set(outletId, shop.id!);
        links = putLink(links, "Store", outletId, shop.id!);
      }
      set({ raigamLinks: links });

      // Bills, through the same actions (and checks) as by hand.
      // A bill whose contents changed on Raigam has to be checked against its new printout again.
      const recheck = new Set<string>();
      for (const row of saving) {
        const no = row.bill.invoiceNo;
        const done = (r: Result) => {
          if (!r.ok) notes.push(`${no}: ${r.error}`);
          return r.ok;
        };
        if (row.cancel) {
          done(get().cancelSale(row.sale!.id));
          continue;
        }
        let id = row.sale?.id;
        if (row.input) {
          const shopId = shopOf.get(row.bill.outletId);
          if (!shopId) {
            notes.push(`${no}: its store couldn't be added.`);
            continue;
          }
          const input = { ...row.input, shopId };
          const r = id ? get().updateSale(id, input) : get().createSale(input);
          if (!done(r)) continue;
          if (id) recheck.add(id);
          id = r.ok ? r.id : id;
        }
        if (row.late && id) done(get().markLate(id));
      }
      if (recheck.size) set((s) => ({ sales: s.sales.map((x) => (recheck.has(x.id) ? { ...x, checked: false } : x)) }));
      return { ok: true, notes };
    },


    resetDemoData: () => {
      set(seedData());
      return ok();
    },
  });
