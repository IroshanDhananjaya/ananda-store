"use client";

import { Fragment } from "react";
import { useItemMap } from "@/lib/store";
import type { Item } from "@/lib/types";
import { cn, formatDate, formatQty } from "@/lib/utils";

/** Pack size from the package details: "(90gx50)" → 50 */
function packSize(item: Item) {
  const match = /x\s*0*(\d+)\s*\)?\s*$/i.exec(item.packageDetails);
  return match ? Number(match[1]) : null;
}

/** UOM as Raigam's sheet prints it, pack size then unit: "50 Pkt" */
export function sheetUom(item: Item) {
  const unit = item.uom.charAt(0) + item.uom.slice(1).toLowerCase();
  // A card's package details count the packets on the card, not the cards in the case
  const pack = item.uom === "CARD" ? null : packSize(item);
  return pack ? `${pack} ${unit}` : unit;
}

/** Rows down each column: fewer on the first page, under the sheet's header */
const FIRST_PAGE_ROWS = 32;
const PAGE_ROWS = 40;
/** Empty rows to write in items that came without being ordered, half in each column */
const BLANK_ROWS = 12;

const cell = "border border-slate-700 px-1 py-0 align-middle";
const head = "border border-slate-700 px-0.5 py-1 text-center text-[7.5px] leading-tight font-bold uppercase";

/** Empty square to tick */
function TickBox() {
  return <span className="inline-block size-[3.6mm] border-[1.2px] border-slate-800 align-middle" />;
}

/** Blank line to write on */
function Blank({ label, className }: { label: string; className?: string }) {
  return (
    <p className="flex items-end gap-1.5">
      <span className="font-semibold">{label}</span>
      <span className={cn("min-h-4 border-b border-dotted border-slate-600", className)} />
    </p>
  );
}

/**
 * Pages of two columns: down the left column, then down the right. A page that isn't full
 * splits its rows evenly, so the right column isn't left nearly empty.
 */
function toPages<T>(rows: T[]): [T[], T[]][] {
  const pages: [T[], T[]][] = [];
  let per = FIRST_PAGE_ROWS;
  for (let i = 0; i < rows.length;) {
    const left = rows.length - i <= 2 * per ? Math.ceil((rows.length - i) / 2) : per;
    pages.push([rows.slice(i, i + left), rows.slice(i + left, i + 2 * left)]);
    i += 2 * left;
    per = PAGE_ROWS;
  }
  return pages;
}

type Row = {
  no: number;
  itemCode: string;
  item: Item | undefined;
  orderedQty: number;
};

