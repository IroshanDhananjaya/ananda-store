import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, integer, numeric, pgPolicy, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import { anonRole, authenticatedRole } from "drizzle-orm/supabase";

// Postgres tables for the app's data (see src/lib/types.ts).
// - Column names are snake_case in the database (drizzle `casing` option).
// - Money is numeric(12,2); quantities are whole numbers.
// - Empty dates in the app are NULL here; repo.ts converts both ways.
// - `seq` keeps rows in the order they were added, like the old localStorage arrays.
// - RLS is on, and each table's policy gives Supabase's public API (anon and
//   logged-in browser users) no rows. Only the server's Postgres connection, which
//   owns the tables, can read and write them.

const money = () => numeric({ precision: 12, scale: 2, mode: "number" });
const seq = () => bigint({ mode: "number" }).generatedAlwaysAsIdentity();
const noApiAccess = () =>
  pgPolicy("no_api_access", { for: "all", to: [anonRole, authenticatedRole], using: sql`false`, withCheck: sql`false` });

export const items = pgTable("items", {
  id: text().primaryKey(),
  seq: seq(),
  sapCode: text().notNull().unique(),
  description: text().notNull(),
  packageDetails: text().notNull().default(""),
  uom: text().notNull(),
  costPrice: money().notNull(),
  wholesalePrice: money().notNull(),
  retailPrice: money().notNull(),
  // Where new loads of the item go; "" = not set yet. No foreign key: deleting a location in use is blocked in core.ts
  locationNumber: text().notNull().default(""),
  /** Section on Raigam's goods order sheet (e.g. BLUE PACK SOYA); "" = not on the sheet */
  sheetSection: text().notNull().default(""),
  /** SN on Raigam's goods order sheet; 0 = none */
  sheetNo: integer().notNull().default(0),
}, () => [noApiAccess()]).enableRLS();

export const locations = pgTable("locations", {
  id: text().primaryKey(),
  seq: seq(),
  locationNumber: text().notNull().unique(),
  itemGroup: text().notNull(),
}, () => [noApiAccess()]).enableRLS();

export const stock = pgTable(
  "stock",
  {
    id: text().primaryKey(),
    seq: seq(),
    sapCode: text().notNull().references(() => items.sapCode),
    // No foreign key: a sale returned to stock can re-create a record at a location that was removed
    locationNumber: text().notNull(),
    availableQty: integer().notNull(),
    issuedQty: integer().notNull(),
    lastUpdate: date({ mode: "string" }),
  },
  (t) => [
    unique().on(t.sapCode, t.locationNumber),
    check("stock_qty_not_negative", sql`${t.availableQty} >= 0 and ${t.issuedQty} >= 0`),
    noApiAccess(),
  ],
).enableRLS();

export const orders = pgTable("orders", {
  id: text().primaryKey(),
  seq: seq(),
  orderId: text().notNull().unique(),
  orderDate: date({ mode: "string" }).notNull(),
  receivedDate: date({ mode: "string" }),
  receivedTime: text(),
  /** Cash, Cheque or Bank Transfer; "" = not paid yet */
  paymentMethod: text().notNull().default(""),
  paidDate: date({ mode: "string" }),
  chequeNumber: text().notNull().default(""),
  chequeDepositDate: date({ mode: "string" }),
  paymentReference: text().notNull().default(""),
  totalBillAmount: money().notNull(),
  /** True once every received item is in stock */
  postedToStock: boolean().notNull().default(false),
  /** Raigam territory written on the goods order sheet */
  territory: text().notNull().default(""),
  /** Order sheet's "Required Date": when the goods are needed */
  requiredDate: date({ mode: "string" }),
}, () => [noApiAccess()]).enableRLS();

