"use client";

import { CircleCheck, CloudDownload, Eye, Pencil, Plus, Printer, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LoadLorryDialog } from "@/components/sales/load-lorry-dialog";
import { BillStatusBadge, DueDateLabel } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { SaleDue } from "@/lib/ledger";
import { useAppStore, useItemMap, useRouteMap, useSaleDues, useShopMap } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { addDays, cn, formatDate, formatMoney, formatQty, includesText, monthStartISO, todayISO, weekdayOf, weekStartISO } from "@/lib/utils";
import { BillStatusMenu } from "@/components/sales/bill-status-menu";
import { BillFlags } from "@/components/sales/bill-flags";
import { CheckedToggle } from "@/components/sales/checked-toggle";
import { CashSheet } from "./cash-sheet";
import { LoadingList } from "./loading-list";
import { RaigamSyncDialog } from "./raigam-sync-dialog";

/** Quick date tabs; "custom" is dates picked on the calendar that aren't one of them */
type Preset = "today" | "yesterday" | "week" | "month" | "custom" | "all";
const PRESETS = ["today", "yesterday", "week", "month"] as const;
/** Which date puts an invoice on a day: when the bill was written, or when it was delivered */
type DateBy = "bill" | "delivered";
/** Bills day by day, or item totals across them (loading list) */
type View = "invoices" | "items";
/** Raigam's invoice tabs: booked and not delivered yet, actual (delivered), late delivery, cancelled */
type Kind = "all" | "booking" | "actual" | "late" | "cancelled";
/** Where a bill is up to: loading, collecting, or checking against Raigam's printed bill */
type Show = "all" | "toLoad" | "onLorry" | "due" | "overdue" | "paid" | "unchecked" | "checked";

/** Days back Sync from Raigam starts from (more if the page shows an earlier date) */
const SYNC_DAYS = 7;
/** Bills per page (a normal day fits on one) */
const PAGE_SIZE = 100;

const KIND_LABELS: Record<Kind, string> = { all: "All", booking: "Booking", actual: "Actual", late: "Late delivery", cancelled: "Cancelled" };

const SHOW_LABELS: Record<Show, string> = {
  all: "All bills",
  toLoad: "To load",
  onLorry: "On lorry",
  due: "Has cash balance",
  overdue: "Overdue",
  paid: "Paid",
  unchecked: "Not checked with Raigam yet",
  checked: "Checked with Raigam",
};

/** ?filter= from older links (the Store Orders page): where it pointed, over all dates */
const FILTERS: Record<string, { show: Show; kind: Kind }> = {
  toLoad: { show: "toLoad", kind: "all" },
  onLorry: { show: "onLorry", kind: "all" },
  due: { show: "due", kind: "all" },
  overdue: { show: "overdue", kind: "all" },
  paid: { show: "paid", kind: "all" },
  cancelled: { show: "all", kind: "cancelled" },
};

function kindOf(s: Sale): Exclude<Kind, "all"> {
  if (s.status === "Cancelled") return "cancelled";
  if (s.status === "Delivered") return "actual";
  return s.late ? "late" : "booking";
}

function shows(show: Show, s: Sale, d: SaleDue) {
  switch (show) {
    case "toLoad":
      return s.status === "Ordered";
    case "onLorry":
      return s.status === "Loaded";
    case "due":
      return d.due > 0;
    case "overdue":
      return d.overdueDays > 0;
    case "paid":
      return s.status === "Delivered" && d.due <= 0;
    case "unchecked":
      return !!s.invoiceNo && !s.checked;
    case "checked":
      return s.checked;
    default:
      return true;
  }
}

