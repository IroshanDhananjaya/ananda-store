"use client";

import { ClipboardCheck, Printer } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, buttonClass } from "@/components/ui/button";
import { FilterTabs, SearchInput } from "@/components/ui/layout";
import { useAppStore, useLastInvoicePrices } from "@/lib/store";
import type { Item, Order, OrderInput, OrderItem, OrderLineInput } from "@/lib/types";
import { cn, formatDate, formatMoney, formatQty, includesText, nextOrderId, NOT_PAID, orderLineValue, paymentOf, round2, todayISO } from "@/lib/utils";
import { ReceiveCheckSheet, sheetUom } from "./receive-check-sheet";

/** Heading for items that aren't on Raigam's sheet (no section set on the item) */
const OTHER = "OTHER ITEMS";

type Section = { name: string; items: Item[] };
type Show = "all" | "ordered";

/**
 * First SN of each block of Raigam's paper sheet; each block is laid out in its own two columns:
 * page 3 (123–208), page 4 (209–285) and page 4's POSM items (286–299). SNs below 123 are pages 1–2.
 */
const SHEET_BLOCKS = [123, 209, 286];
const blockOf = (s: Section) => SHEET_BLOCKS.findLast((first) => s.items[0].sheetNo >= first) ?? 0;

/** Raigam's sections in sheet order (by their first SN), items by SN; items with no section last */
function sheetSections(items: Item[]): Section[] {
  const bySn = (a: Item, b: Item) => (a.sheetNo || Infinity) - (b.sheetNo || Infinity) || 0;
  const firstSn = (s: Section) => s.items[0].sheetNo || Infinity;
  return [...Map.groupBy(items, (i) => i.sheetSection || OTHER)]
    .map(([name, list]) => ({ name, items: list.toSorted(bySn) }))
    .sort((a, b) => Number(a.name === OTHER) - Number(b.name === OTHER) || firstSn(a) - firstSn(b) || a.name.localeCompare(b.name));
}

/**
 * Two columns like the paper sheet: sections stay whole, each goes to the side its middle falls on.
 * Only Raigam's numbered rows count where a section has them, so items added to a section
 * don't move it to the other column. A block of one section (POSM items) is split down the middle.
 */
function splitColumns(sections: Section[]): [Section[], Section[]] {
  if (sections.length === 1) {
    const [s] = sections;
    const half = Math.ceil(s.items.length / 2);
    return [[{ ...s, items: s.items.slice(0, half) }], half < s.items.length ? [{ ...s, items: s.items.slice(half) }] : []];
  }
  const height = (s: Section) => (s.items.filter((i) => i.sheetNo).length || s.items.length) + 1.5;
  const half = sections.reduce((sum, s) => sum + height(s), 0) / 2;
  let left = 0;
  let i = 0;
  while (i < sections.length && left + height(sections[i]) / 2 <= half) left += height(sections[i++]);
  return [sections.slice(0, i), sections.slice(i)];
}

/** Label + dotted line to write on, as on the paper sheet's header */
function SheetField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-end gap-2 print:grid-cols-[6.5rem_minmax(0,1fr)]">
      <label htmlFor={htmlFor} className="pb-1 font-slab text-sm font-bold text-slate-900 print:text-xs">
        {label}
      </label>
      <div className="min-h-8 border-b-2 border-dotted border-slate-400 print:min-h-6 print:border-b print:border-black">{children}</div>
    </div>
  );
}

const lineInput = "h-8 w-full bg-transparent px-1 text-sm font-medium text-brand-800 focus:bg-brand-50/60 focus:outline-none print:hidden";

/**
 * New / pending purchase order laid out like Raigam's "Goods Order Sheet": every item under its
 * sheet section, with an Order Qty box and our stock as Balance Stock. Prints the same way.
 */
