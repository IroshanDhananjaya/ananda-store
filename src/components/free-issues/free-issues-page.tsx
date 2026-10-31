"use client";

import { BadgeCheck, ChevronDown, ChevronRight, Eye, Plus, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge, BillStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { claimBillCount, claimBySale, claimUnits, claimValue, freeOf, freeValueOf, isClaimPaid } from "@/lib/free-issues";
import { chargedQty } from "@/lib/ledger";
import { useAppStore, useItemMap, useSaleDues, useShopMap } from "@/lib/store";
import type { FreeClaim, Sale, SaleLine } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { addDays, cn, formatDate, formatMoney, formatQty, includesText, monthStartISO, round2, todayISO, weekdayOf, weekStartISO } from "@/lib/utils";
import { ClaimDialog, ClaimPaidDialog, ClaimStatusBadge, NewClaimDialog } from "./free-claim-dialogs";

// Free issue given on bills (Raigam's scheme: not charged, Raigam pays it back) for a date range:
// totals per item (what to claim), each bill line with free issue (to check), and the claims sent to Raigam.

/** Quick date tabs; "custom" is dates picked on the calendar that aren't one of them */
type Preset = "today" | "yesterday" | "week" | "month" | "custom";
const PRESETS = ["today", "yesterday", "week", "month"] as const;
/** Which date puts a bill in the range: when it was written, or when it was delivered */
type DateBy = "bill" | "delivered";
type View = "items" | "bills" | "claims";
/** Which bills: all, delivered, delivered but not on a claim yet, or on a claim */
type Which = "all" | "delivered" | "unclaimed" | "claimed";

function presetRange(preset: Exclude<Preset, "custom">) {
  const today = todayISO();
  if (preset === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (preset === "week") return { from: weekStartISO(today), to: today };
  if (preset === "month") return { from: monthStartISO(), to: today };
  return { from: today, to: today };
}

const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;

type BillLine = {
  sale: Sale;
  line: SaleLine;
  date: string;
  free: number;
  value: number;
};
type ItemTotal = {
  sapCode: string;
  bills: number;
  sold: number;
  free: number;
  value: number;
  lines: BillLine[];
};

export function FreeIssuesPage() {
  const sales = useAppStore((s) => s.sales);
  const freeClaims = useAppStore((s) => s.freeClaims);
  const deleteFreeClaim = useAppStore((s) => s.deleteFreeClaim);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const dues = useSaleDues();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState<DateRange>(() => presetRange("month"));
  const [dateBy, setDateBy] = useState<DateBy>("bill");
  const [which, setWhich] = useState<Which>("all");
  const [view, setView] = useState<View>("items");
  const [query, setQuery] = useState("");
  /** Items whose bills are shown under them */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const newClaim = useDialog<true>();
  const viewClaim = useDialog<FreeClaim>();
  const paidClaim = useDialog<FreeClaim>();
  const removeClaim = useDialog<FreeClaim>();
  const claimOf = useMemo(() => claimBySale(freeClaims), [freeClaims]);

  const { from, to } = range;

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  // Dates picked on the calendar light up their tab when they match one
  function chooseRange(r: DateRange) {
    setRange(r);
    setPreset(PRESETS.find((p) => presetRange(p).from === r.from && presetRange(p).to === r.to) ?? "custom");
  }

  // Every bill line with free issue in the range (cancelled bills don't count)
  const lines: BillLine[] = useMemo(() => {
    const out: BillLine[] = [];
    for (const s of sales) {
      if (s.status === "Cancelled") continue;
      if (which !== "all" && s.status !== "Delivered") continue;
      if ((which === "unclaimed" && claimOf.has(s.id)) || (which === "claimed" && !claimOf.has(s.id))) continue;
      const date = dateBy === "bill" ? s.date : s.deliveredDate;
      if (!date || date < from || date > to) continue;
      for (const l of s.lines) {
        const free = freeOf(l);
        if (free > 0) out.push({ sale: s, line: l, date, free, value: freeValueOf(l) });
      }
    }
    return out;
  }, [sales, which, dateBy, from, to, claimOf]);

  const matching = lines.filter((x) =>
    includesText([x.line.sapCode, itemMap.get(x.line.sapCode)?.description, x.sale.saleNo, x.sale.invoiceNo, shopMap.get(x.sale.shopId)?.shopName], query),
  );

  const items: ItemTotal[] = [
    ...matching
      .reduce((map, x) => {
        const row = map.get(x.line.sapCode) ?? {
          sapCode: x.line.sapCode,
          bills: 0,
          sold: 0,
          free: 0,
          value: 0,
          lines: [] as BillLine[],
        };
        row.bills += 1; // an item is on a bill once
        row.sold += x.line.unitPrice === 0 ? 0 : chargedQty(x.line);
        row.free += x.free;
        row.value = round2(row.value + x.value);
        row.lines.push(x);
        return map.set(x.line.sapCode, row);
      }, new Map<string, ItemTotal>())
      .values(),
  ].sort((a, b) => b.free - a.free || (itemMap.get(a.sapCode)?.description ?? "").localeCompare(itemMap.get(b.sapCode)?.description ?? ""));
  const byNewest = (a: BillLine, b: BillLine) => b.date.localeCompare(a.date) || b.sale.saleNo.localeCompare(a.sale.saleNo);
  const bills = [...matching].sort(byNewest);
  for (const r of items) r.lines.sort(byNewest);
  const allOpen = items.length > 0 && items.every((r) => open.has(r.sapCode));
  const toggle = (sapCode: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(sapCode)) next.add(sapCode);
      return next;
    });

  const itemPager = usePagination(items, [query, from, to, dateBy, which]);
  const billPager = usePagination(bills, [query, from, to, dateBy, which]);
  // Rows on other pages are hidden on screen but still printed
  const offPage = (pager: { start: number; pageSize: number }, i: number) => (i < pager.start || i >= pager.start + pager.pageSize) && "hidden print:table-row";

  const totalFree = matching.reduce((n, x) => n + x.free, 0);
  const totalValue = round2(matching.reduce((n, x) => n + x.value, 0));
  const billCount = new Set(matching.map((x) => x.sale.id)).size;
  // Delivered and not on a claim yet: still to claim from Raigam
  const toClaim = matching.filter((x) => x.sale.status === "Delivered" && !claimOf.has(x.sale.id));
  const toClaimValue = round2(toClaim.reduce((n, x) => n + x.value, 0));
  const toClaimBills = new Set(toClaim.map((x) => x.sale.id)).size;
  const summary = [
    from === to ? `${weekdayOf(from)} ${formatDate(from)}` : `${formatDate(from)} – ${formatDate(to)}`,
    dateBy === "bill" ? "by bill date" : "by delivered date",
    { all: "all bills", delivered: "delivered bills", unclaimed: "not claimed yet", claimed: "claimed bills" }[which],
  ].join(" · ");

  // Claims, newest first (all dates); the search finds a claim by its no., reference or a bill on it
  const saleNoOf = new Map(sales.map((s) => [s.id, s.saleNo]));
  const claims = freeClaims
    .filter((c) => includesText([c.claimNo, c.reference, c.paidReference, c.notes, ...c.lines.map((l) => saleNoOf.get(l.saleId))], query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.claimNo.localeCompare(a.claimNo));
  const claimPager = usePagination(claims, [query]);
  const unpaid = freeClaims.filter((c) => !isClaimPaid(c));
  const unpaidValue = round2(unpaid.reduce((n, c) => n + claimValue(c), 0));
  const claimBadge = (saleId: string, delivered: boolean) => {
    const c = claimOf.get(saleId);
    if (c)
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            viewClaim.open(c);
          }}
          className="text-left"
          title={`View claim ${c.claimNo}`}
        >
          <Badge tone={isClaimPaid(c) ? "green" : "blue"}>{`${c.claimNo}${isClaimPaid(c) ? " · Paid" : ""}`}</Badge>
        </button>
      );
    return delivered ? <Badge tone="amber">Not claimed</Badge> : <span className="text-slate-400">—</span>;
  };

  return (
    <>
      <PageHeader
        title="Free Issues"
        description={`Free issue given on bills (Raigam pays it back) · ${summary}`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
            <Button onClick={() => newClaim.open(true)}>
              <Plus /> New claim
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Free issue" value={plural(totalFree, "unit")} sub={`${plural(items.length, "item")}`} />
        <SummaryTile label="Free issue value" value={formatMoney(totalValue)} sub="At the price on each bill" />
        <SummaryTile label="Bills with free issue" value={formatQty(billCount)} sub={plural(bills.length, "line")} />
        <SummaryTile
          label="To claim"
          value={formatMoney(toClaimValue)}
          sub={`Delivered, on ${plural(toClaimBills, "bill")} not claimed · ${formatMoney(unpaidValue)} claimed, not paid yet`}
          tone={toClaimValue > 0 ? "danger" : "default"}
        />
      </div>

      <div className="mt-6 print:hidden">
        <FilterTabs<View>
          value={view}
          onChange={setView}
          options={[
            { value: "items", label: "By item (to claim)", count: items.length },
            { value: "bills", label: "By bill", count: bills.length },
            { value: "claims", label: "Claims", count: freeClaims.length },
          ]}
        />
      </div>

      <Card className="mt-3">
        <div className="print:hidden">
          {view === "claims" ? (
            <Toolbar>
              <p className="text-sm text-slate-600">
                {plural(unpaid.length, "claim")} waiting for Raigam · <span className="font-medium text-slate-900">{formatMoney(unpaidValue)}</span>
              </p>
              <SearchInput placeholder="Search claim no., reference or bill…" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:ml-auto" />
            </Toolbar>
          ) : (
            <>
              <Toolbar>
                <FilterTabs<Preset>
                  value={preset}
                  onChange={choosePreset}
                  options={[
                    { value: "today", label: "Today" },
                    { value: "yesterday", label: "Yesterday" },
                    { value: "week", label: "This week" },
                    { value: "month", label: "This month" },
                  ]}
                />
                <DateRangePicker value={range} onChange={chooseRange} clearable={false} />
                <Select value={dateBy} onChange={(e) => setDateBy(e.target.value as DateBy)} className="h-9 sm:ml-auto sm:w-44" aria-label="Which date to use">
                  <option value="bill">By bill date</option>
                  <option value="delivered">By delivered date</option>
                </Select>
              </Toolbar>
              <Toolbar>
                <FilterTabs<Which>
                  value={which}
                  onChange={setWhich}
                  options={[
                    { value: "all", label: "All bills" },
                    { value: "delivered", label: "Delivered only" },
                    { value: "unclaimed", label: "Not claimed" },
                    { value: "claimed", label: "Claimed" },
                  ]}
                />
                <SearchInput placeholder="Search item, store or bill…" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:ml-auto" />
              </Toolbar>
            </>
          )}
        </div>

        {view === "items" ? (
          <>
            <div className="flex justify-end border-b border-slate-200 px-5 py-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(items.map((r) => r.sapCode)))} disabled={!items.length}>
                {allOpen ? <ChevronDown /> : <ChevronRight />} {allOpen ? "Hide bills" : "Show bills for every item"}
              </Button>
            </div>
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-right">Bills</TH>
                  <TH className="text-right">Sold Qty</TH>
                  <TH className="text-right">Free Qty</TH>
                  <TH className="text-right">Free Value</TH>
                </tr>
              </THead>
              <TBody>
                {items.length === 0 && <EmptyRow colSpan={5}>{lines.length ? "No free issue matches the search." : "No free issue on bills for these dates."}</EmptyRow>}
                {items.map((r, i) => {
                  const item = itemMap.get(r.sapCode);
                  const isOpen = open.has(r.sapCode);
                  return (
                    <Fragment key={r.sapCode}>
                      <TR className={cn("cursor-pointer", isOpen && "bg-brand-50/60", offPage(itemPager, i))} onClick={() => toggle(r.sapCode)} aria-expanded={isOpen}>
                        <TD className="whitespace-normal">
                          <span className="flex items-start gap-2">
                            {isOpen ? (
                              <ChevronDown className="mt-0.5 size-4 shrink-0 text-slate-400 print:hidden" />
                            ) : (
                              <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400 print:hidden" />
                            )}
                            <span>
                              <span className="block font-semibold text-slate-900">{item?.description ?? "Deleted item"}</span>
                              <span className="block font-mono text-xs text-slate-500">
                                {r.sapCode}
                                {item?.packageDetails ? ` · ${item.packageDetails}` : ""}
                              </span>
                            </span>
                          </span>
                        </TD>
                        <TD className="text-right tabular-nums">{formatQty(r.bills)}</TD>
                        <TD className="text-right tabular-nums">{formatQty(r.sold)}</TD>
                        <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(r.free)}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(r.value)}</TD>
                      </TR>
                      {isOpen && (
                        <tr className={cn("bg-slate-50", offPage(itemPager, i))}>
                          <td colSpan={5} className="px-5 pt-1 pb-4 pl-11">
                            <ItemBills lines={r.lines} shopName={(id) => shopMap.get(id)?.shopName ?? "—"} dues={dues} claimBadge={claimBadge} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
            <TableFooter pager={<Pagination pager={itemPager} />}>
              {plural(items.length, "item")} · <span className="font-medium text-slate-700">{plural(totalFree, "unit")} free</span> · {formatMoney(totalValue)}
            </TableFooter>
          </>
        ) : view === "bills" ? (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Bill No.</TH>
                  <TH>Store</TH>
                  <TH>Item</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Free Qty</TH>
                  <TH className="text-right">Free Value</TH>
                  <TH>Status</TH>
                  <TH>Claim</TH>
                </tr>
              </THead>
              <TBody>
                {bills.length === 0 && <EmptyRow colSpan={9}>{lines.length ? "No free issue matches the search." : "No free issue on bills for these dates."}</EmptyRow>}
                {bills.map((x, i) => {
                  const item = itemMap.get(x.line.sapCode);
                  const d = dues.get(x.sale.id);
                  return (
                    <TR key={`${x.sale.id}|${x.line.id}`} className={cn(offPage(billPager, i))}>
                      <TD className="tabular-nums">{formatDate(x.date)}</TD>
                      <TD>
                        <Link href={`/sales/${x.sale.id}`} className="font-medium text-brand-700 hover:underline">
                          {x.sale.saleNo}
                        </Link>
                        {x.sale.invoiceNo && <span className="block text-xs text-slate-500">{x.sale.invoiceNo}</span>}
                      </TD>
                      <TD className="whitespace-normal">{shopMap.get(x.sale.shopId)?.shopName ?? "—"}</TD>
                      <TD className="whitespace-normal">
                        <span className="block font-semibold text-slate-900">{item?.description ?? "Deleted item"}</span>
                        <span className="block font-mono text-xs text-slate-500">{x.line.sapCode}</span>
                        {x.line.qty === 0 && <span className="block text-xs font-medium text-emerald-700">Free item</span>}
                      </TD>
                      <TD className="text-right tabular-nums">{formatQty(chargedQty(x.line))}</TD>
                      <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(x.free)}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(x.value)}</TD>
                      <TD>{d && <BillStatusBadge status={d.status} late={x.sale.late} />}</TD>
                      <TD>{claimBadge(x.sale.id, x.sale.status === "Delivered")}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <TableFooter pager={<Pagination pager={billPager} />}>
              {plural(bills.length, "line")} on {plural(billCount, "bill")} · <span className="font-medium text-slate-700">{plural(totalFree, "unit")} free</span> ·{" "}
              {formatMoney(totalValue)}
            </TableFooter>
          </>
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Claim No.</TH>
                  <TH>Date</TH>
                  <TH>Raigam Ref.</TH>
                  <TH className="text-right">Bills</TH>
                  <TH className="text-right">Free Qty</TH>
                  <TH className="text-right">Claim Value</TH>
                  <TH className="text-right">Paid</TH>
                  <TH>Status</TH>
                  <TH className="w-28 print:hidden">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {claims.length === 0 && (
                  <EmptyRow colSpan={9}>
                    {freeClaims.length ? "No claims match the search." : "No claims yet. Use New claim to claim the free issue on delivered bills."}
                  </EmptyRow>
                )}
                {claims.map((c, i) => (
                  <TR key={c.id} className={cn(offPage(claimPager, i))}>
                    <TD>
                      <button type="button" onClick={() => viewClaim.open(c)} className="font-medium text-brand-700 hover:underline">
                        {c.claimNo}
                      </button>
                    </TD>
                    <TD className="tabular-nums">{formatDate(c.date)}</TD>
                    <TD>{c.reference || "—"}</TD>
                    <TD className="text-right tabular-nums">{formatQty(claimBillCount(c))}</TD>
                    <TD className="text-right tabular-nums">{formatQty(claimUnits(c))}</TD>
                    <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(claimValue(c))}</TD>
                    <TD className="text-right tabular-nums">
                      {isClaimPaid(c) ? (
                        <>
                          {formatMoney(c.paidAmount)}
                          <span className="block text-xs text-slate-500">{formatDate(c.paidDate)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <ClaimStatusBadge claim={c} />
                    </TD>
                    <TD className="print:hidden">
                      <RowActions>
                        <Button variant="ghost" size="icon" onClick={() => viewClaim.open(c)} title="View" aria-label={`View ${c.claimNo}`}>
                          <Eye />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => paidClaim.open(c)} title="Raigam paid" aria-label={`Mark ${c.claimNo} paid`}>
                          <BadgeCheck />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-red-50 hover:text-red-600"
                          onClick={() => removeClaim.open(c)}
                          title="Delete"
                          aria-label={`Delete ${c.claimNo}`}
                        >
                          <Trash2 />
                        </Button>
                      </RowActions>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter pager={<Pagination pager={claimPager} />}>
              {plural(claims.length, "claim")} · {formatMoney(round2(claims.reduce((n, c) => n + claimValue(c), 0)))} claimed ·{" "}
              <span className="font-medium text-slate-700">{formatMoney(round2(claims.reduce((n, c) => n + (isClaimPaid(c) ? c.paidAmount : 0), 0)))} paid</span>
            </TableFooter>
          </>
        )}
      </Card>

      <NewClaimDialog open={newClaim.isOpen} onClose={newClaim.close} range={range} />
      <ClaimDialog claim={viewClaim.target} onClose={viewClaim.close} />
      <ClaimPaidDialog claim={paidClaim.target} onClose={paidClaim.close} />
      <ConfirmDialog
        open={removeClaim.isOpen}
        onClose={removeClaim.close}
        title={`Delete claim ${removeClaim.target?.claimNo ?? ""}?`}
        message={`Its ${plural(removeClaim.target ? claimBillCount(removeClaim.target) : 0, "bill")} go back to not claimed, and their free issue can be changed again. Use this if the claim was saved by mistake.`}
        confirmLabel="Delete claim"
        onConfirm={async () => {
          if (!removeClaim.target) return;
          const result = await deleteFreeClaim(removeClaim.target.id);
          if (result.ok) toast.success(`Claim ${removeClaim.target.claimNo} deleted`);
          else toast.error(result.error);
          removeClaim.close();
        }}
      />
    </>
  );
}

/** The bills an item was given free on, shown under the item's row */
function ItemBills({
  lines,
  shopName,
  dues,
  claimBadge,
}: {
  lines: BillLine[];
  shopName: (shopId: string) => string;
  dues: ReturnType<typeof useSaleDues>;
  claimBadge: (saleId: string, delivered: boolean) => ReactNode;
}) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        <tr className="border-b border-slate-200">
          <th className="py-2 pr-3 font-semibold">Date</th>
          <th className="py-2 pr-3 font-semibold">Bill No.</th>
          <th className="py-2 pr-3 font-semibold">Store</th>
          <th className="py-2 pr-3 text-right font-semibold">Qty</th>
          <th className="py-2 pr-3 text-right font-semibold">Free Qty</th>
          <th className="py-2 pr-3 text-right font-semibold">Free Value</th>
          <th className="py-2 pr-3 font-semibold">Status</th>
          <th className="py-2 font-semibold">Claim</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200">
        {lines.map((x) => (
          <tr key={`${x.sale.id}|${x.line.id}`}>
            <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{formatDate(x.date)}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">
              <Link href={`/sales/${x.sale.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-700 hover:underline">
                {x.sale.saleNo}
              </Link>
              {x.sale.invoiceNo && <span className="ml-1.5 text-slate-500">{x.sale.invoiceNo}</span>}
            </td>
            <td className="py-1.5 pr-3">{shopName(x.sale.shopId)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">
              {formatQty(chargedQty(x.line))}
              {x.line.qty === 0 && <span className="ml-1.5 font-medium text-emerald-700">Free item</span>}
            </td>
            <td className="py-1.5 pr-3 text-right font-semibold text-slate-900 tabular-nums">{formatQty(x.free)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(x.value)}</td>
            <td className="py-1.5 pr-3">
              {(() => {
                const d = dues.get(x.sale.id);
                return d && <BillStatusBadge status={d.status} late={x.sale.late} />;
              })()}
            </td>
            <td className="py-1.5">{claimBadge(x.sale.id, x.sale.status === "Delivered")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
