import type { Item } from "./types";

// Item categories are the sections of Raigam's goods order sheet (Item.sheetSection, e.g. "BLUE PACK SOYA").
// Lists show them in the sheet's order (by each section's first SN), items by their SN, then by name.
// Items not on the sheet come last: promo material and stationery (no price), then any item not given a
// category yet. (The user doesn't want an "other" group: every priced item has its own category.)

/** Posters, danglers, tape, log books…: free (no price) and not on Raigam's sheet */
export const PROMO_CATEGORY = "PROMO & STATIONERY";
/** A priced item with no category: set it on the Items page */
export const UNSET_CATEGORY = "NO CATEGORY YET";

export function categoryOf(item: Pick<Item, "sheetSection" | "wholesalePrice"> | undefined) {
  if (!item) return UNSET_CATEGORY;
  return item.sheetSection || (item.wholesalePrice > 0 ? UNSET_CATEGORY : PROMO_CATEGORY);
}

/** Last in lists: 0 for Raigam's sections, then promo & stationery, then no category yet */
const lastOrder = (name: string) => (name === PROMO_CATEGORY ? 1 : name === UNSET_CATEGORY ? 2 : 0);

/** Category -> its place in the list (sheet order) */
export function categoryRanks(items: Item[]): Map<string, number> {
  const firstSn = new Map<string, number>();
  for (const i of items) {
    const name = categoryOf(i);
    firstSn.set(name, Math.min(firstSn.get(name) ?? Infinity, i.sheetNo || Infinity));
  }
  // Sections with no SN on the sheet (Infinity − Infinity is NaN, which falls through) go by name
  const names = [...firstSn.keys()].sort((a, b) => lastOrder(a) - lastOrder(b) || firstSn.get(a)! - firstSn.get(b)! || a.localeCompare(b));
  return new Map(names.map((name, i) => [name, i]));
}

/** Sort by category (sheet order), then SN on the sheet, then name */
export function compareByCategory(ranks: Map<string, number>, a: Item | undefined, b: Item | undefined) {
  return (
    (ranks.get(categoryOf(a)) ?? ranks.size) - (ranks.get(categoryOf(b)) ?? ranks.size) ||
    (a?.sheetNo || Infinity) - (b?.sheetNo || Infinity) ||
    (a?.description ?? "").localeCompare(b?.description ?? "")
  );
}

/** Items to pick from, grouped by category: name, SAP code, and the category heading they're listed under */
export function itemPickOptions(items: Item[], ranks: Map<string, number> = categoryRanks(items)) {
  return [...items]
    .sort((a, b) => compareByCategory(ranks, a, b))
    .map((i) => ({ value: i.sapCode, label: i.description, description: i.sapCode, group: categoryOf(i) }));
}
