"use client";

import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActiveBadge, DayChips } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useShopBalances } from "@/lib/store";
import { WEEK_DAYS, type Route, type WeekDay } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatMoney, includesText } from "@/lib/utils";
import { RouteFormDialog } from "./route-form-dialog";

type DayFilter = "all" | "today";

export function RoutesPage() {
  const router = useRouter();
  const routes = useAppStore((s) => s.routes);
  const shops = useAppStore((s) => s.shops);
  const deleteRoute = useAppStore((s) => s.deleteRoute);
  const balances = useShopBalances();
  const [query, setQuery] = useState("");
  const [day, setDay] = useState<DayFilter>("all");
  const form = useDialog<Route | "new">();
  const remove = useDialog<Route>();

  const today = WEEK_DAYS[(new Date().getDay() + 6) % 7] as WeekDay;

  const stats = useMemo(() => {
    const map = new Map<string, { shops: number; balance: number }>();
    for (const s of shops) {
      const m = map.get(s.routeId) ?? { shops: 0, balance: 0 };
      map.set(s.routeId, { shops: m.shops + (s.active ? 1 : 0), balance: m.balance + (balances.get(s.id)?.balance ?? 0) });
    }
    return map;
  }, [shops, balances]);

  const rows = routes
    .filter((r) => day === "all" || r.visitDays.includes(today))
    .filter((r) => includesText([r.routeCode, r.routeName, r.area, r.salesRep, r.vehicleNumber], query))
    .sort((a, b) => a.routeCode.localeCompare(b.routeCode));
  const totalBalance = rows.reduce((sum, r) => sum + (stats.get(r.id)?.balance ?? 0), 0);

  const pager = usePagination(rows, [query, day]);

  return (
    <>
      <PageHeader
        title="Routes"
        description="Delivery routes, the days they are visited and who covers them."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Add route
          </Button>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search route, area, rep or vehicle" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="sm:ml-auto">
            <FilterTabs<DayFilter>
              value={day}
              onChange={setDay}
              options={[
                { value: "all", label: "All routes", count: routes.length },
                { value: "today", label: `Today (${today})`, count: routes.filter((r) => r.visitDays.includes(today)).length },
              ]}
            />
          </div>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Route No.</TH>
              <TH>Route Name</TH>
              <TH>Visit Days</TH>
              <TH>Sales Rep</TH>
              <TH className="text-right">Stores</TH>
              <TH className="text-right">Cash Balance</TH>
              <TH>Status</TH>
              <TH className="w-28">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No routes found.</EmptyRow>}
            {pager.pageRows.map((r) => {
              const s = stats.get(r.id);
              return (
                <TR key={r.id} className="cursor-pointer" onClick={() => router.push(`/routes/${r.id}`)}>
                  <TD className="font-semibold text-brand-700">{r.routeCode}</TD>
                  <TD className="whitespace-normal">
                    <span className="block font-medium text-slate-900">{r.routeName}</span>
                    <span className="block text-xs text-slate-500">{r.area || "—"}</span>
                  </TD>
                  <TD>
                    <DayChips days={r.visitDays} />
                  </TD>
                  <TD>
                    <span className="block">{r.salesRep || "—"}</span>
                    <span className="block text-xs text-slate-500">{r.vehicleNumber}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{s?.shops ?? 0}</TD>
                  <TD className={cn("text-right font-medium tabular-nums", (s?.balance ?? 0) > 0 ? "text-slate-900" : "text-slate-500")}>
                    {formatMoney(s?.balance ?? 0)}
                  </TD>
                  <TD>
                    <ActiveBadge active={r.active} />
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <RowActions>
                      <Link href={`/routes/${r.id}`} className={buttonClass("ghost", "icon")} aria-label={`View ${r.routeCode}`} title="View">
                        <Eye />
                      </Link>
                      <Button variant="ghost" size="icon" onClick={() => form.open(r)} aria-label={`Edit ${r.routeCode}`} title="Edit">
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove.open(r)}
                        aria-label={`Delete ${r.routeCode}`}
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
          {rows.length} routes · {formatMoney(totalBalance)} outstanding
        </TableFooter>
      </Card>

      <RouteFormDialog open={form.isOpen} route={form.target === "new" ? null : form.target} onClose={form.close} />
      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title={`Delete ${remove.target?.routeCode}?`}
        message={
          <>
            <span className="font-medium text-slate-900">{remove.target?.routeName}</span> will be deleted. Routes that still have
            stores can&apos;t be deleted.
          </>
        }
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteRoute(remove.target.id);
          if (result.ok) toast.success("Route deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
