"use client";

import { useSaleDues, useShopMap } from "@/lib/store";
import type { Route, Sale } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const amount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const cell = "border border-slate-700 px-1.5 py-1 align-middle";

/** Blank line to write on, for the sheet's header and sign-off */
function Blank({ label, value, className }: { label: string; value?: string; className?: string }) {
  return (
    <p className="flex items-end gap-2">
      <span className="font-semibold">{label}</span>
      <span className={cn("min-h-5 border-b border-dotted border-slate-600", className)}>{value}</span>
    </p>
  );
}

/**
 * Printed cash sheet, as on Raigam's agency invoice list: one row per bill with boxes
 * to write in what was collected (cheque, credit, cash), the balance left, and a tick when done.
 * Hidden on screen; shown only when printing.
 */
export function CashSheet({
  sales,
  dateOf,
  period,
  route,
  storeName,
}: {
  /** Bills to list (cancelled bills left out) */
  sales: Sale[];
  /** The date that put each bill in the list */
  dateOf: (s: Sale) => string;
  period: string;
  route?: Route;
  storeName?: string;
}) {
  const shopMap = useShopMap();
  const dues = useSaleDues();

  // Oldest day first; within a day, in invoice order like Raigam's list
  const rows = [...sales].sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.invoiceNo || a.saleNo).localeCompare(b.invoiceNo || b.saleNo));
  const multiDay = new Set(rows.map(dateOf)).size > 1;
  const total = rows.reduce((sum, s) => sum + dues.get(s.id)!.total, 0);

  return (
    <div className="hidden text-[13px] text-black print:block">
      <style>{"@page { size: A4 portrait; margin: 10mm; }"}</style>

      <header className="text-center">
        <h1 className="text-xl font-bold">Ananda Stores</h1>
        <p className="mt-0.5 text-sm font-semibold">
          {route ? route.routeName : "All routes"} Cash Sheet · {period}
          {storeName && ` · ${storeName}`}
        </p>
      </header>

      <div className="mt-3 mb-2 flex justify-between gap-6 text-xs">
        <Blank label="Rep:" value={route?.salesRep} className="w-40" />
        <Blank label="Lorry:" value={route?.vehicleNumber} className="w-32" />
        <Blank label="Collected on:" className="w-32" />
      </div>

      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[4%]" />
          <col className="w-[13%]" />
          <col className="w-[22%]" />
          <col className="w-[12%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[14%]" />
          <col className="w-[5%]" />
        </colgroup>
        <thead>
          <tr className="bg-slate-200 text-left [print-color-adjust:exact]">
            <th className={cell}>No</th>
            <th className={cell}>Invoice</th>
            <th className={cell}>Shop Name</th>
            <th className={cn(cell, "text-right")}>Bill Value</th>
            <th className={cell}>Cheque</th>
            <th className={cell}>Credit</th>
            <th className={cell}>Cash</th>
            <th className={cell}>Balance</th>
            <th className={cn(cell, "text-center")} title="Done">
              ✓
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className={cn(cell, "py-6 text-center")}>
                No invoices for these dates.
              </td>
            </tr>
          )}
          {rows.map((s, i) => {
            const d = dues.get(s.id)!;
            const ref = [s.invoiceNo && s.saleNo, multiDay && formatDate(dateOf(s))].filter(Boolean).join(" · ");
            return (
              <tr key={s.id} className="h-[11mm] break-inside-avoid">
                <td className={cn(cell, "text-center")}>{i + 1}</td>
                <td className={cell}>
                  <span className="block">{s.invoiceNo || s.saleNo}</span>
                  {ref && <span className="block text-[10px] text-slate-600">{ref}</span>}
                </td>
                <td className={cell}>{shopMap.get(s.shopId)?.shopName ?? "Deleted store"}</td>
                <td className={cn(cell, "text-right tabular-nums")}>
                  <span className="block">{amount(d.total)}</span>
                  {d.paid > 0 && <span className="block text-[10px] text-slate-600">paid {amount(d.paid)}</span>}
                </td>
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={cn(cell, "text-center")}>
                  <span className="inline-block size-[5mm] border-[1.5px] border-slate-800 align-middle" />
                </td>
              </tr>
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="[display:table-row-group]">
            <tr className="h-[11mm] break-inside-avoid font-bold">
              <td colSpan={3} className={cn(cell, "text-right")}>
                Total ({rows.length} invoice{rows.length === 1 ? "" : "s"})
              </td>
              <td className={cn(cell, "text-right tabular-nums")}>{amount(total)}</td>
              <td className={cell} />
              <td className={cell} />
              <td className={cell} />
              <td className={cell} />
              <td className={cell} />
            </tr>
          </tfoot>
        )}
      </table>

      <div className="mt-12 flex break-inside-avoid justify-between gap-8 text-xs">
        <p className="w-48 border-t border-dotted border-slate-600 pt-1">Rep Signature</p>
        <p className="w-48 border-t border-dotted border-slate-600 pt-1">Checked By</p>
        <p className="w-48 border-t border-dotted border-slate-600 pt-1">Date</p>
      </div>
    </div>
  );
}
