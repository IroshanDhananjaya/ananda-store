import { linkAllPayments } from "./ledger";
import { addDays } from "./utils";
import type { Expense, Item, Order, OrderItem, Payment, Route, Sale, SaleStatus, Shop, StockRecord, StoreLocation } from "./types";

// Dummy data used on first load and by "Reset demo data".

export const seedItems: Item[] = [
  { id: "itm-01", sapCode: "RM-NOR-CUR-90G", description: "Normal Curry Soya - 90gr", packageDetails: "(90g x 50)", uom: "PKT", costPrice: 124, wholesalePrice: 147.9, retailPrice: 170, locationNumber: "LOC - 001", sheetSection: "", sheetNo: 0 },
  { id: "itm-02", sapCode: "RM-CHI-CUR-90G", description: "Chicken Curry Soya - 90gr", packageDetails: "(90g x 50)", uom: "PKT", costPrice: 128.5, wholesalePrice: 152, retailPrice: 175, locationNumber: "LOC - 001", sheetSection: "", sheetNo: 0 },
  { id: "itm-03", sapCode: "RM-DEV-SOY-90G", description: "Devilled Soya - 90gr", packageDetails: "(90g x 50)", uom: "PKT", costPrice: 130, wholesalePrice: 155.5, retailPrice: 180, locationNumber: "LOC - 001", sheetSection: "", sheetNo: 0 },
  { id: "itm-04", sapCode: "RM-MUT-SOY-90G", description: "Mutton Flavoured Soya - 90gr", packageDetails: "(90g x 50)", uom: "PKT", costPrice: 129.2, wholesalePrice: 152, retailPrice: 175, locationNumber: "LOC - 001", sheetSection: "", sheetNo: 0 },
  { id: "itm-05", sapCode: "RM-TAB-SAL-400G", description: "Table Salt - 400g", packageDetails: "(400g x 25)", uom: "PKT", costPrice: 54.5, wholesalePrice: 68, retailPrice: 80, locationNumber: "LOC - 002", sheetSection: "", sheetNo: 0 },
  { id: "itm-06", sapCode: "RM-IOD-SAL-1KG", description: "Iodized Crystal Salt - 1kg", packageDetails: "(1kg x 20)", uom: "PKT", costPrice: 77, wholesalePrice: 95, retailPrice: 110, locationNumber: "LOC - 002", sheetSection: "", sheetNo: 0 },
  { id: "itm-07", sapCode: "RM-CHI-NOO-400G", description: "Chicken Noodles - 400g", packageDetails: "(400g x 24)", uom: "PKT", costPrice: 251, wholesalePrice: 285, retailPrice: 330, locationNumber: "LOC - 003", sheetSection: "", sheetNo: 0 },
  { id: "itm-08", sapCode: "RM-CHI-POW-100G", description: "Chilli Powder - 100g", packageDetails: "(100g x 40)", uom: "PKT", costPrice: 176, wholesalePrice: 210, retailPrice: 245, locationNumber: "LOC - 004", sheetSection: "", sheetNo: 0 },
  { id: "itm-09", sapCode: "RM-CUR-POW-100G", description: "Curry Powder - 100g", packageDetails: "(100g x 40)", uom: "PKT", costPrice: 166, wholesalePrice: 195, retailPrice: 230, locationNumber: "LOC - 004", sheetSection: "", sheetNo: 0 },
  { id: "itm-10", sapCode: "RM-SOY-SAU-350ML", description: "Soya Sauce - 350ml", packageDetails: "(350ml x 24)", uom: "BTL", costPrice: 198, wholesalePrice: 240, retailPrice: 280, locationNumber: "LOC - 005", sheetSection: "", sheetNo: 0 },
];

export const seedLocations: StoreLocation[] = [
  { id: "loc-01", locationNumber: "LOC - 001", itemGroup: "SOYA" },
  { id: "loc-02", locationNumber: "LOC - 002", itemGroup: "SALT" },
  { id: "loc-03", locationNumber: "LOC - 003", itemGroup: "NOODLES" },
  { id: "loc-04", locationNumber: "LOC - 004", itemGroup: "SPICES" },
  { id: "loc-05", locationNumber: "LOC - 005", itemGroup: "SAUCES" },
];

