// Data model — mirrors the five Google Sheets tables.
// Derived columns (item name, package type, totals, match status) are
// computed from these records instead of being stored twice.

/** "Items" sheet — product master */
export type Item = {
  id: string;
  sapCode: string;
  description: string;
  packageDetails: string;
  uom: string;
  /** What we pay Raigam per unit (used for profit) */
  costPrice: number;
  wholesalePrice: number;
  retailPrice: number;
  /** Stock location new loads of this item go to; "" = not set yet */
  locationNumber: string;
};

/** "Store Location" sheet */
export type StoreLocation = {
  id: string;
  locationNumber: string;
  itemGroup: string;
};

/** "Store Details" sheet — stock on hand per item per location */
export type StockRecord = {
  id: string;
  sapCode: string;
  locationNumber: string;
  availableQty: number;
  issuedQty: number;
  /** ISO date (YYYY-MM-DD) */
  lastUpdate: string;
};

/** "Order Details" sheet */
export type Order = {
  id: string;
  /** Business key, e.g. "ORD - 0001" */
  orderId: string;
  invoiceNumber: string;
  /** Raigam's purchase order number, from the invoice */
  poNumber: string;
  /** ISO date (YYYY-MM-DD) */
  orderDate: string;
  /** ISO date, empty until the delivery arrives */
  receivedDate: string;
  /** HH:mm, empty until the delivery arrives */
  receivedTime: string;
  /** How we paid Raigam for this bill; "" = not paid yet */
  paymentMethod: PaymentMethod | "";
  /** ISO date paid (for a cheque, the day it was given); empty until paid */
  paidDate: string;
  /** Cheque payments only */
  chequeNumber: string;
  /** ISO date on the cheque; cheque payments only */
  chequeDepositDate: string;
  /** Transfer reference, slip or receipt number, or a note */
  paymentReference: string;
  /** What we owe Raigam: the lines total after the invoice discount */
  totalBillAmount: number;
  /** Raigam's "Discount % for Total Invoice" (0 = none) */
  discountPercent: number;
  /** True once received quantities have been added to stock */
  postedToStock: boolean;
};

/** "Order Item Details" sheet — one line per item in an order */
export type OrderItem = {
  id: string;
  /** References Order.orderId */
  orderId: string;
  /** References Item.sapCode */
  itemCode: string;
  orderedQty: number;
  receivedQty: number;
  /** Price per unit on the supplier invoice */
  unitPrice: number;
  /** Rs. off the whole line */
  discount: number;
  remarks: string;
  /** Location the received qty was posted to (set when the order is posted) */
  postedLocation?: string;
};

// ---------- Sales side: routes, stores (shops we sell to), sales, payments ----------

export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

/** A delivery / sales route that a rep covers on set days */
export type Route = {
  id: string;
  /** e.g. "RT - 001" */
  routeCode: string;
  routeName: string;
  /** Towns / areas covered */
  area: string;
  visitDays: WeekDay[];
  salesRep: string;
  vehicleNumber: string;
  active: boolean;
};

/**
 * A store (shop) we sell to — shown as "Store" in the UI.
 * Named Shop in code to avoid clashing with the state store and the warehouse "Store Details" sheet.
 */
export type Shop = {
  id: string;
  /** e.g. "ST - 0001" */
  shopCode: string;
  shopName: string;
  ownerName: string;
  phone: string;
  address: string;
  town: string;
  /** Optional Google Maps link to the shop */
  mapLink: string;
  routeId: string;
  creditLimit: number;
  /** Days the store gets to pay a bill; sets the default end date for collecting */
  creditDays: number;
  /** Amount the shop already owed when it was added */
  openingBalance: number;
  active: boolean;
  notes: string;
};

/** One item on a sale, taken from a specific stock record (item + location) */
export type SaleLine = {
  id: string;
  sapCode: string;
  locationNumber: string;
  qty: number;
  /** Free issue (a Raigam scheme they pay back): leaves stock with the line, not charged, not in profit */
  freeQty: number;
  unitPrice: number;
  /** Item discount, % off qty × unit price */
  discountPct: number;
  /** Entered at delivery: booked qty the store didn't take (back into stock, not charged) */
  cancelQty: number;
  /**
   * Booked on Raigam but taken off the bill there before delivery (Raigam's "cancel qty"), shown as on
   * Raigam's bill. Never loaded or charged: `qty` is what's left (0 when all of it was taken off).
   */
  takenOff: number;
  /** Item cost per unit when the bill was saved, so later price changes don't rewrite past profit */
  costPrice: number;
};

