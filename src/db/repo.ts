import { asc, eq, getTableColumns, inArray, sql, type Column, type Table } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { createStore } from "zustand/vanilla";
import { createCore, emptyData, pickData, type ActionName, type AppStore, type Data } from "@/lib/core";
import { claimConflict } from "@/lib/free-issues";
import { OPENING_BILL, type ExpenseCategory, type Order, type OrderItem, type Payment, type Result, type ReturnKind, type Sale, type WeekDay } from "@/lib/types";
import type { Db } from "./connect";
import * as t from "./schema";

// Moves data between Postgres and the app's shapes (src/lib/types.ts), and runs
// actions: load everything, apply the action's rules (src/lib/core.ts), then write
// back only the rows it changed — all in one transaction.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = Record<string, unknown>;

/**
 * Changes run one at a time under this lock, so two people can't, say, load the
 * same stock onto two lorries at once. The business is small enough that this never waits long.
 */
const WRITE_LOCK = sql`select pg_advisory_xact_lock(7240100)`;

/** "" in the app, NULL in the database (dates, optional text) */
const blank = (v: string | undefined) => v || null;
const unblank = (v: string | null) => v ?? "";

function omit<T extends object, K extends keyof T>(record: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...record };
  delete copy[key];
  return copy as Omit<T, K>;
}

/** Table columns minus `seq`, which only orders rows */
function columns<T extends Table>(table: T) {
  const cols: Record<string, Column> = { ...getTableColumns(table) };
  delete cols.seq;
  return cols as Omit<T["_"]["columns"], "seq">;
}

// ---------- Loading ----------

export async function loadData(tx: Tx): Promise<Data> {
  const [items, locations, stock, orders, orderInvoices, orderItems, routes, shops, sales, lines, payments, allocations, expenses, raigamReturns, raigamReturnLines, raigamLinks, freeClaims, freeClaimLines] = await Promise.all([
    tx.select(columns(t.items)).from(t.items).orderBy(asc(t.items.seq)),
    tx.select(columns(t.locations)).from(t.locations).orderBy(asc(t.locations.seq)),
    tx.select(columns(t.stock)).from(t.stock).orderBy(asc(t.stock.seq)),
    tx.select(columns(t.orders)).from(t.orders).orderBy(asc(t.orders.seq)),
    tx.select(columns(t.orderInvoices)).from(t.orderInvoices).orderBy(asc(t.orderInvoices.seq)),
    tx.select(columns(t.orderItems)).from(t.orderItems).orderBy(asc(t.orderItems.seq)),
    tx.select(columns(t.routes)).from(t.routes).orderBy(asc(t.routes.seq)),
    tx.select(columns(t.shops)).from(t.shops).orderBy(asc(t.shops.seq)),
    tx.select(columns(t.sales)).from(t.sales).orderBy(asc(t.sales.seq)),
    tx.select().from(t.saleLines).orderBy(asc(t.saleLines.saleId), asc(t.saleLines.position)),
    tx.select(columns(t.payments)).from(t.payments).orderBy(asc(t.payments.seq)),
    tx.select().from(t.paymentAllocations).orderBy(asc(t.paymentAllocations.paymentId), asc(t.paymentAllocations.position)),
    tx.select(columns(t.expenses)).from(t.expenses).orderBy(asc(t.expenses.seq)),
    tx.select(columns(t.raigamReturns)).from(t.raigamReturns).orderBy(asc(t.raigamReturns.seq)),
    tx.select().from(t.raigamReturnLines).orderBy(asc(t.raigamReturnLines.returnId), asc(t.raigamReturnLines.position)),
    tx.select(columns(t.raigamLinks)).from(t.raigamLinks).orderBy(asc(t.raigamLinks.seq)),
    tx.select(columns(t.freeClaims)).from(t.freeClaims).orderBy(asc(t.freeClaims.seq)),
    tx.select().from(t.freeClaimLines).orderBy(asc(t.freeClaimLines.claimId), asc(t.freeClaimLines.position)),
  ]);

  const linesBySale = Map.groupBy(lines, (l) => l.saleId);
  const allocationsByPayment = Map.groupBy(allocations, (a) => a.paymentId);
  const linesByReturn = Map.groupBy(raigamReturnLines, (l) => l.returnId);
  const linesByClaim = Map.groupBy(freeClaimLines, (l) => l.claimId);

  return {
    items,
    locations,
    stock: stock.map((r) => ({ ...r, lastUpdate: unblank(r.lastUpdate) })),
    orders: orders.map((r) => ({
      ...r,
      receivedDate: unblank(r.receivedDate),
      receivedTime: unblank(r.receivedTime),
      paymentMethod: r.paymentMethod as Order["paymentMethod"],
      paidDate: unblank(r.paidDate),
      chequeDepositDate: unblank(r.chequeDepositDate),
      requiredDate: unblank(r.requiredDate),
    })),
    orderInvoices: orderInvoices.map((r) => ({ ...r, invoiceDate: unblank(r.invoiceDate) })),
    orderItems: orderItems.map(({ postedLocation, invoiceId, ...r }): OrderItem => {
      const line = { ...r, invoiceId: unblank(invoiceId) };
      return postedLocation ? { ...line, postedLocation } : line;
    }),
    routes: routes.map((r) => ({ ...r, visitDays: r.visitDays as WeekDay[] })),
    shops,
    sales: sales.map(
      (r): Sale => ({
        ...r,
        loadedDate: unblank(r.loadedDate),
        deliveredDate: unblank(r.deliveredDate),
        // One table holds both: items sold ("Sale") and return items ("Good" / "Market")
        lines: (linesBySale.get(r.id) ?? [])
          .filter((l) => l.kind === "Sale")
          .map((l) => ({
            id: l.id,
            sapCode: l.sapCode,
            locationNumber: l.locationNumber,
            qty: l.qty,
            freeQty: l.freeQty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            cancelQty: l.cancelQty,
            takenOff: l.takenOff,
            missingQty: l.missingQty,
            note: l.note,
            freeWith: l.freeWith,
            costPrice: l.costPrice,
          })),
        returns: (linesBySale.get(r.id) ?? [])
          .filter((l) => l.kind !== "Sale")
          .map((l) => ({
            id: l.id,
            kind: l.kind as ReturnKind,
            sapCode: l.sapCode,
            qty: l.qty,
            unitPrice: l.unitPrice,
            costPrice: l.costPrice,
          })),
      }),
    ),
    payments: payments.map(
      (r): Payment => ({
        ...r,
        chequeDate: unblank(r.chequeDate),
        chequeCollectedDate: unblank(r.chequeCollectedDate),
        allocations: (allocationsByPayment.get(r.id) ?? []).map((a) => ({ saleId: a.saleId ?? OPENING_BILL, amount: a.amount })),
      }),
    ),
    expenses: expenses.map((r) => ({ ...r, category: r.category as ExpenseCategory })),
    raigamReturns: raigamReturns.map((r) => ({
      ...r,
      lines: (linesByReturn.get(r.id) ?? []).map((l) => ({ kind: l.kind, sapCode: l.sapCode, qty: l.qty })),
    })),
    raigamLinks,
    freeClaims: freeClaims.map((r) => ({
      ...r,
      paidDate: unblank(r.paidDate),
      lines: (linesByClaim.get(r.id) ?? []).map((l) => ({ saleId: l.saleId, sapCode: l.sapCode, qty: l.qty, value: l.value })),
    })),
  };
}