export const seedStock: StockRecord[] = [
  { id: "stk-01", sapCode: "RM-NOR-CUR-90G", locationNumber: "LOC - 001", availableQty: 32, issuedQty: 18, lastUpdate: "2026-10-19" },
  { id: "stk-02", sapCode: "RM-CHI-CUR-90G", locationNumber: "LOC - 001", availableQty: 25, issuedQty: 15, lastUpdate: "2026-10-18" },
  { id: "stk-03", sapCode: "RM-DEV-SOY-90G", locationNumber: "LOC - 001", availableQty: 28, issuedQty: 0, lastUpdate: "2026-10-09" },
  { id: "stk-04", sapCode: "RM-MUT-SOY-90G", locationNumber: "LOC - 001", availableQty: 8, issuedQty: 22, lastUpdate: "2026-10-16" },
  { id: "stk-05", sapCode: "RM-TAB-SAL-400G", locationNumber: "LOC - 002", availableQty: 10, issuedQty: 15, lastUpdate: "2026-10-17" },
  { id: "stk-06", sapCode: "RM-IOD-SAL-1KG", locationNumber: "LOC - 002", availableQty: 14, issuedQty: 6, lastUpdate: "2026-10-14" },
  { id: "stk-07", sapCode: "RM-CHI-NOO-400G", locationNumber: "LOC - 003", availableQty: 24, issuedQty: 0, lastUpdate: "2026-10-09" },
  { id: "stk-08", sapCode: "RM-CHI-POW-100G", locationNumber: "LOC - 004", availableQty: 12, issuedQty: 28, lastUpdate: "2026-10-11" },
  { id: "stk-09", sapCode: "RM-CUR-POW-100G", locationNumber: "LOC - 004", availableQty: 5, issuedQty: 35, lastUpdate: "2026-10-13" },
];

type SeedLine = [itemCode: string, ordered: number, received: number, remarks?: string, postedLocation?: string];

const lines: Record<string, SeedLine[]> = {
  "ORD - 0001": [
    ["RM-NOR-CUR-90G", 50, 50, "", "LOC - 001"],
    ["RM-CHI-CUR-90G", 40, 40, "", "LOC - 001"],
    ["RM-TAB-SAL-400G", 25, 25, "", "LOC - 002"],
  ],
  "ORD - 0002": [
    ["RM-DEV-SOY-90G", 30, 28, "2 packs damaged in transit", "LOC - 001"],
    ["RM-IOD-SAL-1KG", 20, 20, "", "LOC - 002"],
    ["RM-CHI-NOO-400G", 24, 24, "", "LOC - 003"],
  ],
  "ORD - 0003": [
    ["RM-NOR-CUR-90G", 100, 100],
    ["RM-MUT-SOY-90G", 50, 45, "Short supplied by 5"],
    ["RM-CHI-POW-100G", 40, 40],
  ],
  "ORD - 0004": [
    ["RM-CUR-POW-100G", 40, 40],
    ["RM-SOY-SAU-350ML", 24, 24],
  ],
  "ORD - 0005": [
    ["RM-NOR-CUR-90G", 60, 0],
    ["RM-CHI-CUR-90G", 60, 0],
    ["RM-TAB-SAL-400G", 50, 0],
  ],
  "ORD - 0006": [
    ["RM-DEV-SOY-90G", 40, 0],
    ["RM-IOD-SAL-1KG", 40, 0],
  ],
};

const costOf = (code: string) => seedItems.find((i) => i.sapCode === code)?.costPrice ?? 0;

// Invoice price = the item's cost price, no discounts
export const seedOrderItems: OrderItem[] = Object.entries(lines).flatMap(([orderId, rows], o) =>
  rows.map(([itemCode, orderedQty, receivedQty, remarks = "", postedLocation], i) => ({
    id: `oi-${o + 1}-${i + 1}`,
    orderId,
    itemCode,
    orderedQty,
    receivedQty,
    unitPrice: costOf(itemCode),
    discount: 0,
    remarks,
    postedLocation,
  })),
);

