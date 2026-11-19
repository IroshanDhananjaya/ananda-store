"use client";

import { Plus, Printer, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useSaleDues, useShopMap } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { cn, formatDate, formatMoney, includesText, weekdayOf } from "@/lib/utils";

/** "Thu 05/11/2026", or a note when the bill has no date of that kind yet */
export const sheetDayLabel = (iso: string) => (iso ? `${weekdayOf(iso)} ${formatDate(iso)}` : "No date yet");

const tick = "size-4 cursor-pointer rounded accent-brand-600 pointer-coarse:size-5";

/**
 * Pick the bills for the printed cash sheet. It starts with the bills in the list, all ticked;
 * untick the ones not going out, and add bills from other days that go on the same lorry
 * (e.g. a bill of the 14th delivered with the 11th's). The sheet groups them by date.
 */
export function CashSheetDialog({
  open,
  onClose,
  inList,
  candidates,
  dateOf,
  onPrint,
}: {
  open: boolean;
  onClose: () => void;
  /** The bills in the list (the sheet starts with these) */
  inList: Sale[];
  /** Every bill that could be added (not cancelled, on the route / store in view), any date */
  candidates: Sale[];
  dateOf: (s: Sale) => string;
  onPrint: (ids: string[]) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Print cash sheet" description="Untick bills not going out, or add bills from other days that go with this load.">
      {/* Fresh each time it opens: starts again from the list */}
      {open && <Picker inList={inList} candidates={candidates} dateOf={dateOf} onPrint={onPrint} onClose={onClose} />}
    </Modal>
  );
}

function Picker({
  inList,
  candidates,
  dateOf,
  onPrint,
  onClose,
}: {
  inList: Sale[];
  candidates: Sale[];
  dateOf: (s: Sale) => string;
  onPrint: (ids: string[]) => void;
  onClose: () => void;
}) {
  const shopMap = useShopMap();
  const dues = useSaleDues();
  /** Bills listed in the box: the list's, then any added */
  const [listed, setListed] = useState<Sale[]>(inList);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(inList.map((s) => s.id)));
  const [addDate, setAddDate] = useState("");
  const [query, setQuery] = useState("");

  const listedIds = new Set(listed.map((s) => s.id));
  const order = (a: Sale, b: Sale) => dateOf(a).localeCompare(dateOf(b)) || (a.invoiceNo || a.saleNo).localeCompare(b.invoiceNo || b.saleNo);
  const days = [...Map.groupBy([...listed].sort(order), dateOf)];
  const chosen = listed.filter((s) => ticked.has(s.id));
  const chosenTotal = chosen.reduce((sum, s) => sum + (dues.get(s.id)?.total ?? 0), 0);

  // Bills to add: on the day picked, or matching the search (bill no., Raigam no., store), not listed yet
  const findable = candidates.filter((s) => !listedIds.has(s.id));
  const found = query.trim()
    ? findable.filter((s) => includesText([s.saleNo, s.invoiceNo, shopMap.get(s.shopId)?.shopName, shopMap.get(s.shopId)?.shopCode], query)).slice(0, 30)
    : addDate
      ? findable.filter((s) => dateOf(s) === addDate)
      : [];

  const setTick = (ids: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  function add(bills: Sale[]) {
    setListed((l) => [...l, ...bills]);
    setTick(
      bills.map((s) => s.id),
      true,
    );
  }

  const billLine = (s: Sale) => (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-900">{shopMap.get(s.shopId)?.shopName ?? "Deleted store"}</span>
        <span className="block truncate text-xs text-slate-500">{[s.invoiceNo, s.saleNo].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="shrink-0 text-right tabular-nums text-slate-700">{formatMoney(dues.get(s.id)?.total ?? 0)}</span>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-slate-900">
            On the sheet <span className="font-normal text-slate-500">· {chosen.length} of {listed.length} bills ticked</span>
          </h3>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setTick([...listedIds], true)}>
              Tick all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTick([...listedIds], false)}>
              Untick all
            </Button>
          </div>
        </div>

        {listed.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-[13px] text-slate-500">
            No bills in the list. Add them from another day below.
          </p>
        ) : (
          <div className="max-h-[45vh] overflow-y-auto rounded-md border border-slate-200">
            {days.map(([day, bills]) => {
              const dayTicked = bills.filter((s) => ticked.has(s.id)).length;
              return (
                <div key={day || "none"}>
                  <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      className={tick}
                      checked={dayTicked === bills.length}
                      ref={(el) => {
                        if (el) el.indeterminate = dayTicked > 0 && dayTicked < bills.length;
                      }}
                      onChange={(e) =>
                        setTick(
                          bills.map((s) => s.id),
                          e.target.checked,
                        )
                      }
                    />
                    <span className="flex-1">{sheetDayLabel(day)}</span>
                    <span className="tabular-nums">
                      {dayTicked}/{bills.length}
                    </span>
                  </label>
                  {bills.map((s) => (
                    <div key={s.id} className={cn("flex items-center gap-2.5 border-b border-slate-100 px-3 py-2 text-[13px] last:border-b-0", !ticked.has(s.id) && "opacity-50")}>
                      <input type="checkbox" className={tick} checked={ticked.has(s.id)} onChange={(e) => setTick([s.id], e.target.checked)} aria-label={`On the sheet: ${s.saleNo}`} />
                      {billLine(s)}
                      {!inList.some((x) => x.id === s.id) && (
                        <button
                          type="button"
                          onClick={() => setListed((l) => l.filter((x) => x.id !== s.id))}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Take ${s.saleNo} off the list`}
                          title="Take off (added from another day)"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3">
        <h3 className="text-[13px] font-semibold text-slate-900">Add bills from another day</h3>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} aria-label="Day to add bills from" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="…or search a bill no., Raigam no. or store" aria-label="Search a bill to add" />
        </div>
        {(addDate || query.trim()) &&
          (found.length === 0 ? (
            <p className="px-1 py-2 text-[13px] text-slate-500">{query.trim() ? "No bill found that isn't on the sheet already." : `No other bills on ${sheetDayLabel(addDate)}.`}</p>
          ) : (
            <div className="flex flex-col">
              {!query.trim() && found.length > 1 && (
                <Button variant="outline" size="sm" className="mb-1.5 self-start" onClick={() => add(found)}>
                  <Plus /> Add all {found.length} bills of {sheetDayLabel(addDate)}
                </Button>
              )}
              <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white">
                {found.map((s) => (
                  <div key={s.id} className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2 text-[13px] last:border-b-0">
                    {query.trim() && <span className="w-24 shrink-0 text-xs text-slate-500 tabular-nums">{sheetDayLabel(dateOf(s))}</span>}
                    {billLine(s)}
                    <Button variant="outline" size="sm" onClick={() => add([s])}>
                      <Plus /> Add
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-end">
        <span className="text-[13px] text-slate-500 sm:mr-auto">
          {chosen.length} bill{chosen.length === 1 ? "" : "s"} · {formatMoney(chosenTotal)}
        </span>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onPrint([...chosen].sort(order).map((s) => s.id))} disabled={chosen.length === 0}>
          <Printer /> Print cash sheet ({chosen.length})
        </Button>
      </div>
    </div>
  );
}
