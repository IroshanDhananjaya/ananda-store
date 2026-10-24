"use client";

import { Eye, Pencil, Plus, Printer, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LoadLorryDialog } from "@/components/sales/load-lorry-dialog";
import { BillStatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useRouteMap, useSaleDues, useShopMap } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { addDays, cn, formatDate, formatMoney, formatQty, monthStartISO, todayISO, weekdayOf, weekStartISO } from "@/lib/utils";
import { BillStatusMenu } from "@/components/sales/bill-status-menu";
import { LoadingList } from "./loading-list";

type Preset = "today" | "yesterday" | "week" | "month" | "custom";
/** Which date puts an invoice on a day: when the bill was written, or when it was delivered */
type DateBy = "bill" | "delivered";
/** Bills day by day, or item totals across them (loading list) */
type View = "invoices" | "items";

function presetRange(preset: Exclude<Preset, "custom">) {
  const today = todayISO();
  if (preset === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (preset === "week") return { from: weekStartISO(today), to: today };
  if (preset === "month") return { from: monthStartISO(), to: today };
  return { from: today, to: today };
}

const dayLabel = (iso: string) => `${weekdayOf(iso)} ${formatDate(iso)}`;
const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;

/** /invoices — ?route=<id> and ?store=<id> preselect the filters; ?view=items opens the loading list (item totals) */
export function InvoicesRoute() {
  const params = useSearchParams();
  return (
    <InvoicesPage
      key={params.toString()}
      initialRouteId={params.get("route") ?? ""}
      initialShopId={params.get("store") ?? ""}
      initialView={params.get("view") === "items" ? "items" : "invoices"}
    />
  );
}

function InvoicesPage({ initialRouteId, initialShopId, initialView }: { initialRouteId: string; initialShopId: string; initialView: View }) {
  const router = useRouter();
  const sales = useAppStore((s) => s.sales);
  const routes = useAppStore((s) => s.routes);
  const shops = useAppStore((s) => s.shops);
  const deleteSale = useAppStore((s) => s.deleteSale);
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const dues = useSaleDues();

  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState(() => presetRange("today"));
  const [routeId, setRouteId] = useState(initialRouteId);
  const [shopId, setShopId] = useState(initialShopId);
  const [dateBy, setDateBy] = useState<DateBy>("bill");
  const [view, setView] = useState<View>(initialView);
  const [itemQuery, setItemQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const remove = useDialog<Sale>();

  // A From date after the To date is read the other way round
  const [from, to] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
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
  const rows = sales
    .filter((s) => {
      const d = dateOf(s);
      return !!d && d >= from && d <= to;
    })
    .filter((s) => !routeId || shopMap.get(s.shopId)?.routeId === routeId)
    .filter((s) => !shopId || s.shopId === shopId)
    // Newest day first; within a day, in bill order
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || a.saleNo.localeCompare(b.saleNo));

  const days = [...Map.groupBy(rows, dateOf)];
  // Cancelled bills stay in the list but don't count in totals or the loading list
  const counted = (list: Sale[]) => list.filter((s) => s.status !== "Cancelled");
  const live = counted(rows);
  const cancelled = rows.length - live.length;
  const itemCount = new Set(live.flatMap((s) => s.lines.map((l) => l.sapCode))).size;

  const due = (s: Sale) => dues.get(s.id)!;
  const sum = (list: Sale[], fn: (s: Sale) => number) => counted(list).reduce((acc, s) => acc + fn(s), 0);
  const units = (s: Sale) => s.lines.reduce((n, l) => n + l.qty, 0);
  const total = sum(rows, (s) => due(s).total);
  const paid = sum(rows, (s) => due(s).paid);
  const balance = sum(rows, (s) => due(s).due);
  const notDelivered = live.filter((s) => !due(s).delivered);
  const overdue = live.filter((s) => due(s).overdueDays > 0);

  // Bills in view still waiting to load; preselected in Load lorry when they share a route
  const toLoad = rows.filter((s) => s.status === "Ordered");
  const loadRoutes = new Set(toLoad.map((s) => shopMap.get(s.shopId)?.routeId));
  const preselect = loadRoutes.size === 1 ? toLoad.map((s) => s.id) : [];

  const route = routeMap.get(routeId);
  const shop = shopMap.get(shopId);
  const summary = [
    from === to ? dayLabel(from) : `${formatDate(from)} – ${formatDate(to)}`,
    dateBy === "bill" ? "by bill date" : "by delivered date",
    route ? `${route.routeCode} · ${route.routeName}` : "all routes",
    shop ? `${shop.shopCode} · ${shop.shopName}` : "all stores",
  ].join(" · ");

  return (
    <>
      <PageHeader
        title={view === "items" ? "Loading List" : "Daily Invoices"}
        description={summary}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Print
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
        <SummaryTile
          label="Invoices"
          value={formatQty(rows.length)}
          sub={`${plural(sum(rows, units), "unit")} · ${plural(days.length, "day")}`}
        />
        <SummaryTile
          label="Invoice total"
          value={formatMoney(total)}
          sub={rows.length ? `Average ${formatMoney(total / rows.length)}` : "No invoices"}
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
                { value: "custom", label: "Custom" },
              ]}
            />
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Input
                type="date"
                value={range.from}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, from: e.target.value || r.from }));
                }}
                className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none"
                aria-label="From date"
              />
              <span className="text-sm text-slate-500">to</span>
              <Input
                type="date"
                value={range.to}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, to: e.target.value || r.to }));
                }}
                className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none"
                aria-label="To date"
              />
            </div>
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
            {view === "items" && (
              <SearchInput
                placeholder="Search item…"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                className="sm:ml-auto"
              />
            )}
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
                  <TH className="print:hidden">Change Status</TH>
                  <TH className="w-28 print:hidden">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.length === 0 && (
                  <EmptyRow colSpan={9}>
                    No invoices for these dates{dateBy === "delivered" ? " (only delivered bills have a delivered date)" : ""}.
                  </EmptyRow>
                )}
                {days.map(([day, list]) => (
                  <DayGroup key={day} day={day} count={counted(list).length} total={sum(list, (s) => due(s).total)} paid={sum(list, (s) => due(s).paid)} balance={sum(list, (s) => due(s).due)}>
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
                          </TD>
                          <TD className="text-right tabular-nums">{formatMoney(d.total)}</TD>
                          <TD className="text-right text-emerald-700 tabular-nums">{d.paid ? formatMoney(d.paid) : "—"}</TD>
                          <TD className={cn("text-right font-semibold tabular-nums", d.due > 0 ? "text-slate-900" : "text-slate-400")}>
                            {d.delivered ? formatMoney(d.due) : "—"}
                          </TD>
                          <TD>
                            <BillStatusBadge status={d.status} late={s.late} />
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
                ))}
              </TBody>
            </Table>
            <TableFooter>
              {plural(live.length, "invoice")} on {plural(days.length, "day")}
              {cancelled > 0 && ` (+ ${cancelled} cancelled, not counted)`} · Total {formatMoney(total)} · Paid {formatMoney(paid)} ·{" "}
              <span className="font-medium text-slate-700">Cash balance {formatMoney(balance)}</span>
            </TableFooter>
          </>
        )}
      </Card>

      <LoadLorryDialog open={loading} onClose={() => setLoading(false)} preselect={preselect} />
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
        <td colSpan={9} className="px-5 py-2">
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
