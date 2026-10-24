"use client";

import { ArrowRight, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader, TableFooter } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useItemMap, useLastInvoicePrices } from "@/lib/store";
import type { StockRecord } from "@/lib/types";
import { cn, CRITICAL_STOCK_LEVEL, formatMoney, formatQty, LOW_STOCK_LEVEL } from "@/lib/utils";

/** New purchase order that starts with these items */
const newOrderHref = (codes: string[]) => `/orders/new?items=${encodeURIComponent(codes.join(","))}`;

/**
 * Stock records at or below the low level, with the quantity bills waiting to load need.
 * Tick items (or use a row's Order button) to start a Raigam purchase order with them.
 */
export function LowStockCard({ rows, needed }: { rows: StockRecord[]; needed: Map<string, number> }) {
  const router = useRouter();
  const itemMap = useItemMap();
  const lastPrice = useLastInvoicePrices();
  // Ticked SAP codes; an item kept at two locations is one tick
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pager = usePagination(rows);

  const codes = [...new Set(rows.map((r) => r.sapCode))];
  const chosen = codes.filter((c) => picked.has(c));
  const allPicked = codes.length > 0 && chosen.length === codes.length;

  const toggle = (code: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <Card>
      <CardHeader
        title="Low stock"
        description={`Out of stock · critical (≤ ${CRITICAL_STOCK_LEVEL} left) · low (≤ ${LOW_STOCK_LEVEL} left). Tick items to order them from Raigam.`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/stock" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Stock <ArrowRight className="size-4" />
            </Link>
            <Button size="sm" disabled={chosen.length === 0} onClick={() => router.push(newOrderHref(chosen))}>
              <ShoppingCart /> Create order{chosen.length ? ` (${chosen.length})` : ""}
            </Button>
          </div>
        }
      />
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() => setPicked(allPicked ? new Set() : new Set(codes))}
                disabled={codes.length === 0}
                className="size-4 cursor-pointer accent-white"
                aria-label="Select all items"
              />
            </TH>
            <TH>Item</TH>
            <TH>Location</TH>
            <TH className="text-right">Left</TH>
            <TH className="text-right" title="Quantity on bills waiting to load">
              For bills to load
            </TH>
            <TH className="text-right">Last Raigam price</TH>
            <TH>Level</TH>
            <TH>
              <span className="sr-only">Order</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={8}>No items are running low.</EmptyRow>}
          {pager.pageRows.map((r) => {
            const item = itemMap.get(r.sapCode);
            const need = needed.get(`${r.sapCode}|${r.locationNumber}`) ?? 0;
            const level = r.availableQty === 0 ? "Out of stock" : r.availableQty <= CRITICAL_STOCK_LEVEL ? "Critical" : "Low";
            const price = lastPrice.get(r.sapCode);
            const isPicked = picked.has(r.sapCode);
            return (
              <TR key={r.id} className={cn("cursor-pointer", isPicked && "bg-brand-50/70")} onClick={() => toggle(r.sapCode)}>
                <TD onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => toggle(r.sapCode)}
                    className="size-4 cursor-pointer accent-brand-600"
                    aria-label={`Select ${item?.description ?? r.sapCode}`}
                  />
                </TD>
                <TD className="whitespace-normal">
                  <span className="block font-medium text-slate-900">{item?.description ?? r.sapCode}</span>
                  <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                </TD>
                <TD>{r.locationNumber}</TD>
                <TD className="text-right font-semibold text-slate-900 tabular-nums">
                  {formatQty(r.availableQty)} <span className="font-normal text-slate-500">{item?.uom}</span>
                </TD>
                <TD className={cn("text-right tabular-nums", need > r.availableQty ? "font-semibold text-red-600" : "text-slate-600")}>
                  {need > 0 ? (
                    <>
                      {formatQty(need)}
                      {need > r.availableQty && <span className="block text-xs">short by {formatQty(need - r.availableQty)}</span>}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TD>
                <TD className="text-right tabular-nums">
                  {price !== undefined ? (
                    formatMoney(price)
                  ) : (
                    // Promo / stationery items come free on the invoice (price 0)
                    <span className="text-xs text-slate-400">{item && item.wholesalePrice === 0 ? "Free item" : "Not on an invoice yet"}</span>
                  )}
                </TD>
                <TD>
                  <Badge tone={level === "Low" ? "amber" : "red"}>{level}</Badge>
                </TD>
                <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Link href={newOrderHref([r.sapCode])} className={buttonClass("secondary", "sm")}>
                    Order
                  </Link>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {rows.length > 0 && (
        <TableFooter pager={<Pagination pager={pager} />}>
          {formatQty(codes.length)} item{codes.length === 1 ? "" : "s"} running low
          {chosen.length > 0 && (
            <>
              {" "}
              · <span className="font-medium text-slate-700">{chosen.length} ticked</span>{" "}
              <button type="button" onClick={() => setPicked(new Set())} className="font-medium text-brand-700 hover:underline">
                Clear
              </button>
            </>
          )}
        </TableFooter>
      )}
    </Card>
  );
}