function ItemColumn({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full table-fixed border-collapse self-start">
      <colgroup>
        <col className="w-[6%]" />
        <col />
        <col className="w-[11%]" />
        <col className="w-[10%]" />
        <col className="w-[15%]" />
        <col className="w-[8%]" />
        <col className="w-[9%]" />
      </colgroup>
      <thead>
        <tr className="bg-slate-200 [print-color-adjust:exact]">
          <th className={head}>No</th>
          <th className={cn(head, "text-left")}>Item</th>
          <th className={head}>UOM</th>
          <th className={head}>Ordered</th>
          <th className={head}>Received</th>
          <th className={head}>Came</th>
          <th className={head}>Missing</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.itemCode} className="h-[6.4mm] break-inside-avoid">
            <td className={cn(cell, "text-center text-[8px]")}>{r.no}</td>
            <td className={cn(cell, "text-[9.5px] leading-tight")}>{r.item?.description ?? r.itemCode}</td>
            <td className={cn(cell, "text-center text-[8px] whitespace-nowrap")}>{r.item ? sheetUom(r.item) : ""}</td>
            <td className={cn(cell, "text-right text-[11px] font-bold tabular-nums")}>{formatQty(r.orderedQty)}</td>
            {/* Written in by hand when the goods are counted */}
            <td className={cell} />
            <td className={cn(cell, "text-center")}>
              <TickBox />
            </td>
            <td className={cn(cell, "text-center")}>
              <TickBox />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BlankColumn({ from }: { from: number }) {
  return (
    <table className="w-full table-fixed border-collapse self-start">
      <colgroup>
        <col className="w-[6%]" />
        <col />
        <col className="w-[11%]" />
        <col className="w-[15%]" />
      </colgroup>
      <thead>
        <tr className="bg-slate-200 [print-color-adjust:exact]">
          <th className={head}>No</th>
          <th className={cn(head, "text-left")}>Item (write in)</th>
          <th className={head}>UOM</th>
          <th className={head}>Received</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: BLANK_ROWS / 2 }, (_, i) => (
          <tr key={i} className="h-[7mm]">
            <td className={cn(cell, "text-center text-[8px]")}>{from + i}</td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Printed sheet for counting a delivery against the order: the items ordered, in the goods order
 * sheet's order (down the left column, then the right), each with its Ordered qty, an empty
 * Received box and tick boxes Came / Missing; then empty rows for items that came without being
 * ordered. Hidden on screen; shown only when printing.
 */
export function ReceiveCheckSheet({
  orderRef,
  orderDate,
  requiredDate,
  lines,
}: {
  orderRef: string;
  orderDate: string;
  requiredDate?: string;
  lines: { itemCode: string; orderedQty: number }[];
}) {
  const itemMap = useItemMap();

  // Raigam's sheet order (by SN); items not on the sheet after, by name
  const sn = (r: Omit<Row, "no">) => r.item?.sheetNo || Infinity;
  const rows: Row[] = lines
    .filter((l) => l.orderedQty > 0)
    .map((l) => ({
      itemCode: l.itemCode,
      item: itemMap.get(l.itemCode),
      orderedQty: l.orderedQty,
    }))
    .sort((a, b) => sn(a) - sn(b) || (a.item?.description ?? a.itemCode).localeCompare(b.item?.description ?? b.itemCode))
    .map((r, i) => ({ ...r, no: i + 1 }));
  const units = rows.reduce((n, r) => n + r.orderedQty, 0);
  const pages = toPages(rows);

  return (
    <div className="hidden text-black print:block">
      <style>{"@page { size: A4 portrait; margin: 8mm; }"}</style>

      {pages.map(([left, right], p) => (
        <Fragment key={p}>
          {p === 0 ? (
            <header className="mb-2.5 text-[11px]">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-bold">Ananda Stores</p>
                <p className="text-sm font-bold">{orderRef}</p>
              </div>
              <h1 className="mt-0.5 text-center text-lg font-black tracking-tight">RECEIVING CHECK SHEET</h1>
              <p className="text-center text-[10px]">
                Ordered {formatDate(orderDate)}
                {requiredDate ? ` · Needed by ${formatDate(requiredDate)}` : ""} · {rows.length} item{rows.length === 1 ? "" : "s"} ·{" "}
                {formatQty(units)} units
              </p>
              <div className="mt-2.5 flex flex-wrap justify-between gap-x-5 gap-y-1.5">
                <Blank label="Received date:" className="w-28" />
                <Blank label="Time:" className="w-16" />
                <Blank label="Invoice No(s):" className="w-48" />
                <Blank label="Lorry:" className="w-24" />
              </div>
              <p className="mt-2 border border-slate-700 px-2 py-1 text-[9.5px] leading-snug">
                Write the qty that came in <b>Received</b>. Tick <b>Came</b> when it came as ordered, <b>Missing</b> when it didn&apos;t come. Items
                that came <b>without being ordered</b>: write them under <b>Not ordered</b> at the end.
              </p>
            </header>
          ) : (
            <p className="mb-1.5 text-[10px] font-semibold">
              {orderRef} · Receiving check sheet · page {p + 1} (continued)
            </p>
          )}
          <div className={cn("grid grid-cols-2 items-start gap-3", p < pages.length - 1 && "break-after-page")}>
            <ItemColumn rows={left} />
            {right.length > 0 && <ItemColumn rows={right} />}
          </div>
        </Fragment>
      ))}
      {rows.length === 0 && <p className="py-6 text-center text-sm">No items ordered yet.</p>}

      <section className="mt-4 break-inside-avoid">
        <h2 className="mb-1 text-[11px] font-bold">NOT ORDERED: came without being ordered</h2>
        <div className="grid grid-cols-2 items-start gap-3">
          <BlankColumn from={1} />
          <BlankColumn from={BLANK_ROWS / 2 + 1} />
        </div>
        <div className="mt-10 flex justify-between gap-8 text-[10px]">
          <p className="w-44 border-t border-dotted border-slate-600 pt-1">Counted By</p>
          <p className="w-44 border-t border-dotted border-slate-600 pt-1">Checked By</p>
          <p className="w-44 border-t border-dotted border-slate-600 pt-1">Date</p>
        </div>
      </section>
    </div>
  );
}