export function OrderSheet({
  order,
  lines,
  prefill = [],
  onSaved,
  cancelHref,
}: {
  order: Order | null;
  lines: OrderItem[];
  /** SAP codes to mark (e.g. picked from Low stock); their quantities are left to fill in */
  prefill?: string[];
  onSaved: (id: string) => void;
  cancelHref: string;
}) {
  const items = useAppStore((s) => s.items);
  const orders = useAppStore((s) => s.orders);
  const stock = useAppStore((s) => s.stock);
  const createOrder = useAppStore((s) => s.createOrder);
  const updateOrder = useAppStore((s) => s.updateOrder);
  const lastPrice = useLastInvoicePrices();

  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.itemCode, String(l.orderedQty)])));
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? todayISO());
  const [requiredDate, setRequiredDate] = useState(order?.requiredDate ?? "");
  // Territory rarely changes: a new order starts with the last one written
  const [territory, setTerritory] = useState(
    () => order?.territory ?? orders.toSorted((a, b) => b.orderId.localeCompare(a.orderId)).find((o) => o.territory)?.territory ?? "",
  );
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [error, setError] = useState<string>();
  // Printing the receiving check sheet instead of the order sheet, until the print dialog closes
  const [printCheck, setPrintCheck] = useState(false);

  // Kept from the first render: the page passes a new list each time it draws
  const [marked] = useState(() => new Set(prefill));
  const oldLine = useMemo(() => new Map(lines.map((l) => [l.itemCode, l])), [lines]);
  const balance = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of stock) map.set(r.sapCode, (map.get(r.sapCode) ?? 0) + r.availableQty);
    return map;
  }, [stock]);

  // Free items with no section (posters, order books…) aren't ordered, so they stay off the sheet
  const sections = useMemo(
    () => sheetSections(items.filter((i) => i.sheetSection || i.wholesalePrice > 0 || oldLine.has(i.sapCode) || marked.has(i.sapCode))),
    [items, oldLine, marked],
  );

  const qtyOf = (code: string) => Number(qty[code] || 0);
  // An item already on the order keeps its price; others take the last Raigam invoice price
  const priceOf = (code: string) => oldLine.get(code)?.unitPrice ?? lastPrice.get(code) ?? 0;
  const ordered = items.filter((i) => qtyOf(i.sapCode) > 0);
  const orderLines: OrderLineInput[] = ordered.map((i) => {
    const old = oldLine.get(i.sapCode);
    const orderedQty = qtyOf(i.sapCode);
    const unitPrice = priceOf(i.sapCode);
    return {
      itemCode: i.sapCode,
      orderedQty,
      receivedQty: 0,
      unitPrice,
      // A smaller quantity can't keep a discount bigger than the line
      discount: Math.min(old?.discount ?? 0, round2(orderedQty * unitPrice)),
      remarks: old?.remarks ?? "",
    };
  });
  // Raigam's discount % is on each invoice, known once the goods come
  const total = round2(orderLines.reduce((sum, l) => sum + orderLineValue(l, undefined), 0));
  const unpriced = orderLines.filter((l) => l.unitPrice === 0).length;
  const units = orderLines.reduce((sum, l) => sum + l.orderedQty, 0);

  // On screen the search and the Ordered tab hide rows; printing ignores the search
  const onScreen = (i: Item) => includesText([i.description, i.sapCode, i.sheetNo || undefined], query);
  const inView = (i: Item) => show === "all" || qtyOf(i.sapCode) > 0;
  const viewSections = sections.map((s) => ({ ...s, items: s.items.filter(inView) })).filter((s) => s.items.length > 0);
  // Each block of sections with Raigam's SN numbers in two columns as on the paper, the rest in two more below
  const numbered = viewSections.filter((s) => s.items.some((i) => i.sheetNo));
  const columns = [
    ...[...Map.groupBy(numbered, blockOf).values()].flatMap(splitColumns),
    ...splitColumns(viewSections.filter((s) => !numbered.includes(s))),
  ];
  const noMatch = viewSections.every((s) => !s.items.some(onScreen));

  // Items picked elsewhere (Low stock): start on the first one down the sheet
  useEffect(() => {
    const box = document.querySelector<HTMLInputElement>("input[data-marked]");
    box?.scrollIntoView({ block: "center" });
    box?.focus({ preventScroll: true });
  }, []);

  // Once the check sheet is drawn, print it; back to the order sheet when the print dialog closes
  useEffect(() => {
    if (!printCheck) return;
    const done = () => setPrintCheck(false);
    window.addEventListener("afterprint", done, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", done);
  }, [printCheck]);

  function setItemQty(code: string, value: string) {
    // Whole numbers only; no leading zeros
    const clean = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 6);
    setQty((q) => ({ ...q, [code]: clean }));
    setError(undefined);
  }

  // Enter / ↓ go to the next Order Qty box (down the sheet), ↑ back; Enter never saves the order
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    const box = e.target;
    if (!(box instanceof HTMLInputElement)) return;
    if (e.key === "Enter") e.preventDefault();
    const step = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step || !box.hasAttribute("data-sheet-qty")) return;
    e.preventDefault();
    const boxes = [...e.currentTarget.querySelectorAll<HTMLInputElement>("[data-sheet-qty]")].filter((b) => b.offsetParent);
    boxes[boxes.indexOf(box) + step]?.focus();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = !orderDate
      ? "Enter the order date."
      : requiredDate && requiredDate < orderDate
        ? "The required date can't be before the order date."
        : orderLines.length === 0
          ? "Fill in the Order Qty for at least one item."
          : undefined;
    setError(problem);
    if (problem) return;

    const input: OrderInput = {
      orderDate,
      receivedDate: "",
      receivedTime: "",
      ...(order ? paymentOf(order) : NOT_PAID),
      territory,
      requiredDate,
    };
    const result = await (order ? updateOrder(order.id, input, orderLines) : createOrder(input, orderLines));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(order ? `${order.orderId} updated` : "Order saved");
    onSaved(result.id!);
  }

  const orderRef = order?.orderId ?? nextOrderId(orders);

  return (
    <form onSubmit={handleSubmit} onKeyDown={onKeyDown} noValidate className="flex flex-col gap-4 print:block print:text-black">
      <style>{"@page { size: A4 portrait; margin: 8mm; }"}</style>

      <div
        className={cn(
          "overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm print:overflow-visible print:rounded-none print:border-0 print:shadow-none",
          printCheck && "print:hidden",
        )}
      >
        {/* Sheet header, as on the paper: title, order value box, then the DB's details */}
        <div className="border-b-2 border-slate-800 px-4 pt-4 pb-5 sm:px-6 print:px-0 print:pt-0 print:pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-600 print:text-[10px] print:text-black">
            <p>
              <span className="font-semibold">Order Ref No:</span> <span className="font-medium text-slate-900">{orderRef}</span>
            </p>
            <p className="font-slab font-bold tracking-wide text-slate-500 print:text-black">TO RAIGAM</p>
          </div>
          <h2 className="mt-2 text-center font-slab text-2xl font-black tracking-tight text-slate-900 sm:text-3xl print:mt-0 print:text-2xl">
            GOODS ORDER SHEET
          </h2>

          <div className="mt-5 grid gap-5 md:grid-cols-[16rem_minmax(0,1fr)] md:items-end md:gap-8 print:mt-3 print:grid-cols-[13rem_minmax(0,1fr)] print:items-end print:gap-6">
            <div className="rounded-lg border-2 border-slate-800 text-center print:rounded-none print:border">
              <p className="border-b-2 border-slate-800 bg-slate-100 px-3 py-1.5 font-slab text-sm font-bold [print-color-adjust:exact] print:border-b print:py-1 print:text-xs">
                Total Order Value
              </p>
              <p className="px-3 py-2.5 text-xl font-bold text-slate-900 tabular-nums print:py-1.5 print:text-base">{formatMoney(total)}</p>
              <p className={cn("border-t border-slate-200 px-3 py-1.5 text-[11px] leading-snug print:hidden", unpriced ? "text-amber-700" : "text-slate-500")}>
                {unpriced
                  ? `${unpriced} item${unpriced === 1 ? " has" : "s have"} no price yet (not on a Raigam invoice), so ${unpriced === 1 ? "it isn't" : "they aren't"} counted.`
                  : "At the prices on your last Raigam invoices."}
              </p>
            </div>

            <div className="flex max-w-xl flex-col gap-2.5 print:max-w-none print:gap-1.5">
              <SheetField label="DB's Name:">
                <p className="px-1 pt-1.5 text-sm font-medium text-slate-900 print:pt-0 print:text-xs">Ananda Stores</p>
              </SheetField>
              <SheetField label="Territory:" htmlFor="sheetTerritory">
                <input
                  id="sheetTerritory"
                  value={territory}
                  onChange={(e) => setTerritory(e.target.value)}
                  placeholder="Your Raigam territory"
                  className={cn(lineInput, "placeholder:font-normal placeholder:text-slate-400")}
                />
                <p className="hidden px-1 text-xs print:block">{territory}</p>
              </SheetField>
              <SheetField label="Date:" htmlFor="sheetDate">
                <input id="sheetDate" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={lineInput} />
                <p className="hidden px-1 text-xs print:block">{formatDate(orderDate)}</p>
              </SheetField>
              <SheetField label="Required Date:" htmlFor="sheetRequired">
                <input
                  id="sheetRequired"
                  type="date"
                  value={requiredDate}
                  min={orderDate || undefined}
                  onChange={(e) => setRequiredDate(e.target.value)}
                  className={lineInput}
                />
                <p className="hidden px-1 text-xs print:block">{requiredDate ? formatDate(requiredDate) : ""}</p>
              </SheetField>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:px-6 print:hidden">
          <SearchInput placeholder="Find an item…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find an item" />
          <FilterTabs<Show>
            value={show}
            onChange={setShow}
            options={[
              { value: "all", label: "All items", count: sections.reduce((n, s) => n + s.items.length, 0) },
              { value: "ordered", label: "Ordered", count: ordered.length },
            ]}
          />
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={viewSections.length === 0}>
              <Printer /> Print sheet
            </Button>
            {/* The items ordered, to count the goods against when they come */}
            <Button variant="outline" size="sm" onClick={() => setPrintCheck(true)} disabled={ordered.length === 0}>
              <ClipboardCheck /> Print check sheet
            </Button>
          </div>
        </div>

        {marked.size > 0 && (
          <p className="border-b border-accent-200 bg-accent-50 px-4 py-2 text-sm text-accent-800 sm:px-6 print:hidden">
            The {marked.size === 1 ? "item" : `${marked.size} items`} you picked {marked.size === 1 ? "is" : "are"} marked in orange. Fill in the Order Qty.
          </p>
        )}

        {viewSections.length === 0 || noMatch ? (
          <p className="px-6 py-14 text-center text-sm text-slate-500 print:hidden">
            {show === "ordered" && ordered.length === 0 ? "No quantities yet. Fill in Order Qty on All items." : "No items match your search."}
          </p>
        ) : null}

        <div className="grid gap-4 p-3 sm:p-4 xl:grid-cols-2 print:grid-cols-2 print:gap-3 print:p-0 print:pt-3">
          {columns.map((col, c) =>
            col.length === 0 ? (
              // An empty right column still takes its place, so the next block's two columns stay side by side
              columns[c ^ 1].length > 0 && <div key={c} className="hidden xl:block print:block" />
            ) : (
              <table key={c} className={cn("w-full border-collapse self-start text-[13px] print:text-[9px]", col.every((s) => !s.items.some(onScreen)) && "hidden print:table")}>
                <thead>
                  <tr className="bg-slate-100 font-slab text-[11px] leading-tight font-bold text-slate-700 [print-color-adjust:exact] print:text-[8px] print:text-black">
                    <th className="hidden w-9 border border-slate-400 px-1 py-1.5 sm:table-cell print:table-cell print:w-6 print:border-black print:py-0.5">SN</th>
                    <th className="border border-slate-400 px-2 py-1.5 text-center print:border-black print:py-0.5">PRODUCT</th>
                    <th className="w-15 border border-slate-400 px-1 py-1.5 print:w-11 print:border-black print:py-0.5">UOM</th>
                    <th className="w-16 border border-slate-400 px-1 py-1.5 print:w-11 print:border-black print:py-0.5">Order Qty</th>
                    <th className="hidden w-12 border border-slate-400 px-1 py-1.5 sm:table-cell print:table-cell print:w-9 print:border-black print:py-0.5">
                      Office Use
                    </th>
                    <th className="w-14 border border-slate-400 px-1 py-1.5 print:w-11 print:border-black print:py-0.5">Balance Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {col.map((section) => (
                    <Fragment key={section.name}>
                      <tr className={cn(!section.items.some(onScreen) && "hidden print:table-row")}>
                        <th
                          colSpan={6}
                          className="border border-slate-400 bg-white px-2 pt-2.5 pb-1 text-left font-slab text-base leading-tight font-extrabold tracking-tight text-slate-900 print:border-black print:pt-1 print:pb-0.5 print:text-[11px]"
                        >
                          {section.name}
                        </th>
                      </tr>
                      {section.items.map((item) => {
                        const n = qtyOf(item.sapCode);
                        const stockQty = balance.get(item.sapCode) ?? 0;
                        const cell = "border border-slate-300 print:border-black";
                        return (
                          <tr
                            key={item.sapCode}
                            className={cn(
                              "transition-colors",
                              n > 0 ? "bg-accent-50 [print-color-adjust:exact] print:bg-white" : marked.has(item.sapCode) ? "bg-accent-100/60" : "hover:bg-slate-50",
                              !onScreen(item) && "hidden print:table-row",
                            )}
                          >
                            <td className={cn(cell, "hidden px-1 text-center text-xs text-slate-500 tabular-nums sm:table-cell print:table-cell print:text-[8px] print:text-black")}>
                              {item.sheetNo || ""}
                            </td>
                            <td className={cn(cell, "px-2 py-1 leading-snug text-slate-900 print:px-1 print:py-0")} title={`${item.sapCode}${item.packageDetails ? ` · ${item.packageDetails}` : ""}`}>
                              <label htmlFor={`sheet-qty-${item.sapCode}`} className="block">
                                {item.description}
                              </label>
                            </td>
                            <td className={cn(cell, "px-1 text-center whitespace-nowrap text-slate-700 print:text-black")}>{sheetUom(item)}</td>
                            <td className={cn(cell, "p-0", n > 0 && "border-accent-300")}>
                              <input
                                id={`sheet-qty-${item.sapCode}`}
                                data-sheet-qty
                                data-marked={marked.has(item.sapCode) || undefined}
                                inputMode="numeric"
                                autoComplete="off"
                                value={qty[item.sapCode] ?? ""}
                                onChange={(e) => setItemQty(item.sapCode, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                className="block h-8 w-full bg-transparent px-2 text-right text-[15px] font-bold text-brand-700 tabular-nums focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none focus:ring-inset print:h-auto print:px-1 print:text-[10px] print:text-black"
                                aria-label={`Order Qty for ${item.description}`}
                              />
                            </td>
                            <td className={cn(cell, "hidden bg-slate-50 [print-color-adjust:exact] sm:table-cell print:table-cell print:bg-white")} />
                            <td className={cn(cell, "px-2 text-right tabular-nums print:px-1", stockQty > 0 ? "text-slate-700 print:text-black" : "text-slate-300 print:text-black")}>
                              {formatQty(stockQty)}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ),
          )}
        </div>
      </div>

      {printCheck && <ReceiveCheckSheet orderRef={orderRef} orderDate={orderDate} requiredDate={requiredDate} lines={orderLines} />}

      {/* Stays at the bottom of the screen while scrolling the sheet */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_-6px_rgb(15_23_42/0.15)] backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm">
            {error ? (
              <p className="font-medium text-red-600">{error}</p>
            ) : (
              <p className="text-slate-600">
                <span className="font-semibold text-slate-900 tabular-nums">{ordered.length}</span> item{ordered.length === 1 ? "" : "s"} ·{" "}
                <span className="tabular-nums">{formatQty(units)}</span> units ·{" "}
                <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(total)}</span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link href={cancelHref} className={buttonClass("outline", "md", "flex-1 sm:flex-none")}>
              Cancel
            </Link>
            <Button type="submit" className="flex-1 sm:flex-none">
              {order ? "Save changes" : "Save order"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
