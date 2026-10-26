import { billDiscount, saleSubtotal } from "./ledger";
import type {
  Item,
  RaigamLink,
  RaigamLinkKind,
  Route,
  Sale,
  SaleInput,
  SaleLineInput,
  SaleReturnInput,
  Shop,
  StockRecord,
  StoreLocation,
} from "./types";
import { addDays, newId, round2 } from "./utils";

// Sync from Raigam: the bills reps book on Raigam's SFA system (www.raigamsfa.com) come into the app.
// The server reads them (raigam-sfa.ts); this file works out what each one means here (add it, update
// the bill already here, or leave it) the same way for the sync dialog's preview and for saving (core.ts).
//
// Raigam's ids are linked to the app's records (RaigamLink): items once, by hand in the sync dialog;
// stores from a bill already here or the same name, else a new store is added with just its name.

/** One item on a Raigam bill: what's sold and what the store gave back */
export type RaigamLine = {
  /** Raigam's item id (matched to a SAP code once, in the sync dialog) */
  itemId: number;
  itemName: string;
  /** Booked qty less what was taken off the bill */
  qty: number;
  freeQty: number;
  unitPrice: number;
  discountPct: number;
  goodQty: number;
  goodPrice: number;
  marketQty: number;
  marketPrice: number;
  /** Booked qty taken off the bill on Raigam (its "cancelled qty"), noted on new bills */
  takenOff: number;
};

/** Raigam has the line on the bill: something sold, free, returned or taken off */
export const onRaigamBill = (l: RaigamLine) => l.qty > 0 || l.freeQty > 0 || l.goodQty > 0 || l.marketQty > 0 || l.takenOff > 0;

/** Every item on the bill was taken off on Raigam: nothing to load or charge (Rs. 0), as Raigam keeps it */
export const allTakenOff = (bill: { lines: Pick<SaleLineInput, "qty" | "freeQty" | "takenOff">[]; returns: unknown[] }) =>
  bill.lines.length > 0 && bill.returns.length === 0 && bill.lines.every((l) => l.qty === 0 && l.freeQty === 0 && l.takenOff > 0);

export type RaigamBill = {
  /** Raigam's invoice id */
  id: number;
  /** As Raigam prints it, e.g. "CN00344736" */
  invoiceNo: string;
  /** ISO date the rep booked it */
  date: string;
  outletId: number;
  outletName: string;
  routeId: number;
  routeName: string;
  cancelled: boolean;
  late: boolean;
  /** "Actual" on Raigam: delivered there (a bill here is still delivered here, with the cash collected) */
  delivered: boolean;
  discountPct: number;
  /** Raigam's invoice value, to check ours against */
  total: number;
  /** Only read for bills that may be added or changed (see billsNeedingItems) */
  lines?: RaigamLine[];
};

/** Raigam item id -> SAP code, picked in the sync dialog */
export type ItemPicks = Record<number, string>;

/** The data a sync looks at */
export type SyncData = {
  items: Item[];
  stock: StockRecord[];
  locations: StoreLocation[];
  routes: Route[];
  shops: Shop[];
  sales: Sale[];
  raigamLinks: RaigamLink[];
};

/** Same default as a store added by hand */
export const NEW_STORE_CREDIT_DAYS = 21;

/**
 * Bills per request to the server: their items are read (or they're saved) in one go, which has to
 * finish within the hosting's 10-second limit and the 1 MB a request may carry
 */
export const RAIGAM_ITEMS_BATCH = 40;

// ---------- Invoice numbers ----------

/** "CN000000000344736" -> "CN00344736", the way Raigam prints it (the number padded to 8 digits) */
export function raigamInvoiceNo(raw: string) {
  const m = raw.trim().toUpperCase().match(/^([A-Z]*)0*(\d+)$/);
  return m ? m[1] + m[2].padStart(8, "0") : raw.trim().toUpperCase();
}

/** The same invoice however it was typed: "CN00344736", "cn 344736", "CN000000000344736" */
export const invoiceKey = (no: string) =>
  no
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^([A-Z]*)0+/, "$1");

