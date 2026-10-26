import { Badge } from "@/components/ui/badge";
import { chargedQty, isRemoved, wholesaleDifference } from "@/lib/ledger";
import { allTakenOff } from "@/lib/raigam";
import type { Item, Sale } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

/** Items charged on the bill at a price other than their wholesale price */
export function priceDifferences(sale: Sale, itemMap: Map<string, Item>) {
  return sale.lines.filter((l) => chargedQty(l) > 0 && wholesaleDifference(l.unitPrice, itemMap.get(l.sapCode)?.wholesalePrice) !== 0).length;
}

/** Notes on a bill in a list: every item taken off on Raigam, items removed or reduced, credit added at delivery, items priced differently from wholesale */
export function BillFlags({ sale, itemMap }: { sale: Sale; itemMap: Map<string, Item> }) {
  const empty = allTakenOff(sale);
  const prices = priceDifferences(sale, itemMap);
  const removed = sale.lines.filter(isRemoved).length;
  const reduced = sale.lines.filter((l) => l.missingQty > 0 && !isRemoved(l)).length;
  if (!empty && !prices && !removed && !reduced && !sale.extraCredit) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {empty && (
        <span title="Every item on this bill was taken off on Raigam: nothing to load">
          <Badge tone="red">All items taken off</Badge>
        </span>
      )}
      {removed > 0 && (
        <span title="Items removed from the bill (e.g. not in our store): not loaded, not charged. Open the bill to see them.">
          <Badge tone="red">{removed === 1 ? "1 item removed" : `${removed} items removed`}</Badge>
        </span>
      )}
      {reduced > 0 && (
        <span title="Items with a reduced qty (e.g. not enough in our store). Open the bill to see them.">
          <Badge tone="amber">{reduced === 1 ? "1 item reduced" : `${reduced} items reduced`}</Badge>
        </span>
      )}
      {sale.extraCredit > 0 && (
        <span title="Credit amount added at delivery: collected with this bill, not part of its invoice value">
          <Badge tone="blue">+ {formatMoney(sale.extraCredit)} credit</Badge>
        </span>
      )}
      {prices > 0 && (
        <span title="Items priced differently from your wholesale price. Open the bill to see them.">
          <Badge tone="amber">{prices === 1 ? "1 price differs" : `${prices} prices differ`}</Badge>
        </span>
      )}
    </span>
  );
}