function billFor(orderId: string) {
  const total = lines[orderId].reduce((sum, [code, qty]) => sum + costOf(code) * qty, 0);
  return Math.round(total * 100) / 100;
}

export const seedOrders: Order[] = [
  { id: "ord-01", orderId: "ORD - 0001", invoiceNumber: "INV-RG-24561", poNumber: "PO-4500231", orderDate: "2026-10-02", receivedDate: "2026-10-04", receivedTime: "10:15", paymentMethod: "Cheque", paidDate: "2026-10-04", chequeNumber: "100231", chequeDepositDate: "2026-10-31", paymentReference: "", totalBillAmount: billFor("ORD - 0001"), discountPercent: 0, postedToStock: true, territory: "", requiredDate: "" },
  { id: "ord-02", orderId: "ORD - 0002", invoiceNumber: "INV-RG-24610", poNumber: "PO-4500232", orderDate: "2026-10-07", receivedDate: "2026-10-09", receivedTime: "14:40", paymentMethod: "Cheque", paidDate: "2026-10-09", chequeNumber: "100245", chequeDepositDate: "2026-11-05", paymentReference: "", totalBillAmount: billFor("ORD - 0002"), discountPercent: 0, postedToStock: true, territory: "", requiredDate: "" },
  { id: "ord-03", orderId: "ORD - 0003", invoiceNumber: "INV-RG-24702", poNumber: "PO-4500233", orderDate: "2026-10-12", receivedDate: "2026-10-15", receivedTime: "09:30", paymentMethod: "Cheque", paidDate: "2026-10-15", chequeNumber: "100259", chequeDepositDate: "2026-11-12", paymentReference: "", totalBillAmount: billFor("ORD - 0003"), discountPercent: 0, postedToStock: false, territory: "", requiredDate: "" },
  { id: "ord-04", orderId: "ORD - 0004", invoiceNumber: "INV-RG-24788", poNumber: "PO-4500234", orderDate: "2026-10-17", receivedDate: "2026-10-20", receivedTime: "16:05", paymentMethod: "Cheque", paidDate: "2026-10-20", chequeNumber: "100266", chequeDepositDate: "2026-11-17", paymentReference: "", totalBillAmount: billFor("ORD - 0004"), discountPercent: 0, postedToStock: false, territory: "", requiredDate: "" },
  { id: "ord-05", orderId: "ORD - 0005", invoiceNumber: "", poNumber: "PO-4500235", orderDate: "2026-10-20", receivedDate: "", receivedTime: "", paymentMethod: "", paidDate: "", chequeNumber: "", chequeDepositDate: "", paymentReference: "", totalBillAmount: billFor("ORD - 0005"), discountPercent: 0, postedToStock: false, territory: "", requiredDate: "" },
  { id: "ord-06", orderId: "ORD - 0006", invoiceNumber: "", poNumber: "PO-4500236", orderDate: "2026-10-21", receivedDate: "", receivedTime: "", paymentMethod: "", paidDate: "", chequeNumber: "", chequeDepositDate: "", paymentReference: "", totalBillAmount: billFor("ORD - 0006"), discountPercent: 0, postedToStock: false, territory: "", requiredDate: "" },
];

// ---------- Sales side ----------

export const seedRoutes: Route[] = [
  { id: "rt-01", routeCode: "RT - 001", routeName: "Kurunegala Town", area: "Kurunegala, Wehera, Malkaduwawa", visitDays: ["Mon", "Thu"], salesRep: "Nimal Perera", vehicleNumber: "WP LB-4521", active: true },
  { id: "rt-02", routeCode: "RT - 002", routeName: "Kuliyapitiya Route", area: "Kuliyapitiya, Hettipola, Pannala", visitDays: ["Tue", "Fri"], salesRep: "Sunil Bandara", vehicleNumber: "NW KD-7783", active: true },
  { id: "rt-03", routeCode: "RT - 003", routeName: "Puttalam Road", area: "Wariyapola, Nikaweratiya, Anamaduwa", visitDays: ["Wed"], salesRep: "Kasun Jayasinghe", vehicleNumber: "NW LH-2210", active: true },
  { id: "rt-04", routeCode: "RT - 004", routeName: "Polgahawela Route", area: "Polgahawela, Alawwa, Narammala", visitDays: ["Sat"], salesRep: "Nimal Perera", vehicleNumber: "WP LB-4521", active: true },
];

