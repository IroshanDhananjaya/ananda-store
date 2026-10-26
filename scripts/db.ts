// Database helper commands (they read DATABASE_URL from .env.local):
//   pnpm db:migrate                 create / update the tables (SQL files in drizzle/)
//   pnpm db:seed                    fill an empty database with the sample data
//   pnpm db:backup                  save everything to backups/raigam-<date>-<time>.json
//   pnpm db:restore <file> --yes    replace everything in the database with a backup
//   pnpm db:clear --yes             delete all data (saves a backup first) to start fresh
//   pnpm db:import-items <file>     show which items a JSON item list would add / change
//   pnpm db:import-items <file> --yes   save them (saves a backup first)
//   pnpm db:import-load <file>      check a JSON Raigam invoice (a received load) and show what it adds to stock
//   pnpm db:import-load <file> --yes    save it, like Receive new load (saves a backup first)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import { connect } from "../src/db/connect";
import { applyAction, fetchData, replaceAll } from "../src/db/repo";
import { DATA_KEYS, emptyData, seedData, type Data } from "../src/lib/core";
import type { ItemInput, ReceiveLoadInput, StoreLocation } from "../src/lib/types";
import { formatDate, formatMoney, formatQty, invoiceDiscount, netUnitCost, nextOrderId, nowTime, round2, todayISO } from "../src/lib/utils";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: DATABASE_URL may come from the shell instead
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and add your Supabase connection string.");
  process.exit(1);
}

// onnotice: hide Postgres notices such as 'schema "drizzle" already exists, skipping'
const db = connect(url, { max: 1, onnotice: () => {} });
const [command, ...rest] = process.argv.slice(2);
const count = (data: Data) => DATA_KEYS.reduce((n, k) => n + data[k].length, 0);

async function migrate() {
  await runMigrations(db, { migrationsFolder: "drizzle" });
  console.log("Tables are up to date.");
}

async function seed() {
  const current = await fetchData(db);
  if (count(current) > 0 && !rest.includes("--force")) {
    throw new Error(`The database already has ${count(current)} records. Run "pnpm db:seed --force" to replace them with the sample data.`);
  }
  await replaceAll(db, seedData());
  console.log("Sample data loaded.");
}

async function backup() {
  const data = await fetchData(db);
  mkdirSync("backups", { recursive: true });
  // Time in the name so a second backup on the same day doesn't overwrite the first
  const file = `backups/raigam-${todayISO()}-${nowTime().replace(":", "")}.json`;
  writeFileSync(file, JSON.stringify({ app: "raigam-store", version: 1, exportedAt: new Date().toISOString(), data }, null, 2));
  console.log(`Saved ${count(data)} records to ${file}`);
}

async function restore() {
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Give the backup file, e.g. pnpm db:restore backups/raigam-2026-10-22.json --yes");
  const { app, data: saved } = JSON.parse(readFileSync(file, "utf8")) as { app?: string; data?: Partial<Data> };
  // A backup made before a table was added doesn't have it: that table starts empty
  const data = saved && { ...emptyData(), ...saved };
  if (app !== "raigam-store" || !data || !DATA_KEYS.every((k) => Array.isArray(data[k]))) throw new Error(`${file} is not a backup made by pnpm db:backup.`);
  if (!rest.includes("--yes")) {
    throw new Error(`This replaces everything in the database with the ${count(data)} records in ${file}. Add --yes to go ahead.`);
  }
  await replaceAll(db, data);
  console.log(`Restored ${count(data)} records from ${file}`);
}

async function clear() {
  if (!rest.includes("--yes")) throw new Error("This deletes ALL data in the database (a backup is saved first). Add --yes to go ahead.");
  await backup();
  await replaceAll(db, emptyData());
  console.log("All data deleted. The tables are empty and ready for fresh data.");
}

/**
 * One item in an item list file (e.g. typed up from a photo of a Raigam price list).
 * New SAP codes need every field except locationNumber (the stock location new loads
 * go to; left out = not set) and sheetSection / sheetNo (its section and SN on Raigam's
 * goods order sheet; left out = not on the sheet); for an item already in the database,
 * fields left out keep their current value.
 */
type ItemRow = Partial<ItemInput> & { sapCode: string };

const ITEM_FIELDS = ["description", "packageDetails", "uom", "costPrice", "wholesalePrice", "retailPrice", "locationNumber", "sheetSection", "sheetNo"] as const;
const PRICE_FIELDS = ["costPrice", "wholesalePrice", "retailPrice"] as const;

/** Finds a location by number, so "loc-001" finds "LOC - 001" */
function locationFinder(locations: StoreLocation[]) {
  const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  return (v: unknown) => locations.find((l) => squash(l.locationNumber) === squash(String(v ?? "")))?.locationNumber;
}