function presetRange(preset: Exclude<Preset, "custom">) {
  const today = todayISO();
  if (preset === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (preset === "week") return { from: weekStartISO(today), to: today };
  if (preset === "month") return { from: monthStartISO(), to: today };
  return { from: today, to: today };
}

const dayLabel = (iso: string) => `${weekdayOf(iso)} ${formatDate(iso)}`;
const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;

/**
 * /invoices — ?route=<id> and ?store=<id> preselect the filters; ?view=items opens the loading list (item totals);
 * ?filter=overdue (toLoad, onLorry, due, paid, cancelled) shows those bills over all dates; ?load=1 opens Load lorry
 */
export function InvoicesRoute() {
  const params = useSearchParams();
  const filter = FILTERS[params.get("filter") ?? ""];
  return (
    <InvoicesPage
      key={params.toString()}
      initialRouteId={params.get("route") ?? ""}
      initialShopId={params.get("store") ?? ""}
      initialView={params.get("view") === "items" ? "items" : "invoices"}
      initialShow={filter?.show ?? "all"}
      initialKind={filter?.kind ?? "all"}
      allDates={!!filter}
      openLoad={params.get("load") === "1"}
    />
  );
}

function InvoicesPage({
  initialRouteId,
  initialShopId,
  initialView,
  initialShow,
  initialKind,
  allDates,
  openLoad,
}: {
  initialRouteId: string;
  initialShopId: string;
  initialView: View;
  initialShow: Show;
  initialKind: Kind;
  allDates: boolean;
  openLoad: boolean;
}) {
  const router = useRouter();
  const sales = useAppStore((s) => s.sales);
  const routes = useAppStore((s) => s.routes);
  const shops = useAppStore((s) => s.shops);
  const deleteSale = useAppStore((s) => s.deleteSale);
  const markChecked = useAppStore((s) => s.markChecked);
  const itemMap = useItemMap();
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const dues = useSaleDues();

  const [preset, setPreset] = useState<Preset>(allDates ? "all" : "today");
  const [range, setRange] = useState<DateRange>(() => presetRange("today"));
  const [routeId, setRouteId] = useState(initialRouteId);
  const [shopId, setShopId] = useState(initialShopId);
  const [dateBy, setDateBy] = useState<DateBy>("bill");
  const [view, setView] = useState<View>(initialView);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [show, setShow] = useState<Show>(initialShow);
  const [query, setQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [loading, setLoading] = useState(openLoad);
  const [syncing, setSyncing] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const remove = useDialog<Sale>();

  const { from, to } = range;

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom" && p !== "all") setRange(presetRange(p));
  }

  // Dates picked on the calendar light up their tab when they match one (Clear = all dates)
  function chooseRange(r: DateRange) {
    if (!r.from) return setPreset("all");
    setRange(r);
    setPreset(PRESETS.find((p) => presetRange(p).from === r.from && presetRange(p).to === r.to) ?? "custom");
  }

  function chooseRoute(id: string) {
    setRouteId(id);
    // Keep the store only if it is on the chosen route
    if (id && shopMap.get(shopId)?.routeId !== id) setShopId("");
  }

  const shopOptions = shops
    .filter((s) => !routeId || s.routeId === routeId)
    .sort((a, b) => a.shopCode.localeCompare(b.shopCode));

  const dateOf = (s: Sale) => (dateBy === "bill" ? s.date : s.deliveredDate);
  const due = (s: Sale) => dues.get(s.id)!;
  const inView = sales
    .filter((s) => {
      const d = dateOf(s);
      return !!d && (preset === "all" || (d >= from && d <= to));
    })
    .filter((s) => !routeId || shopMap.get(s.shopId)?.routeId === routeId)
    .filter((s) => !shopId || s.shopId === shopId)
    .filter((s) => shows(show, s, due(s)))
    .filter((s) => {
      const shop = shopMap.get(s.shopId);
      return includesText([s.saleNo, s.invoiceNo, s.repName, shop?.shopName, shop?.shopCode, shop?.ownerName], query);
    });
  const rows = inView
    .filter((s) => kind === "all" || kindOf(s) === kind)
    // Newest day first; within a day, in bill order
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || a.saleNo.localeCompare(b.saleNo));

  const byDay = Map.groupBy(rows, dateOf);
  const pager = usePagination(rows, [preset, from, to, dateBy, routeId, shopId, kind, show, query], PAGE_SIZE);
  // The page's bills by day; a day's totals cover all its bills, also those on another page
  const pageDays = [...Map.groupBy(pager.pageRows, dateOf)];
  // Cancelled bills stay in the list but don't count in totals or the loading list,
  // except on the Cancelled tab, which counts and totals them like Raigam's does
  const live = rows.filter((s) => s.status !== "Cancelled");
  const counted = (list: Sale[]) => (kind === "cancelled" ? list : list.filter((s) => s.status !== "Cancelled"));
  const cancelled = rows.length - live.length;
  const itemCount = new Set(live.flatMap((s) => s.lines.map((l) => l.sapCode))).size;

  const sum = (list: Sale[], fn: (s: Sale) => number) => counted(list).reduce((acc, s) => acc + fn(s), 0);
  const units = (s: Sale) => s.lines.reduce((n, l) => n + l.qty, 0);
  const total = sum(rows, (s) => due(s).total);
  const paid = sum(rows, (s) => due(s).paid);
  const balance = sum(rows, (s) => due(s).due);
  const notDelivered = live.filter((s) => !due(s).delivered);
  const overdue = live.filter((s) => due(s).overdueDays > 0);
  // Raigam bills in view not ticked yet
  const toCheck = rows.filter((s) => s.invoiceNo && !s.checked);

  // Bills in view still waiting to load; preselected in Load lorry when they share a route
  const toLoad = rows.filter((s) => s.status === "Ordered");
  const loadRoutes = new Set(toLoad.map((s) => shopMap.get(s.shopId)?.routeId));
  const preselect = loadRoutes.size === 1 ? toLoad.map((s) => s.id) : [];

  const route = routeMap.get(routeId);
  const shop = shopMap.get(shopId);
  const period = preset === "all" ? "All dates" : from === to ? dayLabel(from) : `${formatDate(from)} – ${formatDate(to)}`;
  const summary = [
    period,
    dateBy === "bill" ? "by bill date" : "by delivered date",
    route ? `${route.routeCode} · ${route.routeName}` : "all routes",
    shop ? `${shop.shopCode} · ${shop.shopName}` : "all stores",
    ...(kind === "all" ? [] : [`${KIND_LABELS[kind].toLowerCase()} invoices`]),
    ...(show === "all" ? [] : [SHOW_LABELS[show].toLowerCase()]),
  ].join(" · ");

  return (
    <>
      {/* The invoices view prints as the cash sheet below instead of this screen */}
      <div className={cn(view === "invoices" && "print:hidden")}>
        <PageHeader
          title={view === "items" ? "Loading List" : "Daily Invoices"}
          description={summary}
          actions={
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button variant="outline" onClick={() => setSyncing(true)} title="Add and update bills from Raigam's system for a date range">
                <CloudDownload /> Sync from Raigam
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> {view === "invoices" ? "Print cash sheet" : "Print"}
              </Button>
              <Button variant="outline" onClick={() => setLoading(true)}>
                <Truck /> Load lorry{toLoad.length > 0 && ` (${toLoad.length})`}
              </Button>
              <Link href={shopId ? `/sales/new?store=${shopId}` : "/sales/new"} className={buttonClass()}>
                <Plus /> New bill
              </Link>
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Same figures as Raigam's invoice page, for the tab picked below */}
          <SummaryTile
            label="Invoice count"
            value={formatQty(counted(rows).length)}
            sub={`${plural(sum(rows, units), "unit")} · ${plural(byDay.size, "day")}${kind === "all" && cancelled ? ` · ${cancelled} cancelled not counted` : ""}`}
          />
          <SummaryTile
            label={`${kind === "all" ? "Invoice" : KIND_LABELS[kind]} total value`}
            value={formatMoney(total)}
            sub={counted(rows).length ? `Average ${formatMoney(total / counted(rows).length)}` : "No invoices"}
          />
          <SummaryTile label="Collected" value={formatMoney(paid)} sub="Paid against these invoices" tone="good" />
          <SummaryTile
            label="Cash balance"
            value={formatMoney(balance)}
            sub={
              overdue.length
                ? `${plural(overdue.length, "invoice")} overdue`
                : notDelivered.length
                  ? `${plural(notDelivered.length, "invoice")} not delivered yet`
                  : "Still to collect"
            }
            tone={overdue.length ? "danger" : "default"}
          />
        </div>

        <div className="mt-6 print:hidden">
          <FilterTabs<View>
            value={view}
            onChange={setView}
            options={[
              { value: "invoices", label: "Invoices", count: rows.length },
              { value: "items", label: "Loading list (item totals)", count: itemCount },
            ]}
          />
        </div>

        <Card className="mt-3">
          <div className="print:hidden">
            <Toolbar>
              <FilterTabs<Preset>
                value={preset}
                onChange={choosePreset}
                options={[
                  { value: "today", label: "Today" },
                  { value: "yesterday", label: "Yesterday" },
                  { value: "week", label: "This week" },
                  { value: "month", label: "This month" },
                  { value: "all", label: "All dates" },
                ]}
              />
              <DateRangePicker value={preset === "all" ? { from: "", to: "" } : range} onChange={chooseRange} />
              <Select
                value={dateBy}
                onChange={(e) => setDateBy(e.target.value as DateBy)}
                className="h-9 sm:ml-auto sm:w-44"
                aria-label="Which date to use"
              >
                <option value="bill">By bill date</option>
                <option value="delivered">By delivered date</option>
              </Select>
            </Toolbar>
            <Toolbar>
              {view === "items" ? (
                <SearchInput placeholder="Search item…" value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} />
              ) : (
                <SearchInput placeholder="Search bill, Raigam invoice, store or rep" value={query} onChange={(e) => setQuery(e.target.value)} />
              )}
              <Select value={routeId} onChange={(e) => chooseRoute(e.target.value)} className="h-9 sm:w-56" aria-label="Filter by route">
                <option value="">All routes</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.routeCode} · {r.routeName}
                  </option>
                ))}
              </Select>
              <Select value={shopId} onChange={(e) => setShopId(e.target.value)} className="h-9 sm:w-64" aria-label="Filter by store">
                <option value="">{route ? `All stores on ${route.routeCode}` : "All stores"}</option>
                {shopOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shopCode} · {s.shopName}
                    {s.active ? "" : " (inactive)"}
                  </option>
                ))}
              </Select>
              <Select value={show} onChange={(e) => setShow(e.target.value as Show)} className="h-9 sm:w-56" aria-label="Show bills that are">
                <option value="all">{SHOW_LABELS.all}</option>
                <optgroup label="Loading">
                  <option value="toLoad">{SHOW_LABELS.toLoad}</option>
                  <option value="onLorry">{SHOW_LABELS.onLorry}</option>
                </optgroup>
                <optgroup label="Collecting">
                  <option value="due">{SHOW_LABELS.due}</option>
                  <option value="overdue">{SHOW_LABELS.overdue}</option>
                  <option value="paid">{SHOW_LABELS.paid}</option>
                </optgroup>
                <optgroup label="Raigam's printed bill">
                  <option value="unchecked">{SHOW_LABELS.unchecked}</option>
                  <option value="checked">{SHOW_LABELS.checked}</option>
                </optgroup>
              </Select>
              {view === "invoices" && show === "unchecked" && toCheck.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setCheckingAll(true)}>
                  <CircleCheck /> Mark {plural(toCheck.length, "bill")} checked
                </Button>
              )}
              <div className="sm:ml-auto">
                <FilterTabs<Kind>
                  value={kind}
                  onChange={setKind}
                  options={(Object.keys(KIND_LABELS) as Kind[]).map((k) => ({
                    value: k,
                    label: KIND_LABELS[k],
                    count: k === "all" ? inView.length : inView.filter((s) => kindOf(s) === k).length,
                  }))}
                />
              </div>
            </Toolbar>
          </div>

          {view === "items" ? (
            <LoadingList sales={live} query={itemQuery} />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Bill No.</TH>
                    <TH>Store</TH>
                    <TH>Items</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Paid</TH>
                    <TH className="text-right">Cash Balance</TH>
                    <TH>Status</TH>
                    <TH className="print:hidden" title="Compared with Raigam's printed bill">
                      Checked
                    </TH>
                    <TH className="print:hidden">Change Status</TH>
                    <TH className="w-28 print:hidden">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.length === 0 && (
                    <EmptyRow colSpan={10}>
                      No {kind === "all" ? "" : `${KIND_LABELS[kind].toLowerCase()} `}invoices{preset === "all" ? "" : " for these dates"}
                      {dateBy === "delivered" ? " (only delivered bills have a delivered date)" : ""}.
                    </EmptyRow>
                  )}
                  {pageDays.map(([day, list]) => {
                    const all = byDay.get(day)!;
                    return (
                    <DayGroup key={day} day={day} count={counted(all).length} total={sum(all, (s) => due(s).total)} paid={sum(all, (s) => due(s).paid)} balance={sum(all, (s) => due(s).due)}>
                      {list.map((s) => {
                        const shop = shopMap.get(s.shopId);
                        const d = due(s);
                        return (
                          <TR
                            key={s.id}
                            className={cn("cursor-pointer", d.overdueDays > 0 && "bg-red-50/40", s.status === "Cancelled" && "bg-slate-50/70 opacity-70")}
                            onClick={() => router.push(`/sales/${s.id}`)}
                          >
                            <TD>
                              <span className="block font-semibold text-brand-700">{s.saleNo}</span>
                              {s.invoiceNo && <span className="block font-mono text-xs text-slate-600">{s.invoiceNo}</span>}
                              <span className="block text-xs text-slate-500">
                                {dateBy === "delivered" ? `Billed ${formatDate(s.date)}` : s.repName || "—"}
                              </span>
                            </TD>
                            <TD className="whitespace-normal">
                              <span className="block font-medium text-slate-900">{shop?.shopName ?? "Deleted store"}</span>
                              <span className="block text-xs text-slate-500">
                                {shop?.shopCode}
                                {shop && routeMap.get(shop.routeId) ? ` · ${routeMap.get(shop.routeId)!.routeCode}` : ""}
                              </span>
                            </TD>
                            <TD>
                              <span className="block">{plural(s.lines.length, "item")}</span>
                              <span className="block text-xs text-slate-500">{plural(units(s), "unit")}</span>
                              <BillFlags sale={s} itemMap={itemMap} />
                            </TD>
                            <TD className="text-right tabular-nums">{formatMoney(d.total)}</TD>
                            <TD className="text-right text-emerald-700 tabular-nums">{d.paid ? formatMoney(d.paid) : "—"}</TD>
                            <TD className={cn("text-right font-semibold tabular-nums", d.due > 0 ? "text-slate-900" : "text-slate-400")}>
                              {d.delivered ? formatMoney(d.due) : "—"}
                              {/* The end date to collect it by */}
                              {d.delivered && d.due > 0 && (
                                <span className="block text-xs font-normal">
                                  <DueDateLabel dueDate={s.dueDate} due={d.due} overdueDays={d.overdueDays} />
                                </span>
                              )}
                            </TD>
                            <TD>
                              <BillStatusBadge status={d.status} late={s.late} />
                            </TD>
                            <TD className="print:hidden" onClick={(e) => e.stopPropagation()}>
                              <CheckedToggle sale={s} />
                            </TD>
                            <TD className="print:hidden" onClick={(e) => e.stopPropagation()}>
                              <BillStatusMenu sale={s} />
                            </TD>
                            <TD className="print:hidden" onClick={(e) => e.stopPropagation()}>
                              <RowActions>
                                <Link href={`/sales/${s.id}`} className={buttonClass("ghost", "icon")} aria-label={`View ${s.saleNo}`} title="View">
                                  <Eye />
                                </Link>
                                {s.status !== "Cancelled" && (
                                  <Link href={`/sales/${s.id}/edit`} className={buttonClass("ghost", "icon")} aria-label={`Edit ${s.saleNo}`} title="Edit">
                                    <Pencil />
                                  </Link>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="hover:bg-red-50 hover:text-red-600"
                                  onClick={() => remove.open(s)}
                                  aria-label={`Delete ${s.saleNo}`}
                                  title="Delete"
                                >
                                  <Trash2 />
                                </Button>
                              </RowActions>
                            </TD>
                          </TR>
                        );
                      })}
                    </DayGroup>
                    );
                  })}
                </TBody>
              </Table>
              <TableFooter pager={<Pagination pager={pager} />}>
                {kind === "cancelled" ? plural(rows.length, "cancelled invoice") : plural(live.length, "invoice")} on {plural(byDay.size, "day")}
                {kind !== "cancelled" && cancelled > 0 && ` (+ ${cancelled} cancelled, not counted)`} · Total {formatMoney(total)} · Paid {formatMoney(paid)} ·{" "}
                <span className="font-medium text-slate-700">Cash balance {formatMoney(balance)}</span>
              </TableFooter>
            </>
          )}
        </Card>
      </div>

      {view === "invoices" && (
        <CashSheet sales={live} dateOf={dateOf} period={period} route={route} storeName={shop?.shopName} />
      )}

      <LoadLorryDialog open={loading} onClose={() => setLoading(false)} preselect={preselect} />
      {/* At least the last week, so new bills and changes to recent ones come in even when the page shows only today */}
      {syncing && (
        <RaigamSyncDialog
          from={preset === "all" ? addDays(todayISO(), -(SYNC_DAYS - 1)) : [from, addDays(todayISO(), -(SYNC_DAYS - 1))].sort()[0]}
          to={preset === "all" ? todayISO() : [to, todayISO()].sort()[1]}
          onClose={() => setSyncing(false)}
        />
      )}
      <ConfirmDialog
        open={checkingAll}
        onClose={() => setCheckingAll(false)}
        tone="primary"
        confirmLabel="Mark checked"
        title={`Mark ${plural(toCheck.length, "bill")} checked?`}
        message="Only once you've compared each of them with Raigam's printed bill. You can untick a bill again in its Checked column."
        onConfirm={async () => {
          const result = await markChecked(
            toCheck.map((s) => s.id),
            true,
          );
          if (result.ok) toast.success(`${plural(toCheck.length, "bill")} marked checked`);
          else toast.error(result.error);
          setCheckingAll(false);
        }}
      />
      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title={`Delete ${remove.target?.saleNo}?`}
        message={
          remove.target?.status === "Delivered"
            ? "The items go back into stock. Any payments linked to this bill stay with the store as an advance."
            : remove.target?.status === "Loaded"
              ? "The items on the lorry go back into stock."
              : "This bill hasn't been loaded, so no stock or cash balance changes."
        }
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteSale(remove.target.id);
          if (result.ok) toast.success(`${remove.target.saleNo} deleted`);
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}

/** A day's heading row with its totals, followed by that day's invoices */
function DayGroup({
  day,
  count,
  total,
  paid,
  balance,
  children,
}: {
  day: string;
  count: number;
  total: number;
  paid: number;
  balance: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr className="bg-slate-100/80">
        <td colSpan={10} className="px-5 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <span className="text-sm font-semibold text-slate-900">{dayLabel(day)}</span>
            <span className="text-xs text-slate-600 tabular-nums">
              {plural(count, "invoice")} · Total <span className="font-semibold text-slate-900">{formatMoney(total)}</span> · Paid{" "}
              {formatMoney(paid)} · Balance {formatMoney(balance)}
            </span>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}