export const seedShops: Shop[] = [
  { id: "sh-01", shopCode: "ST - 0001", shopName: "Sanjeewa Stores", ownerName: "K. Sanjeewa", phone: "071 234 5601", address: "No. 12, Main Street", town: "Kurunegala", mapLink: "", routeId: "rt-01", creditLimit: 25000, creditDays: 14, openingBalance: 12500, active: true, notes: "" },
  { id: "sh-02", shopCode: "ST - 0002", shopName: "Lak Sevana Grocery", ownerName: "R. M. Lakshman", phone: "077 345 6702", address: "45, Colombo Road", town: "Wehera", mapLink: "", routeId: "rt-01", creditLimit: 15000, creditDays: 7, openingBalance: 4200, active: true, notes: "" },
  { id: "sh-03", shopCode: "ST - 0003", shopName: "New Ruwan Trade Centre", ownerName: "Ruwan Kumara", phone: "076 456 7803", address: "8, Puttalam Road", town: "Malkaduwawa", mapLink: "", routeId: "rt-01", creditLimit: 30000, creditDays: 21, openingBalance: 28750, active: true, notes: "Pays by cheque, 2 weeks" },
  { id: "sh-04", shopCode: "ST - 0004", shopName: "Siri Lanka Super", ownerName: "S. Priyantha", phone: "070 567 8904", address: "101, Kurunegala Road", town: "Kuliyapitiya", mapLink: "", routeId: "rt-02", creditLimit: 20000, creditDays: 14, openingBalance: 0, active: true, notes: "" },
  { id: "sh-05", shopCode: "ST - 0005", shopName: "Jayasiri Stores", ownerName: "W. Jayasiri", phone: "072 678 9005", address: "3, Temple Road", town: "Hettipola", mapLink: "", routeId: "rt-02", creditLimit: 5000, creditDays: 7, openingBalance: 6300, active: true, notes: "Over limit — collect before next delivery" },
  { id: "sh-06", shopCode: "ST - 0006", shopName: "Thilak Food City", ownerName: "Thilak Rathnayake", phone: "078 789 0106", address: "22, Bus Stand Road", town: "Pannala", mapLink: "", routeId: "rt-02", creditLimit: 40000, creditDays: 30, openingBalance: 18900, active: true, notes: "" },
  { id: "sh-07", shopCode: "ST - 0007", shopName: "Pradeep Grocery", ownerName: "Pradeep Silva", phone: "071 890 1207", address: "56, Station Road", town: "Wariyapola", mapLink: "", routeId: "rt-03", creditLimit: 10000, creditDays: 0, openingBalance: 0, active: true, notes: "Cash only" },
  { id: "sh-08", shopCode: "ST - 0008", shopName: "Ama Mini Market", ownerName: "A. Dissanayake", phone: "077 901 2308", address: "14, Hospital Road", town: "Nikaweratiya", mapLink: "", routeId: "rt-03", creditLimit: 20000, creditDays: 14, openingBalance: 9800, active: true, notes: "" },
  { id: "sh-09", shopCode: "ST - 0009", shopName: "Nuwan Traders", ownerName: "Nuwan Herath", phone: "075 012 3409", address: "9, Kandy Road", town: "Polgahawela", mapLink: "", routeId: "rt-04", creditLimit: 15000, creditDays: 14, openingBalance: 2150, active: true, notes: "" },
  { id: "sh-10", shopCode: "ST - 0010", shopName: "Wijaya Stores", ownerName: "D. Wijayasena", phone: "071 123 4510", address: "77, Main Street", town: "Alawwa", mapLink: "", routeId: "rt-04", creditLimit: 10000, creditDays: 14, openingBalance: 0, active: false, notes: "Shop closed for renovation" },
];