/** The item as the Items form would save it, or what's wrong with it */
function checkItemRow(row: ItemRow, current: ItemInput | undefined, findLocation: (v: unknown) => string | undefined): ItemInput | string {
  const merged = { packageDetails: "", locationNumber: "", sheetSection: "", sheetNo: 0, ...current, ...row };
  const locationNumber = merged.locationNumber ? findLocation(merged.locationNumber) : "";
  if (locationNumber === undefined) return `location "${merged.locationNumber}" doesn't exist`;
  const item: ItemInput = {
    sapCode: String(merged.sapCode ?? "").trim().toUpperCase(),
    description: String(merged.description ?? "").trim(),
    packageDetails: String(merged.packageDetails ?? "").trim(),
    uom: String(merged.uom ?? "").trim().toUpperCase(),
    costPrice: round2(Number(merged.costPrice)),
    wholesalePrice: round2(Number(merged.wholesalePrice)),
    retailPrice: round2(Number(merged.retailPrice)),
    locationNumber,
    sheetSection: String(merged.sheetSection ?? "").trim().toUpperCase(),
    sheetNo: Number(merged.sheetNo ?? 0),
  };
  if (!item.description) return "description is missing";
  if (!item.uom) return "UOM is missing";
  const badPrice = PRICE_FIELDS.find((f) => String(merged[f] ?? "").trim() === "" || !Number.isFinite(item[f]) || item[f] < 0);
  if (badPrice) return `${badPrice} must be a number, 0 or more`;
  if (!Number.isInteger(item.sheetNo) || item.sheetNo < 0) return "sheetNo must be a whole number, 0 or more";
  return item;
}

const showValue = (field: keyof ItemInput, value: string | number) =>
  typeof value === "number" && (PRICE_FIELDS as readonly string[]).includes(field) ? formatMoney(value) : `"${value}"`;

async function importItems() {
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Give the item list file, e.g. pnpm db:import-items items.json");
  const rows = JSON.parse(readFileSync(file, "utf8")) as ItemRow[];
  if (!Array.isArray(rows)) throw new Error(`${file} must be a JSON list of items.`);

  const { items, locations } = await fetchData(db);
  const bySapCode = new Map(items.map((i) => [i.sapCode, i]));
  const findLocation = locationFinder(locations);
  const seen = new Set<string>();
  const adds: ItemInput[] = [];
  const updates: { id: string; item: ItemInput; changes: string[] }[] = [];
  const problems: string[] = [];
  let unchanged = 0;

  rows.forEach((row, n) => {
    const sapCode = String(row?.sapCode ?? "").trim().toUpperCase();
    const where = `Row ${n + 1}${sapCode ? ` (${sapCode})` : ""}`;
    if (!sapCode) return problems.push(`${where}: SAP code is missing`);
    if (seen.has(sapCode)) return problems.push(`${where}: listed more than once`);
    seen.add(sapCode);

    const current = bySapCode.get(sapCode);
    const checked = checkItemRow({ ...row, sapCode }, current, findLocation);
    if (typeof checked === "string") return problems.push(`${where}: ${checked}`);
    if (!current) return adds.push(checked);

    const changes = ITEM_FIELDS.filter((f) => checked[f] !== current[f]).map(
      (f) => `${f} ${showValue(f, current[f])} → ${showValue(f, checked[f])}`,
    );
    if (changes.length) updates.push({ id: current.id, item: checked, changes });
    else unchanged++;
  });

  if (problems.length) throw new Error(`Nothing saved. Fix these in ${file}:\n  ${problems.join("\n  ")}`);

  for (const i of adds) {
    console.log(`+ ${i.sapCode}  ${i.description} ${i.packageDetails}  ${i.uom}  cost ${formatMoney(i.costPrice)}, wholesale ${formatMoney(i.wholesalePrice)}, retail ${formatMoney(i.retailPrice)}, location ${i.locationNumber || "not set"}`);
  }
  for (const u of updates) console.log(`~ ${u.item.sapCode}  ${u.changes.join(", ")}`);
  console.log(`\n${adds.length} new, ${updates.length} changed, ${unchanged} already the same.`);
  if (adds.length + updates.length === 0) return;
  if (!rest.includes("--yes")) {
    console.log("Nothing saved yet. Add --yes to save these.");
    return;
  }

  await backup();
  // Same rules as the Items page; each item is saved on its own
  for (const item of adds) {
    const { result } = await applyAction(db, "addItem", [item], todayISO());
    if (!result.ok) throw new Error(`${item.sapCode}: ${result.error} (items before this one were saved)`);
  }
  for (const { id, item } of updates) {
    const { result } = await applyAction(db, "updateItem", [id, item], todayISO());
    if (!result.ok) throw new Error(`${item.sapCode}: ${result.error} (items before this one were saved)`);
  }
  console.log(`Saved ${adds.length} new and ${updates.length} changed items.`);
}