/** A Raigam invoice an order's goods came on: one order can come on several, each with its own discount */
export const orderInvoices = pgTable("order_invoices", {
  id: text().primaryKey(),
  seq: seq(),
  orderId: text()
    .notNull()
    .references(() => orders.orderId, { onDelete: "cascade" }),
  invoiceNumber: text().notNull().default(""),
  /** Raigam's purchase order number on the invoice */
  poNumber: text().notNull().default(""),
  /** The Raigam company that billed it, e.g. Raigam Wayamba Salterns PLC */
  company: text().notNull().default(""),
  invoiceDate: date({ mode: "string" }),
  /** Raigam's "Discount % for Total Invoice", taken off this invoice's lines total (0 = none) */
  discountPercent: numeric({ precision: 5, scale: 2, mode: "number" }).notNull().default(0),
}, () => [noApiAccess()]).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: text().primaryKey(),
    seq: seq(),
    orderId: text()
      .notNull()
      .references(() => orders.orderId, { onDelete: "cascade" }),
    itemCode: text()
      .notNull()
      .references(() => items.sapCode),
    orderedQty: integer().notNull(),
    /** The invoice it came on; NULL = on no invoice (not supplied) */
    invoiceId: text().references(() => orderInvoices.id, { onDelete: "set null" }),
    /** Qty on that invoice: what Raigam charges for */
    invoicedQty: integer().notNull().default(0),
    receivedQty: integer().notNull(),
    /** Price per unit on the supplier invoice */
    unitPrice: money().notNull().default(0),
    /** Rs. off the whole line */
    discount: money().notNull().default(0),
    remarks: text().notNull().default(""),
    postedLocation: text(),
  },
  (t) => [unique().on(t.orderId, t.itemCode), noApiAccess()],
).enableRLS();

export const routes = pgTable("routes", {
  id: text().primaryKey(),
  seq: seq(),
  routeCode: text().notNull().unique(),
  routeName: text().notNull(),
  area: text().notNull().default(""),
  visitDays: text().array().notNull().default(sql`'{}'::text[]`),
  salesRep: text().notNull().default(""),
  vehicleNumber: text().notNull().default(""),
  active: boolean().notNull().default(true),
}, () => [noApiAccess()]).enableRLS();

export const shops = pgTable("shops", {
  id: text().primaryKey(),
  seq: seq(),
  shopCode: text().notNull().unique(),
  shopName: text().notNull(),
  ownerName: text().notNull().default(""),
  phone: text().notNull().default(""),
  address: text().notNull().default(""),
  town: text().notNull().default(""),
  mapLink: text().notNull().default(""),
  routeId: text()
    .notNull()
    .references(() => routes.id),
  creditLimit: money().notNull(),
  creditDays: integer().notNull(),
  openingBalance: money().notNull(),
  active: boolean().notNull().default(true),
  notes: text().notNull().default(""),
}, () => [noApiAccess()]).enableRLS();