const price = (sapCode: string) => seedItems.find((i) => i.sapCode === sapCode)?.wholesalePrice ?? 0;
const cost = (sapCode: string) => seedItems.find((i) => i.sapCode === sapCode)?.costPrice ?? 0;
const pad = (n: number, width: number) => String(n).padStart(width, "0");

type SeedSaleLine = [sapCode: string, locationNumber: string, qty: number];
type SeedBill = { id: string; date: string; shopId: string; status: SaleStatus; lines: SeedSaleLine[] };

const billTotal = (b: SeedBill) => Math.round(b.lines.reduce((sum, [sap, , qty]) => sum + price(sap) * qty, 0) * 100) / 100;

// ---------- January–September history: 4 delivered bills a month, each paid in full a week later ----------
// (Gives the profit report a year to show. Their stock movement is in the past, not in the seed stock.)

const SHOP_CYCLE = ["sh-01", "sh-02", "sh-03", "sh-04", "sh-05", "sh-06", "sh-07", "sh-08", "sh-09"];
const ITEM_CYCLE: [sapCode: string, locationNumber: string][] = [
  ["RM-NOR-CUR-90G", "LOC - 001"],
  ["RM-CHI-CUR-90G", "LOC - 001"],
  ["RM-DEV-SOY-90G", "LOC - 001"],
  ["RM-TAB-SAL-400G", "LOC - 002"],
  ["RM-MUT-SOY-90G", "LOC - 001"],
  ["RM-IOD-SAL-1KG", "LOC - 002"],
  ["RM-CHI-NOO-400G", "LOC - 003"],
  ["RM-CHI-POW-100G", "LOC - 004"],
  ["RM-CUR-POW-100G", "LOC - 004"],
];
// Busier months sell more (April: Sinhala & Tamil New Year)
const SEASON = [0.8, 0.85, 1.05, 1.4, 1.0, 0.9, 0.95, 1.1, 1.0];

const historyBills: SeedBill[] = Array.from({ length: 36 }, (_, n) => {
  const month = Math.floor(n / 4) + 1;
  const week = n % 4;
  // Three different items per bill (offsets 0/3/6 never collide in a cycle of 9)
  const lines = [0, 3, 6].map((offset, j): SeedSaleLine => {
    const [sapCode, locationNumber] = ITEM_CYCLE[(n * 2 + offset) % ITEM_CYCLE.length];
    return [sapCode, locationNumber, Math.round((40 + ((n * 7 + j * 11) % 50)) * SEASON[month - 1])];
  });
  return { id: `sl-h${n + 1}`, date: `2026-${pad(month, 2)}-${pad(3 + week * 7, 2)}`, shopId: SHOP_CYCLE[n % SHOP_CYCLE.length], status: "Delivered", lines };
});

// ---------- October ----------