/**
 * A load file, typed up from a photo of a Raigam invoice: one load, or a list of them.
 * `discountPercent` is the invoice's "Discount % for Total Invoice". `value` on a line,
 * `invoiceTotal` ("Total (Rs.)", before that discount), `discountTotal` and `grandTotal`
 * are what the invoice prints; they only check that the numbers were read right.
 * Each line goes to its item's stock location (set on the Items page, or with
 * locationNumber in pnpm db:import-items).
 */
type LoadLineRow = { itemCode: string; qty: number; unitPrice: number; discount?: number; value?: number };
type LoadRow = {
  invoiceNumber: string;
  poNumber?: string;
  deliveryDate: string;
  discountPercent?: number;
  invoiceTotal?: number;
  discountTotal?: number;
  grandTotal?: number;
  lines: LoadLineRow[];
};

/** A number from the file: "1,250.00" is 1250; missing or "" is NaN */
const toNum = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? NaN : Number(String(v).replace(/,/g, "")));

/** "2026-10-23" or "23/10/2026" → "2026-10-23"; null if it isn't a real date */
function toISODate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)?.slice(1) ?? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)?.slice(1).reverse();
  if (!parts) return null;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const lineValue = (l: { qty: number; unitPrice: number; discount: number }) => round2(l.qty * l.unitPrice - l.discount);
/** Within a cent (printed amounts are rounded) */
const sameMoney = (a: number, b: number) => Math.abs(a - b) <= 0.01;

