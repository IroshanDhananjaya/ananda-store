"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useRouteMap, useShopMap } from "@/lib/store";
import { OPENING_BILL, PAYMENT_METHODS, type Payment, type PaymentMethod } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { formatDate, formatMoney, includesText } from "@/lib/utils";
import { unlinkedAmount } from "@/lib/ledger";
import { PaymentFormDialog } from "./payment-form-dialog";

type Filter = "all" | PaymentMethod;
const methodTone = { Cash: "green", Cheque: "amber", "Bank Transfer": "blue" } as const;

export function PaymentsPage() {
  const payments = useAppStore((s) => s.payments);
  const routes = useAppStore((s) => s.routes);
  const deletePayment = useAppStore((s) => s.deletePayment);
  const sales = useAppStore((s) => s.sales);
  const saleNoById = useMemo(() => new Map(sales.map((s) => [s.id, s.saleNo])), [sales]);
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const [query, setQuery] = useState("");
  const [routeId, setRouteId] = useState("");
  const [method, setMethod] = useState<Filter>("all");
  const form = useDialog<Payment | "new">();
  const remove = useDialog<Payment>();

  const rows = payments
    .filter((p) => method === "all" || p.method === method)
    .filter((p) => !routeId || shopMap.get(p.shopId)?.routeId === routeId)
    .filter((p) => {
      const shop = shopMap.get(p.shopId);
      const bills = p.allocations.map((a) => saleNoById.get(a.saleId));
      return includesText([p.receiptNo, p.chequeNumber, p.reference, shop?.shopName, shop?.shopCode, ...bills], query);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo));
  const total = rows.reduce((sum, p) => sum + p.amount, 0);

  const pager = usePagination(rows, [query, routeId, method]);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every rupee collected from stores (at delivery or later), and which bills it paid."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Record payment
          </Button>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search receipt, bill, store or cheque no." value={query} onChange={(e) => setQuery(e.target.value)} />
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
              value={method}
              onChange={setMethod}
              options={[
                { value: "all", label: "All", count: payments.length },
                ...PAYMENT_METHODS.map((m) => ({ value: m, label: m, count: payments.filter((p) => p.method === m).length })),
              ]}
            />
          </div>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Receipt No.</TH>
              <TH>Date</TH>
              <TH>Store</TH>

              <TH>Method</TH>
              <TH>Cheque No. / Date</TH>
              <TH>For Bills</TH>
              <TH className="text-right">Amount</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No payments found.</EmptyRow>}
            {pager.pageRows.map((p) => {
              const shop = shopMap.get(p.shopId);
              return (
                <TR key={p.id}>
                  <TD className="font-semibold text-slate-900">{p.receiptNo}</TD>
                  <TD className="tabular-nums">{formatDate(p.date)}</TD>
                  <TD className="whitespace-normal">
                    {shop ? (
                      <Link href={`/stores/${shop.id}`} className="block font-medium text-brand-700 hover:underline">
                        {shop.shopName}
                      </Link>
                    ) : (
                      "Deleted store"
                    )}
                    <span className="block text-xs text-slate-500">
                      {shop?.shopCode}
                      {shop && routeMap.get(shop.routeId) ? ` · ${routeMap.get(shop.routeId)!.routeCode}` : ""}
                    </span>
                  </TD>

                  <TD>
                    <Badge tone={methodTone[p.method]}>{p.method}</Badge>
                  </TD>
                  <TD className="tabular-nums">
                    {p.method === "Cheque" ? (
                      <>
                        {p.chequeNumber}
                        <span className="block text-xs text-slate-500">{formatDate(p.chequeDate)}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TD>
                  <TD className="max-w-64 min-w-40 whitespace-normal">
                    {p.allocations.length === 0 && <span className="text-amber-700">Not linked (advance)</span>}
                    {p.allocations.map((a) => (
                      <span key={a.saleId} className="block text-xs">
                        {a.saleId === OPENING_BILL ? (
                          <span className="font-medium text-slate-700">Opening balance</span>
                        ) : (
                          <Link href={`/sales/${a.saleId}`} className="font-medium text-brand-700 hover:underline">
                            {saleNoById.get(a.saleId) ?? "Deleted bill"}
                          </Link>
                        )}{" "}
                        <span className="text-slate-500 tabular-nums">{formatMoney(a.amount)}</span>
                      </span>
                    ))}
                    {p.allocations.length > 0 && unlinkedAmount(p) > 0 && (
                      <span className="block text-xs text-amber-700">Advance {formatMoney(unlinkedAmount(p))}</span>
                    )}
                    {p.reference && <span className="mt-0.5 block text-xs text-slate-500">{p.reference}</span>}
                  </TD>
                  <TD className="text-right font-semibold text-emerald-700 tabular-nums">{formatMoney(p.amount)}</TD>
                  <TD>
                    <RowActions>
                      <Button variant="ghost" size="icon" onClick={() => form.open(p)} aria-label={`Edit ${p.receiptNo}`} title="Edit">
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove.open(p)}
                        aria-label={`Delete ${p.receiptNo}`}
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
          {rows.length} payments · <span className="font-medium text-slate-700">{formatMoney(total)}</span> collected
        </TableFooter>
      </Card>

      <PaymentFormDialog open={form.isOpen} payment={form.target === "new" ? null : form.target} onClose={form.close} />
      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title={`Delete ${remove.target?.receiptNo}?`}
        message={`${formatMoney(remove.target?.amount ?? 0)} will be added back to ${shopMap.get(remove.target?.shopId ?? "")?.shopName ?? "the store"}'s cash balance.`}
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deletePayment(remove.target.id);
          if (result.ok) toast.success("Payment deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