// ---------- Saving ----------

type IdTable = PgTable & { id: Column };
type Rec = { id: string };

type TableSpec = {
  key: keyof Data;
  table: IdTable;
  toRow: (r: Rec) => Row;
  /** Rows owned by a record (bill lines, payment links): rewritten whenever the record changes */
  children?: { table: PgTable; parent: Column; rows: (r: Rec) => Row[] };
};

function spec<K extends keyof Data>(
  key: K,
  table: IdTable,
  toRow: (r: Data[K][number]) => Row,
  children?: { table: PgTable; parent: Column; rows: (r: Data[K][number]) => Row[] },
): TableSpec {
  return { key, table, toRow: toRow as (r: Rec) => Row, children: children as TableSpec["children"] };
}

// Parents before children: inserts run in this order, deletes in reverse.
const SPECS: TableSpec[] = [
  spec("items", t.items, (r) => ({ ...r })),
  spec("locations", t.locations, (r) => ({ ...r })),
  spec("stock", t.stock, (r) => ({ ...r, lastUpdate: blank(r.lastUpdate) })),
  spec("orders", t.orders, (r) => ({
    ...r,
    receivedDate: blank(r.receivedDate),
    receivedTime: blank(r.receivedTime),
    paidDate: blank(r.paidDate),
    chequeDepositDate: blank(r.chequeDepositDate),
    requiredDate: blank(r.requiredDate),
  })),
  spec("orderInvoices", t.orderInvoices, (r) => ({ ...r, invoiceDate: blank(r.invoiceDate) })),
  spec("orderItems", t.orderItems, (r) => ({ ...r, invoiceId: blank(r.invoiceId), postedLocation: blank(r.postedLocation) })),
  spec("routes", t.routes, (r) => ({ ...r })),
  spec("shops", t.shops, (r) => ({ ...r })),
  spec(
    "sales",
    t.sales,
    (r) => ({ ...omit(omit(r, "lines"), "returns"), loadedDate: blank(r.loadedDate), deliveredDate: blank(r.deliveredDate) }),
    {
      table: t.saleLines,
      parent: t.saleLines.saleId,
      rows: (s) => [
        ...s.lines.map((l, position) => ({ ...l, kind: "Sale", saleId: s.id, position })),
        ...s.returns.map((r, i) => ({
          ...r,
          locationNumber: "",
          freeQty: 0,
          discountPct: 0,
          cancelQty: 0,
          takenOff: 0,
          missingQty: 0,
          note: "",
          freeWith: "",
          saleId: s.id,
          position: s.lines.length + i,
        })),
      ],
    },
  ),
  spec("payments", t.payments, (r) => ({ ...omit(r, "allocations"), chequeDate: blank(r.chequeDate), chequeCollectedDate: blank(r.chequeCollectedDate) }), {
    table: t.paymentAllocations,
    parent: t.paymentAllocations.paymentId,
    rows: (p) =>
      p.allocations.map((a, position) => ({
        paymentId: p.id,
        position,
        saleId: a.saleId === OPENING_BILL ? null : a.saleId,
        amount: a.amount,
      })),
  }),
  spec("expenses", t.expenses, (r) => ({ ...r })),
  spec("raigamReturns", t.raigamReturns, (r) => ({ ...omit(r, "lines") }), {
    table: t.raigamReturnLines,
    parent: t.raigamReturnLines.returnId,
    rows: (r) => r.lines.map((l, position) => ({ ...l, returnId: r.id, position })),
  }),
  spec("raigamLinks", t.raigamLinks, (r) => ({ ...r })),
  // After sales: its lines point at bills
  spec("freeClaims", t.freeClaims, (r) => ({ ...omit(r, "lines"), paidDate: blank(r.paidDate) }), {
    table: t.freeClaimLines,
    parent: t.freeClaimLines.claimId,
    rows: (r) => r.lines.map((l, position) => ({ ...l, claimId: r.id, position })),
  }),
];