const octoberBills: SeedBill[] = [
  { id: "sl-1", date: "2026-10-05", shopId: "sh-01", status: "Delivered", lines: [["RM-NOR-CUR-90G", "LOC - 001", 5], ["RM-TAB-SAL-400G", "LOC - 002", 4]] },
  { id: "sl-2", date: "2026-10-06", shopId: "sh-02", status: "Delivered", lines: [["RM-CHI-CUR-90G", "LOC - 001", 4], ["RM-CHI-POW-100G", "LOC - 004", 6]] },
  { id: "sl-3", date: "2026-10-08", shopId: "sh-04", status: "Delivered", lines: [["RM-MUT-SOY-90G", "LOC - 001", 6], ["RM-CUR-POW-100G", "LOC - 004", 8]] },
  { id: "sl-4", date: "2026-10-10", shopId: "sh-05", status: "Delivered", lines: [["RM-NOR-CUR-90G", "LOC - 001", 4], ["RM-IOD-SAL-1KG", "LOC - 002", 3]] },
  { id: "sl-5", date: "2026-10-13", shopId: "sh-03", status: "Delivered", lines: [["RM-CHI-CUR-90G", "LOC - 001", 5], ["RM-MUT-SOY-90G", "LOC - 001", 8], ["RM-CUR-POW-100G", "LOC - 004", 10]] },
  { id: "sl-6", date: "2026-10-15", shopId: "sh-07", status: "Delivered", lines: [["RM-TAB-SAL-400G", "LOC - 002", 6], ["RM-CHI-POW-100G", "LOC - 004", 8]] },
  { id: "sl-7", date: "2026-10-18", shopId: "sh-01", status: "Delivered", lines: [["RM-NOR-CUR-90G", "LOC - 001", 5], ["RM-CHI-CUR-90G", "LOC - 001", 3], ["RM-CUR-POW-100G", "LOC - 004", 6]] },
  { id: "sl-8", date: "2026-10-20", shopId: "sh-09", status: "Delivered", lines: [["RM-MUT-SOY-90G", "LOC - 001", 4], ["RM-IOD-SAL-1KG", "LOC - 002", 3], ["RM-CHI-POW-100G", "LOC - 004", 5]] },
  // Not delivered yet (nothing owed). "Ordered" = no stock moved; "Loaded" = on the lorry
  // (October delivered + loaded quantities are already counted in the seed stock's "Issued").
  { id: "sl-p1", date: "2026-10-21", shopId: "sh-06", status: "Ordered", lines: [["RM-NOR-CUR-90G", "LOC - 001", 10], ["RM-CHI-NOO-400G", "LOC - 003", 6]] },
  { id: "sl-p2", date: "2026-10-21", shopId: "sh-02", status: "Ordered", lines: [["RM-DEV-SOY-90G", "LOC - 001", 8], ["RM-IOD-SAL-1KG", "LOC - 002", 4]] },
  { id: "sl-p3", date: "2026-10-21", shopId: "sh-04", status: "Loaded", lines: [["RM-TAB-SAL-400G", "LOC - 002", 5], ["RM-CHI-POW-100G", "LOC - 004", 4]] },
];

const routeFor = (shopId: string) => {
  const shop = seedShops.find((s) => s.id === shopId);
  return seedRoutes.find((r) => r.id === shop?.routeId);
};
const creditDaysFor = (shopId: string) => seedShops.find((s) => s.id === shopId)?.creditDays ?? 14;

// Bill numbers follow date order
export const seedSales: Sale[] = [...historyBills, ...octoberBills].map((b, i): Sale => {
  const moved = b.status !== "Ordered";
  return {
    id: b.id,
    saleNo: `SI - ${pad(i + 1, 4)}`,
    invoiceNo: "",
    date: b.date,
    shopId: b.shopId,
    repName: routeFor(b.shopId)?.salesRep ?? "",
    discount: 0,
    discountPercent: 0,
    status: b.status,
    late: false,
    checked: false,
    deliveryNote: "",
    extraCredit: 0,
    loadedDate: moved ? b.date : "",
    vehicleNumber: moved ? (routeFor(b.shopId)?.vehicleNumber ?? "") : "",
    deliveredDate: b.status === "Delivered" ? b.date : "",
    dueDate: addDays(b.date, creditDaysFor(b.shopId)),
    notes: "",
    lines: b.lines.map(([sapCode, locationNumber, qty], j) => ({
      id: `${b.id}-${j + 1}`,
      sapCode,
      locationNumber,
      qty,
      freeQty: 0,
      unitPrice: price(sapCode),
      discountPct: 0,
      cancelQty: 0,
      takenOff: 0,
      missingQty: 0,
      note: "",
      freeWith: "",
      costPrice: cost(sapCode),
    })),
    returns: [],
  };
});

const saleNoOf = (id: string) => seedSales.find((s) => s.id === id)?.saleNo ?? "";

// ---------- Payments ----------

type SeedPayment = Omit<Payment, "id" | "receiptNo">;
const collection = (date: string, shopId: string, amount: number, allocations: Payment["allocations"] = [], extra: Partial<SeedPayment> = {}): SeedPayment => ({
  date,
  shopId,
  amount,
  method: "Cash",
  chequeNumber: "",
  chequeDate: "",
  chequeCollectedDate: "",
  reference: "",
  allocations,
  ...extra,
});