function salesByInvoice(sales: Sale[]) {
  return new Map(sales.filter((s) => s.invoiceNo).map((s) => [invoiceKey(s.invoiceNo), s]));
}

/** Ids of the bills whose items are needed: ones that may be added, or are here and not delivered yet */
export function billsNeedingItems(sales: Sale[], bills: RaigamBill[]) {
  const here = salesByInvoice(sales);
  return bills
    .filter((b) => {
      const sale = here.get(invoiceKey(b.invoiceNo));
      return !b.cancelled && (!sale || sale.status === "Ordered" || sale.status === "Loaded");
    })
    .map((b) => b.id);
}

// ---------- Links ----------

function linkMap(links: RaigamLink[], kind: RaigamLinkKind) {
  return new Map(links.filter((l) => l.kind === kind).map((l) => [l.raigamId, l.appId]));
}

/** Adds a link, or points an existing one somewhere else */
export function putLink(links: RaigamLink[], kind: RaigamLinkKind, raigamId: number, appId: string): RaigamLink[] {
  const old = links.find((l) => l.kind === kind && l.raigamId === raigamId);
  if (old?.appId === appId) return links;
  return old ? links.map((l) => (l === old ? { ...l, appId } : l)) : [...links, { id: newId(), kind, raigamId, appId }];
}

// ---------- Items ----------

