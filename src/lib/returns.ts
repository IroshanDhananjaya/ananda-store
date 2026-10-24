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
