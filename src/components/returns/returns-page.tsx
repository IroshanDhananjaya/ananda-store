"use client";

import { Eye, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ReturnKindBadge } from "@/components/sales/return-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, DateRangeInputs, FilterTabs, inDateRange, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar, type DateRange } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUnits, heldValue, returnStock, type ReturnStockRow } from "@/lib/returns";
import { useAppStore, useItemMap, useShopMap } from "@/lib/store";
import type { RaigamReturn, ReturnKind } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { formatDate, formatMoney, formatQty, includesText, round2 } from "@/lib/utils";
import { ReturnNoteDialog, SendReturnsDialog } from "./return-dialogs";

// Return items store: good and market returns taken back from stores (on delivered bills),
// kept apart from stock until they're sent back to Raigam on a return note.

type Tab = "store" | "bills" | "sent";
type KindFilter = "all" | ReturnKind;

const sumOf = (rows: ReturnStockRow[], pick: (r: ReturnStockRow) => number, kind?: ReturnKind) =>
  rows.reduce((n, r) => n + (!kind || r.kind === kind ? pick(r) : 0), 0);
const unitsOn = (note: RaigamReturn, kind?: ReturnKind) => note.lines.reduce((n, l) => n + (!kind || l.kind === kind ? l.qty : 0), 0);

