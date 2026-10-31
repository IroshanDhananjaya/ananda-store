import { chargedQty, freeGiven } from "./ledger";
import type { FreeClaim, FreeClaimLine, Sale, SaleLine } from "./types";
import { round2 } from "./utils";

// Free issue: units given free on bills under Raigam's scheme (not charged; Raigam pays it back).
// Claims (FreeClaim) record what was claimed for which bills, and lock those bills' free issue.

/**
 * Units given free on a line: its free issue (a free item is a line with only free issue), plus a line priced 0
 * (as on the loading list), less what was missing at loading or the store didn't take
 */
export const freeOf = (l: SaleLine) => freeGiven(l) + (l.unitPrice === 0 ? chargedQty(l) : 0);
/** Free issue at the bill's price (what it would have cost the store) */
export const freeValueOf = (l: SaleLine) => round2(freeGiven(l) * l.unitPrice);

/** A bill's free issue per item (an item may be on a bill from more than one location), items with none left out */
export function billFreeIssue(sale: Sale): Omit<FreeClaimLine, "saleId">[] {
  const bySap = new Map<string, { sapCode: string; qty: number; value: number }>();
  for (const l of sale.lines) {
    const qty = freeOf(l);
    if (qty <= 0) continue;
    const row = bySap.get(l.sapCode) ?? { sapCode: l.sapCode, qty: 0, value: 0 };
    row.qty += qty;
    row.value = round2(row.value + freeValueOf(l));
    bySap.set(l.sapCode, row);
  }
  return [...bySap.values()];
}

/** Bill id -> the claim it's on */
export function claimBySale(claims: FreeClaim[]): Map<string, FreeClaim> {
  const map = new Map<string, FreeClaim>();
  for (const c of claims) for (const l of c.lines) map.set(l.saleId, c);
  return map;
}

export const claimUnits = (c: FreeClaim) => c.lines.reduce((n, l) => n + l.qty, 0);
export const claimValue = (c: FreeClaim) => round2(c.lines.reduce((n, l) => n + l.value, 0));
export const claimBillCount = (c: FreeClaim) => new Set(c.lines.map((l) => l.saleId)).size;
export const isClaimPaid = (c: FreeClaim) => c.paidDate !== "";

/**
 * Why the bills no longer match their claims, if they don't: a bill on a claim must stay delivered with the same
 * free issue (units per item) as claimed. Checked after every change (src/db/repo.ts).
 */
export function claimConflict(sales: Sale[], claims: FreeClaim[]): string | null {
  const saleMap = new Map(sales.map((s) => [s.id, s]));
  for (const c of claims) {
    for (const saleId of new Set(c.lines.map((l) => l.saleId))) {
      const sale = saleMap.get(saleId);
      const fix = `Delete claim ${c.claimNo} first (Free Issues > Claims), then make the change and claim the bill again.`;
      if (!sale) return `A bill on free issue claim ${c.claimNo} can't be deleted. ${fix}`;
      if (sale.status !== "Delivered") return `Bill ${sale.saleNo} is on free issue claim ${c.claimNo}, so it must stay delivered. ${fix}`;
      const claimed = new Map(c.lines.filter((l) => l.saleId === saleId).map((l) => [l.sapCode, l.qty]));
      const now = billFreeIssue(sale);
      const same = now.length === claimed.size && now.every((r) => claimed.get(r.sapCode) === r.qty);
      if (!same) return `Bill ${sale.saleNo} is on free issue claim ${c.claimNo}, so its free issue can't change. ${fix}`;
    }
  }
  return null;
}
