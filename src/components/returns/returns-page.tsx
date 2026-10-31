"use client";

import { ChevronDown, ChevronRight, Eye, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { ReturnKindBadge } from "@/components/sales/return-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateRangePicker, inDateRange, type DateRange } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  formatPct,
  formatUnits,
  heldValue,
  returnAllocations,
  returnKey,
  returnRate,
  returnSplit,
  returnStock,
  unitsSold,
  type ReturnSentInfo,
  type ReturnStockRow,
} from "@/lib/returns";
import { useAppStore, useItemMap, useShopMap } from "@/lib/store";
import type { RaigamReturn, ReturnKind, Sale, SaleReturn } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatMoney, formatQty, includesText, round2 } from "@/lib/utils";
import { ReturnNoteDialog, SendReturnsDialog } from "./return-dialogs";

// Return items store: good and market returns taken back from stores (on delivered bills),
// kept apart from stock until they're sent back to Raigam on a return note.

type Tab = "store" | "bills" | "sent";
type KindFilter = "all" | ReturnKind;

const sumOf = (rows: ReturnStockRow[], pick: (r: ReturnStockRow) => number, kind?: ReturnKind) =>
  rows.reduce((n, r) => n + (!kind || r.kind === kind ? pick(r) : 0), 0);
/** A return line on a bill: collected once the bill is delivered (dated by delivery), else still to collect */
type BillReturn = {
  sale: Sale;
  ret: SaleReturn;
  collected: boolean;
  date: string;
};
const unitsOn = (note: RaigamReturn, kind?: ReturnKind) => note.lines.reduce((n, l) => n + (!kind || l.kind === kind ? l.qty : 0), 0);