export function ReturnsPage() {
  const sales = useAppStore((s) => s.sales);
  const raigamReturns = useAppStore((s) => s.raigamReturns);
  const deleteRaigamReturn = useAppStore((s) => s.deleteRaigamReturn);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const [tab, setTab] = useState<Tab>("store");
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  const send = useDialog<true>();
  const view = useDialog<RaigamReturn>();
  const remove = useDialog<RaigamReturn>();

  const stockRows = useMemo(() => [...returnStock(sales, raigamReturns).values()], [sales, raigamReturns]);
  const heldUnits = sumOf(stockRows, (r) => r.held);
  const heldTotal = round2(stockRows.reduce((sum, r) => sum + heldValue(r), 0));
  const toCollectUnits = sumOf(stockRows, (r) => r.toCollect);
  const billsToCollect = sales.filter((s) => (s.status === "Ordered" || s.status === "Loaded") && s.returns.length > 0).length;
  const sentUnits = sumOf(stockRows, (r) => r.sent);
  const ofKind = (k: ReturnKind) => kind === "all" || kind === k;
  const itemText = (sapCode: string) => [sapCode, itemMap.get(sapCode)?.description];

  // In Return Items: per item and type
  const storeRows = stockRows
    .filter((r) => r.held > 0 || r.toCollect > 0)
    .filter((r) => ofKind(r.kind) && includesText(itemText(r.sapCode), query))
    .sort((a, b) => a.sapCode.localeCompare(b.sapCode) || a.kind.localeCompare(b.kind));

  // From bills: every return line, newest first (a delivered bill's by its delivery date)
  const billRows = sales
    .filter((s) => s.status !== "Cancelled")
    .flatMap((s) =>
      s.returns.map((r) => ({ sale: s, ret: r, collected: s.status === "Delivered", date: s.status === "Delivered" ? s.deliveredDate : s.date })),
    )
    .filter((x) => ofKind(x.ret.kind) && inDateRange(x.date, range))
    .filter((x) => includesText([...itemText(x.ret.sapCode), x.sale.saleNo, x.sale.invoiceNo, shopMap.get(x.sale.shopId)?.shopName], query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.sale.saleNo.localeCompare(a.sale.saleNo));
  const billPager = usePagination(billRows, [query, kind, range]);

  // Sent to Raigam: return notes, newest first
  const sentRows = raigamReturns
    .filter((n) => inDateRange(n.date, range))
    .filter((n) => includesText([n.returnNo, n.reference, n.notes, ...n.lines.flatMap((l) => itemText(l.sapCode))], query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.returnNo.localeCompare(a.returnNo));
  const sentPager = usePagination(sentRows, [query, range]);

  return (
    <>
      <PageHeader
        title="Return Items"
        description="Good and market returns taken back from stores. They're kept here, apart from stock, until you send them back to Raigam."
        actions={
          <Button onClick={() => send.open(true)} disabled={heldUnits === 0}>
            <Send /> Send to Raigam
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryTile
          label="In Return Items"
          value={formatUnits(heldUnits)}
          sub={`Good ${formatQty(sumOf(stockRows, (r) => r.held, "Good"))} · Market ${formatQty(sumOf(stockRows, (r) => r.held, "Market"))} · ${formatMoney(heldTotal)}`}
        />
        <SummaryTile label="To collect" value={formatUnits(toCollectUnits)} sub={`On ${billsToCollect} bill${billsToCollect === 1 ? "" : "s"} not delivered yet`} />
        <SummaryTile label="Sent to Raigam" value={formatUnits(sentUnits)} sub={`${raigamReturns.length} return note${raigamReturns.length === 1 ? "" : "s"}`} />
      </div>

      <Card>
        <Toolbar>
          <FilterTabs<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "store", label: "In Return Items", count: stockRows.filter((r) => r.held > 0 || r.toCollect > 0).length },
              { value: "bills", label: "From bills", count: sales.filter((s) => s.status !== "Cancelled").reduce((n, s) => n + s.returns.length, 0) },
              { value: "sent", label: "Sent to Raigam", count: raigamReturns.length },
            ]}
          />
          <SearchInput
            placeholder={tab === "sent" ? "Search note no., reference or item" : tab === "bills" ? "Search item, store or bill" : "Search item"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {tab !== "sent" && (
            <FilterTabs<KindFilter>
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "All types" },
                { value: "Good", label: "Good" },
                { value: "Market", label: "Market" },
              ]}
            />
          )}
          {tab !== "store" && <DateRangeInputs value={range} onChange={setRange} />}
        </Toolbar>

        {tab === "store" && (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH>Type</TH>
                  <TH className="text-right">To Collect</TH>
                  <TH className="text-right">Collected</TH>
                  <TH className="text-right">Sent to Raigam</TH>
                  <TH className="text-right">In Return Items</TH>
                  <TH className="text-right">Value</TH>
                </tr>
              </THead>
              <TBody>
                {storeRows.length === 0 && (
                  <EmptyRow colSpan={7}>
                    {query || kind !== "all" ? "No return items match." : "Nothing here yet. Returns on delivered bills show here until you send them to Raigam."}
                  </EmptyRow>
                )}
                {storeRows.map((r) => (
                  <TR key={r.key}>
                    <TD className="whitespace-normal">
                      <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? "Unknown item"}</span>
                      <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                    </TD>
                    <TD>
                      <ReturnKindBadge kind={r.kind} />
                    </TD>
                    <TD className="text-right text-slate-500 tabular-nums">{r.toCollect ? formatQty(r.toCollect) : "—"}</TD>
                    <TD className="text-right tabular-nums">{r.collected ? formatQty(r.collected) : "—"}</TD>
                    <TD className="text-right tabular-nums">{r.sent ? formatQty(r.sent) : "—"}</TD>
                    <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.held)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(heldValue(r))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter>
              {storeRows.length} line{storeRows.length === 1 ? "" : "s"} · {formatUnits(sumOf(storeRows, (r) => r.held))} in Return Items ·{" "}
              {formatMoney(round2(storeRows.reduce((sum, r) => sum + heldValue(r), 0)))} (as credited to stores)
            </TableFooter>
          </>
        )}

        {tab === "bills" && (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Bill No.</TH>
                  <TH>Store</TH>
                  <TH>Item</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Credit</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {billRows.length === 0 && (
                  <EmptyRow colSpan={8}>
                    {query || kind !== "all" || range.from || range.to
                      ? "No return items match."
                      : "No return items on bills yet. Add them on a bill (Return items) or when delivering it."}
                  </EmptyRow>
                )}
                {billPager.pageRows.map(({ sale, ret, collected, date }) => (
                  <TR key={`${sale.id}|${ret.id}`}>
                    <TD className="tabular-nums">{formatDate(date)}</TD>
                    <TD>
                      <Link href={`/sales/${sale.id}`} className="font-medium text-brand-700 hover:underline">
                        {sale.saleNo}
                      </Link>
                      {sale.invoiceNo && <span className="block text-xs text-slate-500">{sale.invoiceNo}</span>}
                    </TD>
                    <TD className="whitespace-normal">{shopMap.get(sale.shopId)?.shopName ?? "—"}</TD>
                    <TD className="whitespace-normal">
                      <span className="block font-medium text-slate-900">{itemMap.get(ret.sapCode)?.description ?? "Unknown item"}</span>
                      <span className="block font-mono text-xs text-slate-500">{ret.sapCode}</span>
                    </TD>
                    <TD>
                      <ReturnKindBadge kind={ret.kind} />
                    </TD>
                    <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(ret.qty)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(round2(ret.qty * ret.unitPrice))}</TD>
                    <TD>{collected ? <Badge tone="green">Collected</Badge> : <Badge tone="amber">To collect</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter pager={<Pagination pager={billPager} />}>
              {billRows.length} line{billRows.length === 1 ? "" : "s"} · {formatUnits(billRows.reduce((n, x) => n + x.ret.qty, 0))} ·{" "}
              {formatMoney(round2(billRows.reduce((sum, x) => sum + x.ret.qty * x.ret.unitPrice, 0)))} credited
            </TableFooter>
          </>
        )}

        {tab === "sent" && (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Return No.</TH>
                  <TH>Date Sent</TH>
                  <TH>Raigam Ref.</TH>
                  <TH className="text-right">Good</TH>
                  <TH className="text-right">Market</TH>
                  <TH>Note</TH>
                  <TH className="w-24">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {sentRows.length === 0 && (
                  <EmptyRow colSpan={7}>
                    {query || range.from || range.to ? "No return notes match." : "No return notes yet. Use Send to Raigam when you send return items back."}
                  </EmptyRow>
                )}
                {sentPager.pageRows.map((n) => (
                  <TR key={n.id}>
                    <TD className="font-medium text-slate-900">{n.returnNo}</TD>
                    <TD className="tabular-nums">{formatDate(n.date)}</TD>
                    <TD>{n.reference || "—"}</TD>
                    <TD className="text-right tabular-nums">{unitsOn(n, "Good") ? formatQty(unitsOn(n, "Good")) : "—"}</TD>
                    <TD className="text-right tabular-nums">{unitsOn(n, "Market") ? formatQty(unitsOn(n, "Market")) : "—"}</TD>
                    <TD className="max-w-64 truncate">{n.notes || "—"}</TD>
                    <TD>
                      <RowActions>
                        <Button variant="ghost" size="icon" onClick={() => view.open(n)} title="View" aria-label={`View ${n.returnNo}`}>
                          <Eye />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-red-50 hover:text-red-600"
                          onClick={() => remove.open(n)}
                          title="Delete"
                          aria-label={`Delete ${n.returnNo}`}
                        >
                          <Trash2 />
                        </Button>
                      </RowActions>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter pager={<Pagination pager={sentPager} />}>
              {sentRows.length} return note{sentRows.length === 1 ? "" : "s"} · {formatUnits(sentRows.reduce((n, x) => n + unitsOn(x), 0))}
            </TableFooter>
          </>
        )}
      </Card>

      <SendReturnsDialog open={send.isOpen} onClose={send.close} />
      <ReturnNoteDialog note={view.target} onClose={view.close} />
      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title={`Delete return note ${remove.target?.returnNo ?? ""}?`}
        message={`Its ${formatUnits(remove.target ? unitsOn(remove.target) : 0)} ${remove.target && unitsOn(remove.target) === 1 ? "goes" : "go"} back into Return Items, as not sent to Raigam. Use this if the note was saved by mistake.`}
        confirmLabel="Delete note"
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteRaigamReturn(remove.target.id);
          if (result.ok) toast.success(`Return note ${remove.target.returnNo} deleted`);
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