export const RETURN_KINDS = ["Good", "Market"] as const;
/** Good = good condition, Market = damaged / expired. Both are kept apart from stock and sent back to Raigam. */
export type ReturnKind = (typeof RETURN_KINDS)[number];

/**
 * Return item: goods the store gives back (any item, not only ones on the bill), credited on the bill.
 * Entered with the bill or at delivery. Never goes into stock: once the bill is delivered it's held in
 * the return items store (src/lib/returns.ts) until it's sent back to Raigam.
 */
export type SaleReturn = {
  id: string;
  kind: ReturnKind;
  sapCode: string;
  qty: number;
  /** Credit per unit */
  unitPrice: number;
  /** Item cost per unit when entered (for the record; returns don't change profit, Raigam pays them back) */
  costPrice: number;
};

/** Return items sent back to Raigam from the return items store (a return note) */
export type RaigamReturn = {
  id: string;
  /** e.g. "RN - 0001" */
  returnNo: string;
  /** ISO date sent */
  date: string;
  /** Raigam's return / credit note number; "" if none */
  reference: string;
  notes: string;
  lines: RaigamReturnLine[];
};

export type RaigamReturnLine = { kind: ReturnKind; sapCode: string; qty: number };

/**
 * Ordered = bill created by the rep (no stock moved)
 * Loaded = items loaded on the lorry (stock deducted)
 * Delivered = items given to the store (the store now owes the bill)
 */
export type SaleStatus = "Ordered" | "Loaded" | "Delivered" | "Cancelled";

/**
 * Store order (bill). The rep creates it; stock is deducted when it is loaded on
 * the lorry, and the store owes money once it is delivered. Money collected (at
 * delivery or later) is recorded as Payments linked to the bill; whatever is left
 * is the bill's cash balance, to be collected by `dueDate`.
 */
export type Sale = {
  id: string;
  /** Bill number, e.g. "SI - 0001" */
  saleNo: string;
  /** Invoice number from Raigam's system, e.g. "CN00344701"; empty until entered */
  invoiceNo: string;
  /** ISO date the bill was created */
  date: string;
  shopId: string;
  /** Rep who created the bill */
  repName: string;
  lines: SaleLine[];
  /** Return items (good / market), entered with the bill or at delivery */
  returns: SaleReturn[];
  /** Bill discount %, off the gross value (items less returns) */
  discountPercent: number;
  /** Bill discount in Rs. (worked out from discountPercent whenever the bill changes) */
  discount: number;
  status: SaleStatus;
  /** Marked "Late Delivery": not delivered on its day, so it went back to wait for loading */
  late: boolean;
  /** ISO date the items were loaded on the lorry; empty while Ordered */
  loadedDate: string;
  /** Lorry the items were loaded on */
  vehicleNumber: string;
  /** ISO date the items were given; empty until Delivered */
  deliveredDate: string;
  /** ISO end date for collecting the balance */
  dueDate: string;
  notes: string;
  /** Ticked once compared with Raigam's printed bill; cleared when a sync brings a change from Raigam */
  checked: boolean;
  /** Written when delivering: what happened at the store, when the store will pay a balance on credit ("" = none) */
  deliveryNote: string;
  /**
   * Credit amount added at delivery, on top of the invoice value (e.g. old credit to collect with this bill).
   * Owed and collected with the bill, but not part of its invoice value, sales or profit.
   */
  extraCredit: number;
};