async function importLoad() {
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Give the load file, e.g. pnpm db:import-load load.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as LoadRow | LoadRow[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (rows.length === 0) throw new Error(`${file} has no loads.`);

  const { items, locations, stock, orders } = await fetchData(db);
  if (locations.length === 0) throw new Error("There are no stock locations yet. Add one on the Stock Locations page first.");
  const bySapCode = new Map(items.map((i) => [i.sapCode, i]));
  const findLocation = locationFinder(locations);
  const invoices = new Map(orders.map((o) => [o.invoiceNumber.trim().toUpperCase(), o.orderId]));
  const orderIds = orders.map((o) => ({ orderId: o.orderId }));
  // Stock and cost prices as they'll be after each load, for the preview
  const stockQty = new Map(stock.map((r) => [`${r.sapCode}|${r.locationNumber}`, r.availableQty]));
  const costPrice = new Map(items.map((i) => [i.sapCode, i.costPrice]));
  const loads: ReceiveLoadInput[] = [];
  const preview: string[] = [];
  const problems: string[] = [];

  rows.forEach((row, n) => {
    const invoiceNumber = String(row?.invoiceNumber ?? "").trim();
    const where = `Load ${n + 1}${invoiceNumber ? ` (${invoiceNumber})` : ""}`;
    const problem = (msg: string) => problems.push(`${where}: ${msg}`);
    const before = problems.length;

    const enteredAs = invoices.get(invoiceNumber.toUpperCase());
    if (!invoiceNumber) problem("invoiceNumber is missing");
    else if (enteredAs) problem(`this invoice is already entered as ${enteredAs}`);
    const deliveryDate = toISODate(row?.deliveryDate);
    if (!deliveryDate) problem(`deliveryDate "${row?.deliveryDate ?? ""}" isn't a date (use 2026-10-23 or 23/10/2026)`);
    const discountPercent = row?.discountPercent === undefined ? 0 : toNum(row.discountPercent);
    if (!(discountPercent >= 0 && discountPercent < 100)) problem("discountPercent must be a number from 0 to 99.99");
    const lineRows = Array.isArray(row?.lines) ? row.lines : [];
    if (lineRows.length === 0) problem("no items");

    const seen = new Set<string>();
    const lines: ReceiveLoadInput["lines"] = [];
    lineRows.forEach((l, i) => {
      const itemCode = String(l?.itemCode ?? "").trim().toUpperCase();
      const at = `item ${i + 1}${itemCode ? ` (${itemCode})` : ""}`;
      if (!itemCode) return problem(`${at}: SAP code is missing`);
      if (!bySapCode.has(itemCode)) return problem(`${at}: not in Items (add it first with pnpm db:import-items)`);
      if (seen.has(itemCode)) return problem(`${at}: listed more than once`);
      seen.add(itemCode);

      const qty = toNum(l.qty);
      const unitPrice = toNum(l.unitPrice);
      const discount = l.discount === undefined ? 0 : toNum(l.discount);
      if (!Number.isInteger(qty) || qty <= 0) return problem(`${at}: qty must be a whole number above 0`);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return problem(`${at}: unitPrice must be a number, 0 or more`);
      if (!Number.isFinite(discount) || discount < 0) return problem(`${at}: discount must be a number, 0 or more`);
      const value = lineValue({ qty, unitPrice, discount });
      if (value < 0) return problem(`${at}: discount is more than qty × price`);
      if (l.value !== undefined && !sameMoney(toNum(l.value), value)) {
        return problem(`${at}: ${qty} × ${formatMoney(unitPrice)} − ${formatMoney(discount)} = ${formatMoney(value)}, but the invoice says ${formatMoney(toNum(l.value))}`);
      }

      if (!findLocation(bySapCode.get(itemCode)!.locationNumber)) {
        return problem(`${at}: has no stock location (set it on the Items page, or with locationNumber in pnpm db:import-items)`);
      }
      lines.push({ itemCode, qty, unitPrice, discount });
    });

    const total = round2(lines.reduce((sum, l) => sum + lineValue(l), 0));
    const { discount, total: grandTotal } = invoiceDiscount(total, discountPercent);
    const printed = [
      ["the items add up to", total, row?.invoiceTotal, "the invoice total"],
      [`${discountPercent}% of that is`, discount, row?.discountTotal, "the discount total"],
      ["the grand total works out to", grandTotal, row?.grandTotal, "the invoice grand total"],
    ] as const;
    for (const [what, worked, onInvoice, name] of printed) {
      if (onInvoice === undefined || problems.length > before || sameMoney(toNum(onInvoice), worked)) continue;
      problem(`${what} ${formatMoney(worked)}, but ${name} is ${formatMoney(toNum(onInvoice))}`);
    }
    if (problems.length > before) return;

    const poNumber = String(row.poNumber ?? "").trim();
    const orderId = nextOrderId(orderIds);
    orderIds.push({ orderId });
    invoices.set(invoiceNumber.toUpperCase(), orderId);
    loads.push({ invoiceNumber, poNumber, deliveryDate: deliveryDate!, discountPercent, lines });

    preview.push(`${orderId}  invoice ${invoiceNumber}${poNumber ? `, PO ${poNumber}` : ""}, delivered ${formatDate(deliveryDate!)}`);
    for (const l of lines) {
      const item = bySapCode.get(l.itemCode)!;
      const key = `${l.itemCode}|${item.locationNumber}`;
      const was = stockQty.get(key) ?? 0;
      stockQty.set(key, was + l.qty);
      // Same as receiveLoad: cost price becomes the net price per unit (free items keep theirs)
      const oldCost = costPrice.get(l.itemCode)!;
      const newCost = l.unitPrice > 0 ? netUnitCost(l, discountPercent) : oldCost;
      costPrice.set(l.itemCode, newCost);
      preview.push(
        `  + ${formatQty(l.qty)} × ${l.itemCode}  ${item.description} ${item.packageDetails}  @ ${formatMoney(l.unitPrice)}` +
          `${l.discount ? ` − ${formatMoney(l.discount)}` : ""} = ${formatMoney(lineValue(l))}` +
          `  → ${item.locationNumber} (stock ${formatQty(was)} → ${formatQty(was + l.qty)})` +
          `${newCost !== oldCost ? `, cost ${formatMoney(oldCost)} → ${formatMoney(newCost)}` : ""}`,
      );
    }
    const units = formatQty(lines.reduce((q, l) => q + l.qty, 0));
    preview.push(
      discountPercent
        ? `  ${units} units, total ${formatMoney(total)} − ${discountPercent}% (${formatMoney(discount)}) = grand total ${formatMoney(grandTotal)}\n`
        : `  ${units} units, invoice value ${formatMoney(total)}\n`,
    );
  });

  if (problems.length) throw new Error(`Nothing saved. Fix these in ${file}:\n  ${problems.join("\n  ")}`);

  console.log(preview.join("\n"));
  const loadsText = `${loads.length} load${loads.length === 1 ? "" : "s"}`;
  if (!rest.includes("--yes")) {
    console.log(`${loadsText} ready. Nothing saved yet. Add --yes to save and add to stock.`);
    return;
  }

  await backup();
  // Same rules as Receive new load; each load is saved on its own
  for (const [n, load] of loads.entries()) {
    const { result } = await applyAction(db, "receiveLoad", [load], todayISO());
    if (!result.ok) throw new Error(`Invoice ${load.invoiceNumber}: ${result.error}${n ? " (loads before this one were saved)" : ""}`);
  }
  console.log(`Saved ${loadsText}: stock and cost prices are updated.`);
}

const commands: Record<string, () => Promise<void>> = {
  migrate,
  seed,
  backup,
  restore,
  clear,
  "import-items": importItems,
  "import-load": importLoad,
};

async function main() {
  try {
    const run = commands[command];
    if (!run) throw new Error(`Use one of: ${Object.keys(commands).join(", ")}`);
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}

void main();