const historyPayments: SeedPayment[] = historyBills.map((b, n) => {
  const amount = billTotal(b);
  const cheque = n % 5 === 2;
  return collection(addDays(b.date, 7), b.shopId, amount, [{ saleId: b.id, amount }], {
    method: cheque ? "Cheque" : "Cash",
    chequeNumber: cheque ? String(540100 + n) : "",
    chequeDate: cheque ? addDays(b.date, 14) : "",
    // Older cheques are in the bank
    chequeCollectedDate: cheque ? addDays(b.date, 16) : "",
  });
});

// Receipts with no bills listed are linked to the store's oldest open bills (opening balance first)
const octoberPayments: SeedPayment[] = [
  collection("2026-10-06", "sh-02", 1868, [{ saleId: "sl-2", amount: 1868 }], { reference: `Collected on delivery of ${saleNoOf("sl-2")}` }),
  collection("2026-10-07", "sh-01", 5000),
  collection("2026-10-08", "sh-04", 1000, [{ saleId: "sl-3", amount: 1000 }], { reference: `Collected on delivery of ${saleNoOf("sl-3")}` }),
  collection("2026-10-09", "sh-03", 10000, [], { method: "Cheque", chequeNumber: "552301", chequeDate: "2026-10-25", reference: "BOC Kurunegala" }),
  collection("2026-10-12", "sh-04", 1472, [{ saleId: "sl-3", amount: 1472 }], { reference: `Balance of ${saleNoOf("sl-3")}` }),
  collection("2026-10-15", "sh-07", 2088, [{ saleId: "sl-6", amount: 2088 }], { reference: `Collected on delivery of ${saleNoOf("sl-6")}` }),
  collection("2026-10-16", "sh-06", 7500, [], { method: "Bank Transfer", reference: "Commercial Bank ref 88412" }),
  // Paid the new bill in full and part of an older one
  collection("2026-10-18", "sh-01", 3000, [{ saleId: "sl-7", amount: 2365.5 }, { saleId: "sl-1", amount: 634.5 }], {
    reference: `Collected on delivery of ${saleNoOf("sl-7")}`,
  }),
  collection("2026-10-19", "sh-02", 3000),
  collection("2026-10-20", "sh-09", 500, [{ saleId: "sl-8", amount: 500 }], { reference: `Collected on delivery of ${saleNoOf("sl-8")}` }),
  collection("2026-10-21", "sh-08", 4250),
];

// Receipt numbers follow date order
export const seedPayments: Payment[] = linkAllPayments(
  seedShops,
  seedSales,
  [...historyPayments, ...octoberPayments]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p, i) => ({ ...p, id: `py-${pad(i + 1, 3)}`, receiptNo: `RC - ${pad(i + 1, 4)}` })),
);

// ---------- Expenses ----------

type SeedExpense = [date: string, category: Expense["category"], description: string, amount: number];
const FUEL = [4200, 4350, 4600, 5400, 4500, 4300, 4450, 4800, 4550];

const expenseRows: SeedExpense[] = [
  ...FUEL.flatMap((fuel, m): SeedExpense[] => {
    const month = `2026-${pad(m + 1, 2)}`;
    return [
      [`${month}-02`, "Phone", "Reps' phone bills", 800],
      [`${month}-12`, "Fuel", "Diesel for delivery lorries", fuel],
      [`${month}-26`, "Loading / labour", "Loading helpers", 2000],
    ];
  }),
  ["2026-02-18", "Lorry repair", "Gearbox repair · WP LB-4521", 14500],
  ["2026-04-08", "Loading / labour", "Extra helper for New Year season", 2500],
  ["2026-07-22", "Lorry repair", "Two new tyres · NW KD-7783", 6800],
  ["2026-10-02", "Phone", "Reps' phone bills", 800],
  ["2026-10-10", "Fuel", "Diesel for delivery lorries", 900],
];

export const seedExpenses: Expense[] = expenseRows
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([date, category, description, amount], i) => ({
    id: `ex-${pad(i + 1, 3)}`,
    expenseNo: `EX - ${pad(i + 1, 4)}`,
    date,
    category,
    description,
    amount,
    method: "Cash",
  }));