export const PAYMENT_METHODS = ["Cash", "Cheque", "Bank Transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Bill id used for a shop's opening balance in payment allocations */
export const OPENING_BILL = "opening";

/** Part of a payment that pays a specific bill (a sale, or the opening balance) */
export type PaymentAllocation = {
  /** Sale id, or OPENING_BILL */
  saleId: string;
  amount: number;
};

/** Money collected from a shop against its balance */
export type Payment = {
  id: string;
  /** e.g. "RC - 0001" */
  receiptNo: string;
  /** ISO date */
  date: string;
  shopId: string;
  amount: number;
  method: PaymentMethod;
  chequeNumber: string;
  /** ISO date the cheque can be banked */
  chequeDate: string;
  /** Cheques only: ISO date the cheque was collected from the store (in hand); "" = still to collect */
  chequeCollectedDate: string;
  /** Note: bank / branch for a cheque, transfer reference, … */
  reference: string;
  /** Which bills this payment pays. Any amount left over is unlinked credit (an advance). */
  allocations: PaymentAllocation[];
};

export type BillStatus = "Paid" | "Part paid" | "Unpaid";

export const EXPENSE_CATEGORIES = [
  "Fuel",
  "Lorry repair",
  "Loading / labour",
  "Salaries",
  "Rent",
  "Electricity & water",
  "Phone",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Business running cost (fuel, repairs, salaries…). Taken off gross profit to get net profit. */
export type Expense = {
  id: string;
  /** e.g. "EX - 0001" */
  expenseNo: string;
  /** ISO date */
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  method: PaymentMethod;
};

export const RAIGAM_LINK_KINDS = ["Item", "Store", "Route"] as const;
export type RaigamLinkKind = (typeof RAIGAM_LINK_KINDS)[number];

/** What a Raigam SFA id stands for here (learned by Sync from Raigam, see src/lib/raigam.ts) */
export type RaigamLink = {
  id: string;
  kind: RaigamLinkKind;
  /** Raigam's item / outlet / route id */
  raigamId: number;
  /** Item: SAP code; Store: shop id; Route: route id */
  appId: string;
};

export type OrderStatus = "Pending" | "Received" | "Posted";
export type LineStatus = "Pending" | "Match" | "Unmatch";

/** `notes`: parts of a batch change that couldn't be done (e.g. bills a sync left out), the rest is saved */
export type Result = { ok: true; id?: string; notes?: string[] } | { ok: false; error: string };

export type ItemInput = Omit<Item, "id">;
export type LocationInput = Omit<StoreLocation, "id">;
export type StockInput = Omit<StockRecord, "id">;
export type OrderInput = Omit<Order, "id" | "orderId" | "postedToStock">;
/** One payment per Raigam bill */
export type OrderPayment = Pick<Order, "paymentMethod" | "paidDate" | "chequeNumber" | "chequeDepositDate" | "paymentReference">;
export type OrderLineInput = Pick<
  OrderItem,
  "itemCode" | "orderedQty" | "receivedQty" | "unitPrice" | "discount" | "remarks"
>;
export type OrderItemInput = OrderLineInput & { orderId: string };
export type RouteInput = Omit<Route, "id">;
export type ShopInput = Omit<Shop, "id">;
/** Cost price is filled in by the store from the item master */
export type SaleLineInput = Omit<SaleLine, "id" | "costPrice" | "cancelQty">;
export type SaleReturnInput = Omit<SaleReturn, "id" | "costPrice">;
export type RaigamReturnInput = Omit<RaigamReturn, "id" | "returnNo">;
export type ExpenseInput = Omit<Expense, "id" | "expenseNo">;
export type SaleInput = Omit<
  Sale,
  "id" | "saleNo" | "lines" | "returns" | "discount" | "status" | "late" | "deliveredDate" | "loadedDate" | "vehicleNumber" | "checked" | "deliveryNote" | "extraCredit"
> & {
  lines: SaleLineInput[];
  returns: SaleReturnInput[];
};
export type LoadInput = { date: string; vehicleNumber: string };
/** A load arriving from Raigam with its invoice: saved as a received order and added to stock */
export type ReceiveLoadInput = {
  invoiceNumber: string;
  poNumber: string;
  /** ISO date the load arrived */
  deliveryDate: string;
  /** "Discount % for Total Invoice", taken off the lines total */
  discountPercent: number;
  /** Each line goes into stock at its item's location */
  lines: { itemCode: string; qty: number; unitPrice: number; discount: number }[];
  /** How the bill was paid; left out = not paid yet */
  payment?: OrderPayment;
};
/** Money collected when delivering, and which bills it pays */
export type CollectionInput = Pick<Payment, "amount" | "method" | "chequeNumber" | "chequeDate" | "chequeCollectedDate" | "reference" | "allocations">;
export type DeliveryInput = {
  date: string;
  dueDate: string;
  collection: CollectionInput | null;
  /** Bill line id -> qty the store didn't take */
  cancels?: Record<string, number>;
  /** The bill's return items as checked at the store; left out = keep the ones entered with the bill */
  returns?: SaleReturnInput[];
  /** Delivery note; left out = keep the bill's */
  note?: string;
  /** Credit amount added on the bill (owed with it, e.g. old credit); left out = keep the bill's */
  extraCredit?: number;
};
export type PaymentInput = Omit<Payment, "id" | "receiptNo">;
/** One payment for one shop bill (the store and the link to the bill are filled in for it) */
export type BillPaymentInput = Pick<Payment, "date" | "amount" | "method" | "chequeNumber" | "chequeDate" | "chequeCollectedDate" | "reference">;