const fingerprint = (s: TableSpec, r: Rec) => JSON.stringify([s.toRow(r), s.children?.rows(r)]);

function diff(s: TableSpec, before: Rec[], after: Rec[]) {
  const old = new Map(before.map((r) => [r.id, fingerprint(s, r)]));
  const kept = new Set(after.map((r) => r.id));
  return {
    added: after.filter((r) => !old.has(r.id)),
    changed: after.filter((r) => old.has(r.id) && old.get(r.id) !== fingerprint(s, r)),
    removed: before.filter((r) => !kept.has(r.id)).map((r) => r.id),
  };
}

/** Writes the differences between two snapshots; returns the tables that changed */
export async function saveChanges(tx: Tx, before: Data, after: Data): Promise<Partial<Data>> {
  const diffs = SPECS.map((s) => ({ s, ...diff(s, before[s.key], after[s.key]) }));

  // Deletes, children first: a bill's lines and payment links go before the bill
  for (const { s, changed, removed } of [...diffs].reverse()) {
    const rewrite = [...changed.map((r) => r.id), ...removed];
    if (s.children && rewrite.length) await tx.delete(s.children.table).where(inArray(s.children.parent, rewrite));
    if (removed.length) await tx.delete(s.table).where(inArray(s.table.id, removed));
  }

  // Inserts and updates, parents first
  for (const { s, added, changed } of diffs) {
    if (added.length) await tx.insert(s.table).values(added.map(s.toRow));
    for (const r of changed) {
      const { id, ...row } = s.toRow(r);
      await tx.update(s.table).set(row).where(eq(s.table.id, id));
    }
    const children = s.children && [...added, ...changed].flatMap(s.children.rows);
    if (s.children && children?.length) await tx.insert(s.children.table).values(children);
  }

  const changes: Partial<Data> = {};
  for (const { s, added, changed, removed } of diffs) {
    if (added.length || changed.length || removed.length) Object.assign(changes, { [s.key]: after[s.key] });
  }
  return changes;
}

// ---------- Entry points ----------

/** Everything, read as one consistent snapshot */
export function fetchData(db: Db): Promise<Data> {
  return db.transaction((tx) => loadData(tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}

export type ActionResponse = { result: Result; changes: Partial<Data> };

/**
 * Runs one action against the database. A failed check (result.ok false) changes
 * nothing; a database error rolls the whole action back and is thrown.
 */
export function applyAction(db: Db, name: ActionName, args: unknown[], today: string): Promise<ActionResponse> {
  return db.transaction(async (tx) => {
    await tx.execute(WRITE_LOCK);
    const before = await loadData(tx);
    const store = createStore<AppStore>()(createCore(() => today));
    store.setState(before);
    const action = store.getState()[name] as (...a: unknown[]) => Result;
    const result = action(...args);
    if (!result.ok) return { result, changes: {} };
    const after = pickData(store.getState());
    // Bills on a free issue claim keep the free issue claimed (unless they already didn't match before this change)
    const conflict = claimConflict(after.sales, after.freeClaims);
    if (conflict && conflict !== claimConflict(before.sales, before.freeClaims)) return { result: { ok: false, error: conflict }, changes: {} };
    const changes = await saveChanges(tx, before, after);
    return { result, changes };
  });
}

/** Replaces the whole database with `data` (restore a backup) */
export function replaceAll(db: Db, data: Data): Promise<Partial<Data>> {
  return db.transaction(async (tx) => {
    await tx.execute(WRITE_LOCK);
    const before = await loadData(tx);
    return saveChanges(tx, before, pickData({ ...emptyData(), ...data }));
  });
}
