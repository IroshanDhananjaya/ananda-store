"use client";

import { Eye, ListChecks, Pencil, Plus, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BillStatusBadge, DueDateLabel } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useRouteMap, useSaleDues, useShopMap } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatMoney, includesText } from "@/lib/utils";
import { LoadLorryDialog } from "./load-lorry-dialog";

type Filter = "all" | "toLoad" | "onLorry" | "due" | "overdue" | "paid" | "cancelled";
const FILTERS: Filter[] = ["all", "toLoad", "onLorry", "due", "overdue", "paid", "cancelled"];

/** /sales — ?filter=overdue etc. picks the starting filter, ?load=1 opens the Load lorry dialog */
export function SalesRoute() {
  const params = useSearchParams();
  const f = params.get("filter") as Filter | null;
  return <SalesPage key={params.toString()} initialFilter={f && FILTERS.includes(f) ? f : "all"} openLoad={params.get("load") === "1"} />;
}

function SalesPage({ initialFilter, openLoad }: { initialFilter: Filter; openLoad: boolean }) {
  const router = useRouter();
  const sales = useAppStore((s) => s.sales);
  const routes = useAppStore((s) => s.routes);
  const deleteSale = useAppStore((s) => s.deleteSale);
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const dues = useSaleDues();
  const [query, setQuery] = useState("");
  const [routeId, setRouteId] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [loading, setLoading] = useState(openLoad);
  const remove = useDialog<Sale>();

  const dueOf = (s: Sale) => dues.get(s.id)?.due ?? 0;
  const matches: Record<Filter, (s: Sale) => boolean> = {
    all: () => true,
    toLoad: (s) => s.status === "Ordered",
    onLorry: (s) => s.status === "Loaded",
    due: (s) => dueOf(s) > 0,
    overdue: (s) => (dues.get(s.id)?.overdueDays ?? 0) > 0,
    paid: (s) => s.status === "Delivered" && dueOf(s) <= 0,
    cancelled: (s) => s.status === "Cancelled",
  };

  const rows = sales
    .filter((s) => !routeId || shopMap.get(s.shopId)?.routeId === routeId)
    .filter(matches[filter])
    .filter((s) => {
      const shop = shopMap.get(s.shopId);
      return includesText([s.saleNo, s.invoiceNo, s.repName, shop?.shopName, shop?.shopCode, shop?.ownerName], query);
    })
    .sort((a, b) => {
      // To collect: soonest end date first. Pending: oldest order first. Otherwise newest first.
      if (filter === "due" || filter === "overdue") return a.dueDate.localeCompare(b.dueDate) || a.saleNo.localeCompare(b.saleNo);
      if (filter === "toLoad" || filter === "onLorry") return a.date.localeCompare(b.date) || a.saleNo.localeCompare(b.saleNo);
      return b.date.localeCompare(a.date) || b.saleNo.localeCompare(a.saleNo);
    });

  // Cancelled bills are listed but not counted in the totals
  const sum = (fn: (s: Sale) => number) => rows.reduce((acc, s) => acc + (s.status === "Cancelled" ? 0 : fn(s)), 0);

  const pager = usePagination(rows, [query, routeId, filter]);

  return (
    <>
      <PageHeader
        title="Store Orders"
        description="Bills the rep creates → load on the lorry (stock goes down) → deliver and collect cash → follow up the balance before the end date."
        actions={
          <>
            <Link href="/invoices?view=items" className={buttonClass("outline")} title="Total of each item across the bills for a date range">
              <ListChecks /> Item totals
            </Link>
            <Button variant="outline" onClick={() => setLoading(true)}>
              <Truck /> Load lorry
            </Button>
            <Link href="/sales/new" className={buttonClass()}>
              <Plus /> New bill
            </Link>
          </>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search bill no., Raigam invoice, store or rep" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="h-9 sm:w-52" aria-label="Filter by route">
            <option value="">All routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.routeCode} · {r.routeName}
              </option>
            ))}
          </Select>
          <div className="sm:ml-auto">
            <FilterTabs<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: sales.length },
                { value: "toLoad", label: "To load", count: sales.filter(matches.toLoad).length },
                { value: "onLorry", label: "On lorry", count: sales.filter(matches.onLorry).length },
                { value: "due", label: "Has cash balance", count: sales.filter(matches.due).length },
                { value: "overdue", label: "Overdue", count: sales.filter(matches.overdue).length },
                { value: "paid", label: "Paid", count: sales.filter(matches.paid).length },
                { value: "cancelled", label: "Cancelled", count: sales.filter(matches.cancelled).length },
              ]}
            />
          </div>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Bill No.</TH>
              <TH>Bill Date</TH>
              <TH>Store</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Cash Balance</TH>
              <TH>End Date</TH>
              <TH>Status</TH>
              <TH className="w-28">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={9}>No orders found.</EmptyRow>}
            {pager.pageRows.map((s) => {
              const shop = shopMap.get(s.shopId);
              const d = dues.get(s.id)!;
              return (
                <TR key={s.id} className={cn("cursor-pointer", d.overdueDays > 0 && "bg-red-50/40")} onClick={() => router.push(`/sales/${s.id}`)}>
                  <TD>
                    <span className="block font-semibold text-brand-700">{s.saleNo}</span>
                    {s.invoiceNo && <span className="block font-mono text-xs text-slate-600">{s.invoiceNo}</span>}
                    <span className="block text-xs text-slate-500">{s.repName || "—"}</span>
                  </TD>
                  <TD className="tabular-nums">{formatDate(s.date)}</TD>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{shop?.shopName ?? "Deleted store"}</span>
                    <span className="block text-xs text-slate-500">
                      {shop?.shopCode}
                      {shop && routeMap.get(shop.routeId) ? ` · ${routeMap.get(shop.routeId)!.routeCode}` : ""}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{formatMoney(d.total)}</TD>
                  <TD className="text-right text-emerald-700 tabular-nums">{d.paid ? formatMoney(d.paid) : "—"}</TD>
                  <TD className={cn("text-right font-semibold tabular-nums", d.due > 0 ? "text-slate-900" : "text-slate-400")}>
                    {d.delivered ? formatMoney(d.due) : "—"}
                  </TD>
                  <TD>
                    {/* The end date is set when the bill is delivered (the store's credit days after delivery) */}
                    {d.delivered ? (
                      <DueDateLabel dueDate={s.dueDate} due={d.due} overdueDays={d.overdueDays} />
                    ) : s.status === "Cancelled" ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="text-xs text-slate-500">After delivery</span>
                    )}
                  </TD>
                  <TD>
                    <BillStatusBadge status={d.status} late={s.late} />
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <RowActions>
                      <Link href={`/sales/${s.id}`} className={buttonClass("ghost", "icon")} aria-label={`View ${s.saleNo}`} title="View">
                        <Eye />
                      </Link>
                      <Link href={`/sales/${s.id}/edit`} className={buttonClass("ghost", "icon")} aria-label={`Edit ${s.saleNo}`} title="Edit">
                        <Pencil />
                      </Link>
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
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length} orders · Total {formatMoney(sum((s) => dues.get(s.id)?.total ?? 0))} · Paid {formatMoney(sum((s) => dues.get(s.id)?.paid ?? 0))} ·{" "}
          <span className="font-medium text-slate-700">Cash balance {formatMoney(sum(dueOf))}</span>
        </TableFooter>
      </Card>

      <LoadLorryDialog open={loading} onClose={() => setLoading(false)} />
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
