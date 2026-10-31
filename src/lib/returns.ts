import { chargedQty, itemsTotal } from "./ledger";
import type { RaigamReturn, ReturnKind, Sale } from "./types";
import { formatQty, round2 } from "./utils";

// The return items store: good and market returns taken back from stores, kept apart from
// stock until they're sent back to Raigam. Nothing is saved for it; it's worked out from
// the bills (a return is collected when its bill is delivered) and the return notes sent.

export type ReturnStockRow = {
  key: string;
  kind: ReturnKind;
  sapCode: string;
  /** On bills not delivered yet */
  toCollect: number;
  /** Taken back with delivered bills */
  collected: number;
  /** What the stores were credited for the collected ones */
  collectedValue: number;
  /** Sent back to Raigam */
  sent: number;
  /** In the return items store now (collected − sent) */
  held: number;
};

export const returnKey = (kind: ReturnKind, sapCode: string) => `${kind}|${sapCode}`;

/** "1 unit", "12 units" */
export const formatUnits = (n: number) => `${formatQty(n)} unit${n === 1 ? "" : "s"}`;

/** Item + type -> what's to collect, collected, sent and held */
export function returnStock(sales: Sale[], raigamReturns: RaigamReturn[]): Map<string, ReturnStockRow> {
  const rows = new Map<string, ReturnStockRow>();
  const rowFor = (kind: ReturnKind, sapCode: string) => {
    const key = returnKey(kind, sapCode);
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { key, kind, sapCode, toCollect: 0, collected: 0, collectedValue: 0, sent: 0, held: 0 }));
    return row;
  };
  for (const s of sales) {
    if (s.status === "Cancelled") continue;
    for (const r of s.returns) {
      const row = rowFor(r.kind, r.sapCode);
      if (s.status === "Delivered") {
        row.collected += r.qty;
        row.collectedValue += r.qty * r.unitPrice;
      } else row.toCollect += r.qty;
    }
  }
  for (const note of raigamReturns) for (const l of note.lines) rowFor(l.kind, l.sapCode).sent += l.qty;
  for (const row of rows.values()) {
    row.collectedValue = round2(row.collectedValue);
    row.held = row.collected - row.sent;
  }
  return rows;
}

/** Value of what's held, at the average credit the stores got for that item */
export const heldValue = (row: ReturnStockRow) => (row.collected > 0 ? round2((row.collectedValue / row.collected) * row.held) : 0);

/** Why a change can't be made because it would take back returns already sent to Raigam, if it would */
export function sentMoreThanCollected(sales: Sale[], raigamReturns: RaigamReturn[]): string | null {
  for (const row of returnStock(sales, raigamReturns).values()) {
    if (row.held >= 0) continue;
    const kind = `${row.kind.toLowerCase()} return${row.sent === 1 ? "" : "s"}`;
    return `${row.sent} ${kind} of ${row.sapCode} ${row.sent === 1 ? "was" : "were"} already sent to Raigam, but only ${row.collected} would be left on delivered bills.`;
  }
  return null;
}

/** One bill's return line sent back to Raigam on a return note (all or part of it) */
export type SentFromBill = { sale: Sale; returnId: string; qty: number };
export type ReturnSentInfo = { sent: number; notes: RaigamReturn[] };

/**
 * Which bills' returns went on which return note. Notes only record units per item, so they're matched to the
 * collected returns oldest first (by delivery date, then bill no.), each note in the order it was sent.
 */
export function returnAllocations(sales: Sale[], raigamReturns: RaigamReturn[]) {
  const queues = new Map<string, { sale: Sale; returnId: string; left: number }[]>();
  const collected = sales
    .filter((s) => s.status === "Delivered")
    .sort((a, b) => a.deliveredDate.localeCompare(b.deliveredDate) || a.saleNo.localeCompare(b.saleNo));
  for (const s of collected) {
    for (const r of s.returns) {
      const key = returnKey(r.kind, r.sapCode);
      queues.set(key, [...(queues.get(key) ?? []), { sale: s, returnId: r.id, left: r.qty }]);
    }
  }
  const byReturn = new Map<string, ReturnSentInfo>();
  const byNote = new Map<string, SentFromBill[]>();
  const notes = [...raigamReturns].sort((a, b) => a.date.localeCompare(b.date) || a.returnNo.localeCompare(b.returnNo));
  for (const note of notes) {
    const from: SentFromBill[] = [];
    for (const l of note.lines) {
      let need = l.qty;
      for (const q of queues.get(returnKey(l.kind, l.sapCode)) ?? []) {
        if (need <= 0) break;
        const take = Math.min(need, q.left);
        if (take <= 0) continue;
        q.left -= take;
        need -= take;
        from.push({ sale: q.sale, returnId: q.returnId, qty: take });
        const info = byReturn.get(q.returnId) ?? { sent: 0, notes: [] };
        info.sent += take;
        if (!info.notes.includes(note)) info.notes.push(note);
        byReturn.set(q.returnId, info);
      }
    }
    byNote.set(note.id, from);
  }
  return { byReturn, byNote };
}

/** Returns against sales: value of return items ÷ value of items sold (before the bill discount), Good and Market apart */
export type ReturnRate = { sold: number; good: number; market: number; returned: number; pct: number; goodPct: number; marketPct: number };

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** Return rate over some bills (cancelled bills left out) */
export function returnRate(sales: Sale[]): ReturnRate {
  let sold = 0;
  let good = 0;
  let market = 0;
  for (const s of sales) {
    if (s.status === "Cancelled") continue;
    sold += itemsTotal(s);
    for (const r of s.returns) {
      if (r.kind === "Good") good += r.qty * r.unitPrice;
      else market += r.qty * r.unitPrice;
    }
  }
  const returned = good + market;
  return {
    sold: round2(sold),
    good: round2(good),
    market: round2(market),
    returned: round2(returned),
    pct: pctOf(returned, sold),
    goodPct: pctOf(good, sold),
    marketPct: pctOf(market, sold),
  };
}

/** "4.2%"; "—" when there were no sales to compare with */
export const formatPct = (pct: number, sold = 1) => (sold > 0 ? `${pct.toFixed(1)}%` : "—");

/** "Good 3.0% · Market 1.2%" */
export const returnSplit = (r: ReturnRate) => `Good ${formatPct(r.goodPct, r.sold)} · Market ${formatPct(r.marketPct, r.sold)}`;

/** Units sold per item (charged qty on bills not cancelled), to compare an item's returns with */
export function unitsSold(sales: Sale[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sales) {
    if (s.status === "Cancelled") continue;
    for (const l of s.lines) map.set(l.sapCode, (map.get(l.sapCode) ?? 0) + chargedQty(l));
  }
  return map;
}