/** Words of an item name, with sizes written one way: "Salt-400gr" -> salt, 400g */
function words(name: string) {
  return new Set(
    name
      .toLowerCase()
      .replace(/(\d+)\s*(grams|gram|gms|gm|gr|g)\b/g, "$1g")
      .replace(/(\d+)\s*(ml|kg|l)\b/g, "$1$2")
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

function likeness(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.max(A.size, B.size, 1);
}

/**
 * The item here whose name is closest to a Raigam item's. `sure` when the words are the same
 * ("Chicken Soya Devel 110g" / "Chicken Soya Devel - 110gr") and no other item ties.
 */
export function suggestItem(name: string, items: Item[]): { sapCode: string; sure: boolean } | null {
  let best: Item | undefined;
  let score = 0;
  let ties = 0;
  for (const item of items) {
    const s = likeness(name, item.description);
    if (s > score) [best, score, ties] = [item, s, 1];
    else if (s === score && s > 0) ties++;
  }
  if (!best || score < 0.5) return null;
  return { sapCode: best.sapCode, sure: score === 1 && ties === 1 };
}

/** Where a bill line takes its stock from, as on the bill form: the item's own location, unless its stock is kept elsewhere (else the only location) */
export function stockLocationFor(sapCode: string, data: Pick<SyncData, "items" | "stock" | "locations">) {
  const own = data.items.find((i) => i.sapCode === sapCode)?.locationNumber ?? "";
  const kept = data.stock.filter((r) => r.sapCode === sapCode && r.availableQty > 0).sort((a, b) => b.availableQty - a.availableQty);
  if (own && (kept.length === 0 || kept.some((r) => r.locationNumber === own))) return own;
  return kept[0]?.locationNumber ?? (data.locations.length === 1 ? data.locations[0].locationNumber : "");
}

// ---------- Stores ----------

/** A Raigam outlet here: a store (`learnt`: a link to save), or a store to add on a route (routeId "" = a new route too) */
export type StoreRef =
  | { shopId: string; learnt: boolean }
  | { shopId: ""; name: string; routeId: string; routeName: string; raigamRouteId: number };

/** A store or route name to compare: case, spaces, marks and a plural "s" don't count ("Chandra stores" = "Chandra Store") */
const squash = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.replace(/s$/, ""))
    .join("");

/** Which store each outlet is: linked before, the store its bill is already on, a store with the same name, or a new one */
export function resolveStores(data: SyncData, bills: RaigamBill[]): Map<number, StoreRef> {
  const shopIds = new Set(data.shops.map((s) => s.id));
  const refs = new Map<number, StoreRef>();
  // A store is one Raigam outlet: once claimed, it isn't matched to another by name
  const claimed = new Set<string>();
  const claim = (outletId: number, shopId: string, learnt: boolean) => {
    refs.set(outletId, { shopId, learnt });
    claimed.add(shopId);
  };

  for (const [outletId, shopId] of linkMap(data.raigamLinks, "Store")) if (shopIds.has(shopId)) claim(outletId, shopId, false);
  const here = salesByInvoice(data.sales);
  for (const b of bills) {
    const sale = here.get(invoiceKey(b.invoiceNo));
    if (sale && !refs.has(b.outletId) && shopIds.has(sale.shopId)) claim(b.outletId, sale.shopId, true);
  }

  const routeIds = new Set(data.routes.map((r) => r.id));
  const routeLinks = linkMap(data.raigamLinks, "Route");
  for (const b of bills) {
    if (refs.has(b.outletId)) continue;
    const same = data.shops.find((s) => !claimed.has(s.id) && squash(s.shopName) === squash(b.outletName));
    if (same) {
      claim(b.outletId, same.id, true);
      continue;
    }
    const linkedRoute = routeLinks.get(b.routeId);
    const route = linkedRoute && routeIds.has(linkedRoute) ? linkedRoute : data.routes.find((r) => squash(r.routeName) === squash(b.routeName))?.id;
    refs.set(b.outletId, { shopId: "", name: b.outletName.trim(), routeId: route ?? "", routeName: b.routeName.trim(), raigamRouteId: b.routeId });
  }
  return refs;
}

// ---------- Bills ----------

export type SyncAction =
  /** New: added to the app */
  | "add"
  /** Here, not delivered yet, and changed on Raigam (or cancelled / late there) */
  | "update"
  /** Here and the same */
  | "same"
  /** Delivered or cancelled here: what happened at the store is recorded here, so it's left alone */
  | "kept"
  /** Cancelled on Raigam and never here: nothing to add */
  | "ignore"
  /** Can't be saved until something is fixed (e.g. an item to match) */
  | "problem";

export type SyncRow = {
  bill: RaigamBill;
  action: SyncAction;
  /** What changed, or why nothing happens */
  note: string;
  /** The bill already here */
  sale?: Sale;
  /** add, or update with changed contents: the bill as Raigam has it (shopId "" = its store is added first) */
  input?: SaleInput;
  /** update: Raigam cancelled it */
  cancel?: boolean;
  /** add / update: Raigam marked it Late Delivery */
  late?: boolean;
  /** Our total for the bill, when it isn't Raigam's */
  differentTotal?: number;
};

export type SyncPlan = {
  rows: SyncRow[];
  stores: Map<number, StoreRef>;
  /** Raigam items not matched to an item here, with how many bills wait for each */
  unmatched: { itemId: number; itemName: string; bills: number }[];
};

const lineSig = (l: Pick<SaleLineInput, "sapCode" | "qty" | "freeQty" | "takenOff" | "unitPrice" | "discountPct">) =>
  [l.sapCode, l.qty, l.freeQty, l.takenOff, round2(l.unitPrice), round2(l.discountPct)].join("|");
const returnSig = (r: Pick<SaleReturnInput, "kind" | "sapCode" | "qty" | "unitPrice">) => [r.kind, r.sapCode, r.qty, round2(r.unitPrice)].join("|");
const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** What differs between a bill here and Raigam's version of it */
function differences(sale: Sale, input: SaleInput) {
  const changes: string[] = [];
  if (sale.invoiceNo !== input.invoiceNo) changes.push("invoice no.");
  if (sale.shopId !== input.shopId) changes.push("store");
  if (sale.date !== input.date) changes.push("date");
  if (!sameList(sale.lines.map(lineSig), input.lines.map(lineSig))) changes.push("items");
  if (!sameList(sale.returns.map(returnSig), input.returns.map(returnSig))) changes.push("return items");
  if (round2(sale.discountPercent) !== round2(input.discountPercent)) changes.push("discount");
  return changes;
}

/** The bill as Raigam has it, in the app's terms; a string says why it can't be */
function billInput(
  bill: RaigamBill & { lines: RaigamLine[] },
  itemOf: (raigamItemId: number) => string,
  data: SyncData,
  shopId: string,
  creditDays: number,
  sale: Sale | undefined,
): SaleInput | string {
  const lines = new Map<string, SaleLineInput>();
  const returns = new Map<string, SaleReturnInput>();
  for (const l of bill.lines) {
    const sapCode = itemOf(l.itemId);
    // Items taken off on Raigam stay on the bill (qty 0 if all of it), as on Raigam's bill;
    // a free item (only free issue, e.g. Coffee 50g free with Coffee 100g) is a line with qty 0
    if (l.qty > 0 || l.freeQty > 0 || l.takenOff > 0) {
      // Two Raigam items matched to one item here go on one line
      const had = lines.get(sapCode);
      if (had && (had.unitPrice !== l.unitPrice || had.discountPct !== l.discountPct))
        return `Two Raigam items are matched to ${sapCode} at different prices. Check the item matches.`;
      lines.set(
        sapCode,
        had
          ? { ...had, qty: had.qty + l.qty, freeQty: had.freeQty + l.freeQty, takenOff: had.takenOff + l.takenOff }
          : {
              sapCode,
              // An item already on the bill keeps its stock location
              locationNumber: sale?.lines.find((x) => x.sapCode === sapCode)?.locationNumber ?? stockLocationFor(sapCode, data),
              qty: l.qty,
              freeQty: l.freeQty,
              takenOff: l.takenOff,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
            },
      );
    }
    for (const [kind, qty, unitPrice] of [
      ["Good", l.goodQty, l.goodPrice],
      ["Market", l.marketQty, l.marketPrice],
    ] as const) {
      if (qty <= 0) continue;
      const key = `${kind}|${sapCode}`;
      const had = returns.get(key);
      if (had && had.unitPrice !== unitPrice) return `Two Raigam items are matched to ${sapCode} at different return prices. Check the item matches.`;
      returns.set(key, had ? { ...had, qty: had.qty + qty } : { kind, sapCode, qty, unitPrice });
    }
  }
  if (lines.size === 0 && returns.size > 0)
    return "Only return items, nothing sold: a bill here needs an item sold. Add the returns to the store's next bill.";
  if (lines.size === 0) return "No items on it on Raigam. Check Raigam again.";
  const unplaced = [...lines.values()].find((l) => !l.locationNumber);
  if (unplaced) return `${unplaced.sapCode} has no stock location. Set it on the Items page.`;
  return {
    invoiceNo: bill.invoiceNo,
    date: bill.date,
    shopId,
    repName: sale?.repName ?? "",
    discountPercent: bill.discountPct,
    // Set again when the bill is delivered (delivery date + the store's credit days)
    dueDate: sale && sale.dueDate >= bill.date ? sale.dueDate : addDays(bill.date, creditDays),
    notes: sale?.notes ?? "",
    lines: [...lines.values()],
    returns: [...returns.values()],
  };
}

/** What a sync does with each bill. `picks` (from the sync dialog) go before items matched earlier. */
export function planRaigamSync(data: SyncData, bills: RaigamBill[], picks: ItemPicks): SyncPlan {
  const codes = new Set(data.items.map((i) => i.sapCode));
  const linked = linkMap(data.raigamLinks, "Item");
  const itemOf = (id: number) => [picks[id], linked.get(id)].find((code) => !!code && codes.has(code)) ?? "";
  const stores = resolveStores(data, bills);
  const here = salesByInvoice(data.sales);
  const unmatched = new Map<number, { itemId: number; itemName: string; bills: number }>();

  const rows = bills.map((bill): SyncRow => {
    const sale = here.get(invoiceKey(bill.invoiceNo));
    if (sale?.status === "Delivered") return { bill, sale, action: "kept", note: "Delivered here" };
    if (sale?.status === "Cancelled") return { bill, sale, action: "kept", note: "Cancelled here" };
    if (bill.cancelled) {
      return sale ? { bill, sale, action: "update", cancel: true, note: "Cancelled on Raigam" } : { bill, action: "ignore", note: "Cancelled on Raigam" };
    }
    if (!bill.lines) return { bill, sale, action: "problem", note: "Its items weren't read from Raigam. Check Raigam again." };

    const missing = [...new Map(bill.lines.filter((l) => !itemOf(l.itemId)).map((l) => [l.itemId, l])).values()];
    if (missing.length) {
      for (const l of missing) {
        const entry = unmatched.get(l.itemId) ?? { itemId: l.itemId, itemName: l.itemName, bills: 0 };
        entry.bills++;
        unmatched.set(l.itemId, entry);
      }
      return { bill, sale, action: "problem", note: `Match ${missing.map((l) => l.itemName).join(", ")} to your items` };
    }

    const ref = stores.get(bill.outletId)!;
    const creditDays = data.shops.find((s) => s.id === ref.shopId)?.creditDays ?? NEW_STORE_CREDIT_DAYS;
    const input = billInput({ ...bill, lines: bill.lines }, itemOf, data, ref.shopId, creditDays, sale);
    if (typeof input === "string") return { bill, sale, action: "problem", note: input };

    const subtotal = saleSubtotal(input);
    const total = round2(subtotal - billDiscount(subtotal, input.discountPercent));
    const differentTotal = Math.abs(total - bill.total) > 0.05 ? total : undefined;
    if (!sale) {
      const status = allTakenOff(input)
        ? " · every item was taken off on Raigam, so Rs. 0"
        : bill.late
          ? " · late delivery on Raigam"
          : bill.delivered
            ? " · delivered on Raigam, deliver it here too"
            : "";
      return { bill, action: "add", input, late: bill.late, differentTotal, note: `New${status}` };
    }

    const changes = differences(sale, input);
    const late = bill.late && !sale.late;
    if (!changes.length && !late) return { bill, sale, action: "same", note: "No changes" };
    return {
      bill,
      sale,
      action: "update",
      input: changes.length ? input : undefined,
      late,
      differentTotal,
      note: `Changed on Raigam: ${[...changes, ...(late ? ["late delivery"] : [])].join(", ")}${
        changes.length && sale.checked ? ". Its Checked tick is cleared: check it again" : ""
      }`,
    };
  });

  return { rows, stores, unmatched: [...unmatched.values()] };
}

// ---------- Checking bills sent to the server ----------

const isWhole = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
const isAmount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const isText = (s: unknown): s is string => typeof s === "string";

function isRaigamLine(l: RaigamLine) {
  return (
    !!l &&
    isWhole(l.itemId) &&
    isText(l.itemName) &&
    [l.qty, l.freeQty, l.goodQty, l.marketQty, l.takenOff].every(isWhole) &&
    [l.unitPrice, l.goodPrice, l.marketPrice].every(isAmount) &&
    isAmount(l.discountPct) &&
    l.discountPct <= 100
  );
}

/** A bill as the sync dialog sends it: anything else is left out */
export function isRaigamBill(b: RaigamBill) {
  return (
    !!b &&
    typeof b === "object" &&
    isWhole(b.id) &&
    isText(b.invoiceNo) &&
    b.invoiceNo.trim() !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
    isWhole(b.outletId) &&
    isText(b.outletName) &&
    b.outletName.trim() !== "" &&
    isWhole(b.routeId) &&
    isText(b.routeName) &&
    typeof b.cancelled === "boolean" &&
    typeof b.late === "boolean" &&
    typeof b.delivered === "boolean" &&
    isAmount(b.discountPct) &&
    b.discountPct < 100 &&
    typeof b.total === "number" &&
    (b.lines === undefined || (Array.isArray(b.lines) && b.lines.every(isRaigamLine)))
  );
}