export function ReturnsPage() {
  const sales = useAppStore((s) => s.sales);
  const shops = useAppStore((s) => s.shops);
  const raigamReturns = useAppStore((s) => s.raigamReturns);
  const deleteRaigamReturn = useAppStore((s) => s.deleteRaigamReturn);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const [tab, setTab] = useState<Tab>("store");
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  /** Only return items from this store's bills ("" = all stores) */
  const [storeId, setStoreId] = useState("");
  /** Return Items rows whose bills are shown under them */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const send = useDialog<true>();
  const view = useDialog<RaigamReturn>();
  const remove = useDialog<RaigamReturn>();

  const stockRows = useMemo(() => [...returnStock(sales, raigamReturns).values()], [sales, raigamReturns]);
  // Which bills' returns went on which return note (matched oldest first)
  const allocations = useMemo(() => returnAllocations(sales, raigamReturns), [sales, raigamReturns]);
  // Returns against sales: overall by value, and per item by units
  const rate = useMemo(() => returnRate(sales), [sales]);
  const sold = useMemo(() => unitsSold(sales), [sales]);
  const heldUnits = sumOf(stockRows, (r) => r.held);
  const heldTotal = round2(stockRows.reduce((sum, r) => sum + heldValue(r), 0));
  const toCollectUnits = sumOf(stockRows, (r) => r.toCollect);
  const billsToCollect = sales.filter((s) => (s.status === "Ordered" || s.status === "Loaded") && s.returns.length > 0).length;
  const sentUnits = sumOf(stockRows, (r) => r.sent);
  const ofKind = (k: ReturnKind) => kind === "all" || kind === k;
  const itemText = (sapCode: string) => [sapCode, itemMap.get(sapCode)?.description];
  /** What finds a bill: its no., Raigam's invoice no., the store's name and code */
  const billText = (sale: Sale) => {
    const shop = shopMap.get(sale.shopId);
    return [sale.saleNo, sale.invoiceNo, shop?.shopName, shop?.shopCode];
  };

  // In Return Items: per item and type
  const storeRows = stockRows
    .filter((r) => r.held > 0 || r.toCollect > 0)
    .filter((r) => ofKind(r.kind) && includesText(itemText(r.sapCode), query))
    .sort((a, b) => a.sapCode.localeCompare(b.sapCode) || a.kind.localeCompare(b.kind));

  // Every return line on a bill, newest first (a delivered bill's by its delivery date)
  const allBillReturns = useMemo(
    () =>
      sales
        .filter((s) => s.status !== "Cancelled")
        .flatMap((s) =>
          s.returns.map((r): BillReturn => ({
            sale: s,
            ret: r,
            collected: s.status === "Delivered",
            date: (s.status === "Delivered" ? s.deliveredDate : s.date) ?? "",
          })),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.sale.saleNo.localeCompare(a.sale.saleNo)),
    [sales],
  );

  // The bills each Return Items row (item and type) came from
  const billsByKey = useMemo(() => {
    const map = new Map<string, BillReturn[]>();
    for (const x of allBillReturns) {
      const key = returnKey(x.ret.kind, x.ret.sapCode);
      map.set(key, [...(map.get(key) ?? []), x]);
    }
    return map;
  }, [allBillReturns]);
  const allOpen = storeRows.length > 0 && storeRows.every((r) => open.has(r.key));

  // A store picked, or a search that finds bills (store name, invoice or bill no.): the return items on those bills
  const searchFindsBills = query.trim() !== "" && allBillReturns.some((x) => includesText(billText(x.sale), query));
  const byBills = storeId !== "" || searchFindsBills;
  const fromBills = byBills
    ? allBillReturns
        .filter((x) => ofKind(x.ret.kind) && (!storeId || x.sale.shopId === storeId))
        .filter((x) => includesText([...billText(x.sale), ...itemText(x.ret.sapCode)], query))
    : [];
  // ...per item and type, most returned first
  const fromBillsByItem = [...Map.groupBy(fromBills, (x) => returnKey(x.ret.kind, x.ret.sapCode))]
    .map(([key, lines]) => ({
      key,
      kind: lines[0].ret.kind,
      sapCode: lines[0].ret.sapCode,
      lines,
      qty: lines.reduce((n, x) => n + x.ret.qty, 0),
      credit: round2(lines.reduce((n, x) => n + x.ret.qty * x.ret.unitPrice, 0)),
      bills: new Set(lines.map((x) => x.sale.id)).size,
    }))
    .sort((a, b) => b.qty - a.qty || a.sapCode.localeCompare(b.sapCode));
  const fromBillsUnits = (k?: ReturnKind) => fromBills.reduce((n, x) => n + (!k || x.ret.kind === k ? x.ret.qty : 0), 0);
  const storeShops = [...shops].filter((s) => sales.some((x) => x.shopId === s.id && x.returns.length > 0)).sort((a, b) => a.shopName.localeCompare(b.shopName));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // From bills: every return line in the date range
  const billRows = allBillReturns
    .filter((x) => ofKind(x.ret.kind) && inDateRange(x.date, range))
    .filter((x) => !storeId || x.sale.shopId === storeId)
    .filter((x) => includesText([...itemText(x.ret.sapCode), ...billText(x.sale)], query));
  const billPager = usePagination(billRows, [query, kind, range, storeId]);

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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="In Return Items"
          value={formatUnits(heldUnits)}
          sub={`Good ${formatQty(sumOf(stockRows, (r) => r.held, "Good"))} · Market ${formatQty(sumOf(stockRows, (r) => r.held, "Market"))} · ${formatMoney(heldTotal)}`}
        />
        <SummaryTile label="To collect" value={formatUnits(toCollectUnits)} sub={`On ${billsToCollect} bill${billsToCollect === 1 ? "" : "s"} not delivered yet`} />
        <SummaryTile label="Sent to Raigam" value={formatUnits(sentUnits)} sub={`${raigamReturns.length} return note${raigamReturns.length === 1 ? "" : "s"}`} />
        <SummaryTile label="Return %" value={formatPct(rate.pct, rate.sold)} sub={`${returnSplit(rate)} · of ${formatMoney(rate.sold)} sold`} />
      </div>

      <Card>
        <Toolbar>
          <FilterTabs<Tab>
            value={tab}
            onChange={setTab}
            options={[
              {
                value: "store",
                label: "In Return Items",
                count: stockRows.filter((r) => r.held > 0 || r.toCollect > 0).length,
              },
              {
                value: "bills",
                label: "From bills",
                count: sales.filter((s) => s.status !== "Cancelled").reduce((n, s) => n + s.returns.length, 0),
              },
              {
                value: "sent",
                label: "Sent to Raigam",
                count: raigamReturns.length,
              },
            ]}
          />
          <SearchInput
            placeholder={tab === "sent" ? "Search note no., reference or item" : "Search item, store, bill or invoice no."}
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
          {tab !== "sent" && (
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="h-9 sm:w-56" aria-label="Filter by store">
              <option value="">All stores</option>
              {storeShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shopName}
                  {s.shopCode ? ` · ${s.shopCode}` : ""}
                </option>
              ))}
            </Select>
          )}
          {tab !== "store" && <DateRangePicker value={range} onChange={setRange} />}
        </Toolbar>

        {tab === "store" && byBills && (
          <>
            <div className="border-b border-slate-200 bg-brand-50/50 px-5 py-2.5 text-sm text-slate-700">
              Return items on{" "}
              <span className="font-semibold text-slate-900">
                {[storeId && shopMap.get(storeId)?.shopName, query.trim() && `bills matching "${query.trim()}"`].filter(Boolean).join(", ")}
              </span>
              : {formatUnits(fromBillsUnits())} (Good {formatQty(fromBillsUnits("Good"))} · Market {formatQty(fromBillsUnits("Market"))}) on{" "}
              {new Set(fromBills.map((x) => x.sale.id)).size} bill{new Set(fromBills.map((x) => x.sale.id)).size === 1 ? "" : "s"} ·{" "}
              {formatMoney(round2(fromBills.reduce((n, x) => n + x.ret.qty * x.ret.unitPrice, 0)))} credited
            </div>
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Bills</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Credit</TH>
                </tr>
              </THead>
              <TBody>
                {fromBillsByItem.length === 0 && <EmptyRow colSpan={5}>No return items on these bills.</EmptyRow>}
                {fromBillsByItem.map((r) => (
                  <Fragment key={r.key}>
                    <TR className="bg-brand-50/30">
                      <TD className="whitespace-normal">
                        <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? "Unknown item"}</span>
                        <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                      </TD>
                      <TD>
                        <ReturnKindBadge kind={r.kind} />
                      </TD>
                      <TD className="text-right tabular-nums">{formatQty(r.bills)}</TD>
                      <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.qty)}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(r.credit)}</TD>
                    </TR>
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-5 pt-1 pb-4 pl-11">
                        <ReturnBills lines={r.lines} shopName={(id) => shopMap.get(id)?.shopName ?? "—"} sent={allocations.byReturn} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </TBody>
            </Table>
            <TableFooter>
              {fromBillsByItem.length} line{fromBillsByItem.length === 1 ? "" : "s"} · {formatUnits(fromBillsUnits())} · clear the store and search to see everything in Return Items
            </TableFooter>
          </>
        )}

        {tab === "store" && !byBills && (
          <>
            <div className="flex justify-end border-b border-slate-200 px-5 py-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(storeRows.map((r) => r.key)))} disabled={!storeRows.length}>
                {allOpen ? <ChevronDown /> : <ChevronRight />} {allOpen ? "Hide bills" : "Show bills for every item"}
              </Button>
            </div>
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
                  <TH className="text-right" title="Units returned (collected and to collect) ÷ units of the item sold">
                    Return %
                  </TH>
                </tr>
              </THead>
              <TBody>
                {storeRows.length === 0 && (
                  <EmptyRow colSpan={8}>
                    {query || kind !== "all" ? "No return items match." : "Nothing here yet. Returns on delivered bills show here until you send them to Raigam."}
                  </EmptyRow>
                )}
                {storeRows.map((r) => {
                  const isOpen = open.has(r.key);
                  const Chevron = isOpen ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={r.key}>
                      <TR className={cn("cursor-pointer", isOpen && "bg-brand-50/60")} onClick={() => toggle(r.key)} aria-expanded={isOpen}>
                        <TD className="whitespace-normal">
                          <span className="flex items-start gap-2">
                            <Chevron className="mt-0.5 size-4 shrink-0 text-slate-400" />
                            <span>
                              <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? "Unknown item"}</span>
                              <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                            </span>
                          </span>
                        </TD>
                        <TD>
                          <ReturnKindBadge kind={r.kind} />
                        </TD>
                        <TD className="text-right text-slate-500 tabular-nums">{r.toCollect ? formatQty(r.toCollect) : "—"}</TD>
                        <TD className="text-right tabular-nums">{r.collected ? formatQty(r.collected) : "—"}</TD>
                        <TD className="text-right tabular-nums">{r.sent ? formatQty(r.sent) : "—"}</TD>
                        <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.held)}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(heldValue(r))}</TD>
                        <TD className="text-right tabular-nums">
                          {formatPct(((r.toCollect + r.collected) / (sold.get(r.sapCode) || 1)) * 100, sold.get(r.sapCode) ?? 0)}
                          <span className="block text-xs text-slate-500">of {formatQty(sold.get(r.sapCode) ?? 0)} sold</span>
                        </TD>
                      </TR>
                      {isOpen && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-5 pt-1 pb-4 pl-11">
                            <ReturnBills lines={billsByKey.get(r.key) ?? []} shopName={(id) => shopMap.get(id)?.shopName ?? "—"} sent={allocations.byReturn} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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
                    <TD>
                      <ReturnStatus qty={ret.qty} collected={collected} sent={allocations.byReturn.get(ret.id)} />
                    </TD>
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
      <ReturnNoteDialog note={view.target} onClose={view.close} fromBills={view.target ? (allocations.byNote.get(view.target.id) ?? []) : []} />
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

/** The bills an item (of one return type) was taken back on, shown under its Return Items row */
function ReturnBills({ lines, shopName, sent }: { lines: BillReturn[]; shopName: (shopId: string) => string; sent: Map<string, ReturnSentInfo> }) {
  if (!lines.length) return <p className="py-2 text-xs text-slate-500">Not on any bill.</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        <tr className="border-b border-slate-200">
          <th className="py-2 pr-3 font-semibold">Date</th>
          <th className="py-2 pr-3 font-semibold">Bill No.</th>
          <th className="py-2 pr-3 font-semibold">Store</th>
          <th className="py-2 pr-3 text-right font-semibold">Qty</th>
          <th className="py-2 pr-3 text-right font-semibold">Credit</th>
          <th className="py-2 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200">
        {lines.map(({ sale, ret, collected, date }) => (
          <tr key={`${sale.id}|${ret.id}`}>
            <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{formatDate(date)}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">
              <Link href={`/sales/${sale.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-700 hover:underline">
                {sale.saleNo}
              </Link>
              {sale.invoiceNo && <span className="ml-1.5 text-slate-500">{sale.invoiceNo}</span>}
            </td>
            <td className="py-1.5 pr-3">{shopName(sale.shopId)}</td>
            <td className="py-1.5 pr-3 text-right font-semibold text-slate-900 tabular-nums">{formatQty(ret.qty)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(round2(ret.qty * ret.unitPrice))}</td>
            <td className="py-1.5">
              <ReturnStatus qty={ret.qty} collected={collected} sent={sent.get(ret.id)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Where a bill's return line is now: still at the store, in Return Items, or sent to Raigam (on which note).
 * Notes are matched to bills oldest first (src/lib/returns.ts returnAllocations).
 */
function ReturnStatus({ qty, collected, sent }: { qty: number; collected: boolean; sent?: ReturnSentInfo }) {
  if (!collected) return <Badge tone="amber">To collect</Badge>;
  if (!sent?.sent) return <Badge tone="blue">In Return Items</Badge>;
  const notes = sent.notes.map((n) => n.returnNo).join(", ");
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {sent.sent >= qty ? <Badge tone="green">Sent to Raigam</Badge> : <Badge tone="blue">{`${formatQty(sent.sent)} of ${formatQty(qty)} sent`}</Badge>}
      <span className="text-xs text-slate-500">{notes}</span>
    </span>
  );
}
