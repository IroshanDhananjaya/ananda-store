"use client";

import { Eye, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActiveBadge, Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useRouteMap, useShopBalances } from "@/lib/store";
import { formatPct, returnRate, returnSplit, type ReturnRate } from "@/lib/returns";
import type { Shop } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatMoney, includesText } from "@/lib/utils";
import { ShopFormDialog } from "./shop-form-dialog";

type Filter = "all" | "owing" | "over" | "inactive";

export function ShopsPage() {
  const router = useRouter();
  const shops = useAppStore((s) => s.shops);
  const routes = useAppStore((s) => s.routes);
  const sales = useAppStore((s) => s.sales);
  const deleteShop = useAppStore((s) => s.deleteShop);
  const routeMap = useRouteMap();
  const balances = useShopBalances();
  const [query, setQuery] = useState("");
  const [routeId, setRouteId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const form = useDialog<Shop | "new">();
  const remove = useDialog<Shop>();

  const balanceOf = (s: Shop) => balances.get(s.id)?.balance ?? 0;
  // Each store's returns against what it bought (all its bills)
  const rates = useMemo(() => {
    const map = new Map<string, ReturnRate>();
    for (const [shopId, list] of Map.groupBy(sales, (s) => s.shopId)) map.set(shopId, returnRate(list));
    return map;
  }, [sales]);
  const matches: Record<Filter, (s: Shop) => boolean> = {
    all: () => true,
    owing: (s) => balanceOf(s) > 0,
    over: (s) => balanceOf(s) > s.creditLimit,
    inactive: (s) => !s.active,
  };

  const rows = shops
    .filter((s) => !routeId || s.routeId === routeId)
    .filter(matches[filter])
    .filter((s) => includesText([s.shopCode, s.shopName, s.ownerName, s.phone, s.town, s.address], query))
    .sort((a, b) => a.shopCode.localeCompare(b.shopCode));
  const total = rows.reduce((sum, s) => sum + balanceOf(s), 0);

  const pager = usePagination(rows, [query, routeId, filter]);

  return (
    <>
      <PageHeader
        title="Stores"
        description="Shops you sell to: owner, location, route and cash balance."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Add store
          </Button>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search name, owner, phone or town" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="h-9 sm:w-56" aria-label="Filter by route">
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
                { value: "all", label: "All", count: shops.length },
                { value: "owing", label: "Owes money", count: shops.filter(matches.owing).length },
                { value: "over", label: "Over limit", count: shops.filter(matches.over).length },
                { value: "inactive", label: "Inactive", count: shops.filter(matches.inactive).length },
              ]}
            />
          </div>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Store No.</TH>
              <TH>Store Name</TH>
              <TH>Phone</TH>
              <TH>Location</TH>
              <TH>Route</TH>
              <TH className="text-right">Credit Limit</TH>
              <TH className="text-right">Cash Balance</TH>
              <TH className="text-right" title="Value of returns ÷ value of items sold to the store">
                Return %
              </TH>
              <TH>Status</TH>
              <TH className="w-28">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={10}>No stores found.</EmptyRow>}
            {pager.pageRows.map((s) => {
              const balance = balanceOf(s);
              const over = balance > s.creditLimit;
              const route = routeMap.get(s.routeId);
              return (
                <TR key={s.id} className={cn("cursor-pointer", !s.active && "opacity-60")} onClick={() => router.push(`/stores/${s.id}`)}>
                  <TD className="font-semibold text-brand-700">{s.shopCode}</TD>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{s.shopName}</span>
                    <span className="block text-xs text-slate-500">{s.ownerName || "—"}</span>
                  </TD>
                  <TD className="tabular-nums">{s.phone || "—"}</TD>
                  <TD className="whitespace-normal">
                    <span className="flex items-center gap-1.5">
                      {s.town || "—"}
                      {s.mapLink && (
                        <a
                          href={s.mapLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-brand-600 hover:text-brand-800"
                          title="Open in Google Maps"
                        >
                          <MapPin className="size-3.5" />
                        </a>
                      )}
                    </span>
                    <span className="block text-xs text-slate-500">{s.address}</span>
                  </TD>
                  <TD>{route ? route.routeCode : "—"}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(s.creditLimit)}</TD>
                  <TD className="text-right">
                    <span className={cn("font-semibold tabular-nums", over ? "text-red-600" : balance > 0 ? "text-slate-900" : "text-slate-500")}>
                      {formatMoney(balance)}
                    </span>
                    {over && <span className="block text-xs font-medium text-red-600">Over limit</span>}
                    {(balances.get(s.id)?.overdue ?? 0) > 0 && (
                      <span className="block text-xs font-medium text-red-600">{formatMoney(balances.get(s.id)!.overdue)} overdue</span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {(() => {
                      const r = rates.get(s.id);
                      if (!r || r.sold <= 0) return <span className="text-slate-400">—</span>;
                      return (
                        <>
                          <span className={cn(r.pct > 0 ? "font-medium text-slate-900" : "text-slate-500")}>{formatPct(r.pct)}</span>
                          {r.returned > 0 && <span className="block text-xs text-slate-500">{returnSplit(r)}</span>}
                        </>
                      );
                    })()}
                  </TD>
                  <TD>
                    <ActiveBadge active={s.active} />
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <RowActions>
                      <Link href={`/stores/${s.id}`} className={buttonClass("ghost", "icon")} aria-label={`View ${s.shopName}`} title="View">
                        <Eye />
                      </Link>
                      <Button variant="ghost" size="icon" onClick={() => form.open(s)} aria-label={`Edit ${s.shopName}`} title="Edit">
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove.open(s)}
                        aria-label={`Delete ${s.shopName}`}
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
          {rows.length} stores · <span className="font-medium text-slate-700">{formatMoney(total)}</span> cash balance outstanding
        </TableFooter>
      </Card>

      <ShopFormDialog open={form.isOpen} shop={form.target === "new" ? null : form.target} onClose={form.close} />
      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title={`Delete ${remove.target?.shopName}?`}
        message={
          <>
            Stores with sales or payments can&apos;t be deleted. Mark them <Badge tone="slate">Inactive</Badge> instead.
          </>
        }
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteShop(remove.target.id);
          if (result.ok) toast.success("Store deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