export const sales = pgTable(
  "sales",
  {
    id: text().primaryKey(),
    seq: seq(),
    saleNo: text().notNull().unique(),
    /** Raigam's invoice number (checked for duplicates in core.ts when entered) */
    invoiceNo: text().notNull().default(""),
    date: date({ mode: "string" }).notNull(),
    shopId: text()
      .notNull()
      .references(() => shops.id),
    repName: text().notNull().default(""),
    discount: money().notNull(),
    discountPercent: numeric({ precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    status: text({ enum: ["Ordered", "Loaded", "Delivered", "Cancelled"] }).notNull(),
    late: boolean().notNull().default(false),
    loadedDate: date({ mode: "string" }),
    vehicleNumber: text().notNull().default(""),
    deliveredDate: date({ mode: "string" }),
    dueDate: date({ mode: "string" }).notNull(),
    notes: text().notNull().default(""),
    /** Ticked once compared with Raigam's printed bill */
    checked: boolean().notNull().default(false),
    /** Written when delivering: what happened at the store, when the store will pay a balance on credit */
    deliveryNote: text().notNull().default(""),
    /** Credit amount added at delivery on top of the invoice value (owed with the bill, not a sale) */
    extraCredit: money().notNull().default(0),
  },
  (t) => [check("sales_status", sql`${t.status} in ('Ordered', 'Loaded', 'Delivered', 'Cancelled')`), noApiAccess()],
).enableRLS();

export const saleLines = pgTable(
  "sale_lines",
  {
    id: text().primaryKey(),
    saleId: text()
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    /** Line order within the bill */
    position: integer().notNull(),
    sapCode: text()
      .notNull()
      .references(() => items.sapCode),
    locationNumber: text().notNull(),
    /** "Sale" = an item sold on the bill; "Good" / "Market" = a return item (location "", never stock) */
    kind: text({ enum: ["Sale", "Good", "Market"] }).notNull().default("Sale"),
    qty: integer().notNull(),
    freeQty: integer().notNull().default(0),
    unitPrice: money().notNull(),
    discountPct: numeric({ precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    cancelQty: integer().notNull().default(0),
    /** Taken off the bill on Raigam before delivery (qty is what's left) */
    takenOff: integer().notNull().default(0),
    /** Reduced on the bill before delivery (e.g. not in our store): not loaded, not charged */
    missingQty: integer().notNull().default(0),
    /** Why the item was reduced or changed */
    note: text().notNull().default(""),
    /** A free issue item given with another item on the bill: that item's SAP code */
    freeWith: text().notNull().default(""),
    costPrice: money().notNull(),
  },
  (t) => [unique().on(t.saleId, t.kind, t.sapCode, t.locationNumber), noApiAccess()],
).enableRLS();

export const payments = pgTable("payments", {
  id: text().primaryKey(),
  seq: seq(),
  receiptNo: text().notNull().unique(),
  date: date({ mode: "string" }).notNull(),
  shopId: text()
    .notNull()
    .references(() => shops.id),
  amount: money().notNull(),
  method: text({ enum: ["Cash", "Cheque", "Bank Transfer"] }).notNull(),
  chequeNumber: text().notNull().default(""),
  chequeDate: date({ mode: "string" }),
  /** Cheques: when it was collected from the store (in hand); NULL = still to collect */
  chequeCollectedDate: date({ mode: "string" }),
  reference: text().notNull().default(""),
}, () => [noApiAccess()]).enableRLS();

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    paymentId: text()
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    /** NULL = the store's opening balance */
    saleId: text().references(() => sales.id),
    amount: money().notNull(),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.position] }), noApiAccess()],
).enableRLS();

/** Return items sent back to Raigam (a return note); its lines say what went */
export const raigamReturns = pgTable("raigam_returns", {
  id: text().primaryKey(),
  seq: seq(),
  returnNo: text().notNull().unique(),
  date: date({ mode: "string" }).notNull(),
  /** Raigam's return / credit note number; "" if none */
  reference: text().notNull().default(""),
  notes: text().notNull().default(""),
}, () => [noApiAccess()]).enableRLS();

export const raigamReturnLines = pgTable(
  "raigam_return_lines",
  {
    returnId: text()
      .notNull()
      .references(() => raigamReturns.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    kind: text({ enum: ["Good", "Market"] }).notNull(),
    sapCode: text()
      .notNull()
      .references(() => items.sapCode),
    qty: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.returnId, t.position] }), check("raigam_return_lines_qty", sql`${t.qty} > 0`), noApiAccess()],
).enableRLS();

/**
 * What a Raigam SFA id stands for here, learned by Sync from Raigam: Item → SAP code,
 * Store → shop id, Route → route id. No foreign key: a link to something deleted is just ignored.
 */
export const raigamLinks = pgTable(
  "raigam_links",
  {
    id: text().primaryKey(),
    seq: seq(),
    kind: text({ enum: ["Item", "Store", "Route"] }).notNull(),
    raigamId: integer().notNull(),
    appId: text().notNull(),
  },
  (t) => [unique().on(t.kind, t.raigamId), check("raigam_links_kind", sql`${t.kind} in ('Item', 'Store', 'Route')`), noApiAccess()],
).enableRLS();

export const expenses = pgTable("expenses", {
  id: text().primaryKey(),
  seq: seq(),
  expenseNo: text().notNull().unique(),
  date: date({ mode: "string" }).notNull(),
  category: text().notNull(),
  description: text().notNull().default(""),
  amount: money().notNull(),
  method: text({ enum: ["Cash", "Cheque", "Bank Transfer"] }).notNull(),
}, () => [noApiAccess()]).enableRLS();
