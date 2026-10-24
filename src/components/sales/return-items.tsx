"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, toNumber } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { SearchSelect } from "@/components/ui/search-select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap } from "@/lib/store";
import { RETURN_KINDS, type ReturnKind, type SaleReturn, type SaleReturnInput } from "@/lib/types";
import { cn, formatMoney, formatQty, newId, round2 } from "@/lib/utils";

// Return items on a shop bill: goods the store gives back (any item, not only ones on the bill),
// credited on the bill. Entered with the bill (New / Edit bill) or at the store (Actual / Deliver).
// They never go into stock: once the bill is delivered they're held in Return Items until
// they're sent back to Raigam.
//   Good return    good condition
//   Market return  damaged / expired

export type ReturnDraft = { key: string; kind: ReturnKind; sapCode: string; qty: string; unitPrice: string };

export const blankReturn = (kind: ReturnKind = "Market"): ReturnDraft => ({ key: newId(), kind, sapCode: "", qty: "", unitPrice: "" });

/** Something typed in the add-a-return box but not added yet */
export const returnStarted = (d: ReturnDraft) => d.sapCode !== "" || d.qty !== "";

export const toReturnDrafts = (returns: SaleReturn[]): ReturnDraft[] =>
  returns.map((r) => ({ key: r.id, kind: r.kind, sapCode: r.sapCode, qty: String(r.qty), unitPrice: String(r.unitPrice) }));

export const returnsInput = (drafts: ReturnDraft[]): SaleReturnInput[] =>
  drafts.map((r) => ({ kind: r.kind, sapCode: r.sapCode, qty: Number(r.qty), unitPrice: toNumber(r.unitPrice) }));

/** A return as numbers, for the bill maths in ledger.ts */
export const pricedReturn = (r: ReturnDraft) => ({ qty: toNumber(r.qty), unitPrice: toNumber(r.unitPrice) });

const returnValue = (r: ReturnDraft) => round2(toNumber(r.qty) * toNumber(r.unitPrice));

const KIND_HINT: Record<ReturnKind, string> = {
  Good: "Good condition. Kept for Raigam, not put back in stock.",
  Market: "Damaged or expired. Kept for Raigam, not put back in stock.",
};

/** Focus a field once React has drawn it */
const focusField = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

export function ReturnKindBadge({ kind }: { kind: ReturnKind }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        kind === "Good" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800",
      )}
    >
      {kind} return
    </span>
  );
}

// Where the box's fields sit: spread across a full-width card (bill form), or stacked in a dialog
const WIDE = {
  grid: "grid gap-4 sm:grid-cols-2 lg:grid-cols-6",
  kind: "sm:col-span-2",
  item: "sm:col-span-2 lg:col-span-4",
  qty: "",
  price: "",
  footer: "flex items-end justify-between gap-3 sm:col-span-2 lg:col-span-4",
};
const COMPACT = {
  grid: "grid gap-3 sm:grid-cols-6",
  kind: "sm:col-span-6",
  item: "sm:col-span-6",
  qty: "sm:col-span-3",
  price: "sm:col-span-3",
  footer: "flex items-center justify-between gap-3 sm:col-span-6",
};

/** The "add a return" box: type, item, qty and credit price */
export function ReturnPanel({
  returns,
  draft,
  onChange,
  priceOf,
  wide = false,
  idPrefix,
  className,
}: {
  /** Returns already on the bill (an item goes on one line per type) */
  returns: ReturnDraft[];
  /** What's typed in the box */
  draft: ReturnDraft;
  /** The returns and the box after a change, in one call */
  onChange: (returns: ReturnDraft[], draft: ReturnDraft) => void;
  /** Credit price to start from: the price on this bill if the item is on it, else the list price */
  priceOf: (sapCode: string) => number | undefined;
  /** Spread across a full-width card instead of stacked in a dialog */
  wide?: boolean;
  /** Start of the fields' ids, so the page can focus them (the item box is `${idPrefix}Item`) */
  idPrefix?: string;
  className?: string;
}) {
  const autoId = useId();
  const id = idPrefix ?? autoId;
  const items = useAppStore((s) => s.items);
  const [error, setError] = useState<string>();
  const spot = wide ? WIDE : COMPACT;

  function set(patch: Partial<ReturnDraft>) {
    onChange(returns, { ...draft, ...patch });
    setError(undefined);
  }

  function pickItem(sapCode: string) {
    set({ sapCode, unitPrice: String(priceOf(sapCode) ?? "") });
    focusField(`${id}Qty`);
  }

  function add() {
    const qty = Number(draft.qty);
    let err: string | undefined;
    if (!draft.sapCode) err = "Pick the returned item.";
    else if (!Number.isInteger(qty) || qty <= 0) err = "Enter the returned qty (a whole number).";
    else if (draft.unitPrice === "" || toNumber(draft.unitPrice) < 0) err = "Enter the price to credit.";
    else if (returns.some((r) => r.kind === draft.kind && r.sapCode === draft.sapCode))
      err = "That item is already in the returns. Remove it and add it again with the full qty.";
    setError(err);
    if (err) return;
    onChange([...returns, draft], blankReturn(draft.kind));
    focusField(`${id}Item`);
  }

  // Enter in a box adds the return instead of saving the whole form (the item search handles its own Enter)
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.defaultPrevented || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    add();
  }

  return (
    <div onKeyDown={onKeyDown} className={cn(spot.grid, className)}>
      <Field label="Type" className={spot.kind} hint={KIND_HINT[draft.kind]}>
        <FilterTabs<ReturnKind> value={draft.kind} onChange={(kind) => set({ kind })} options={RETURN_KINDS.map((k) => ({ value: k, label: `${k} return` }))} />
      </Field>
      <Field label="Item" htmlFor={`${id}Item`} className={spot.item}>
        <SearchSelect
          id={`${id}Item`}
          value={draft.sapCode}
          onChange={pickItem}
          options={[...items].sort((a, b) => a.description.localeCompare(b.description)).map((i) => ({ value: i.sapCode, label: i.description, description: i.sapCode }))}
          placeholder="Search the returned item…"
          showDescription
        />
      </Field>
      <Field label="Qty" htmlFor={`${id}Qty`} className={spot.qty}>
        <Input
          id={`${id}Qty`}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={draft.qty}
          onChange={(e) => set({ qty: e.target.value })}
          className="text-right tabular-nums"
        />
      </Field>
      <Field label="Price (Rs.)" htmlFor={`${id}Price`} className={spot.price}>
        <Input
          id={`${id}Price`}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={draft.unitPrice}
          onChange={(e) => set({ unitPrice: e.target.value })}
          className="text-right tabular-nums"
        />
      </Field>
      <div className={spot.footer}>
        <p className={cn("text-xs", error ? "text-red-600" : "text-slate-500", wide && "pb-2")}>
          {error ?? (draft.qty && draft.unitPrice ? `Credit ${formatMoney(returnValue(draft))}` : "")}
        </p>
        <div className="flex shrink-0 gap-1">
          {returnStarted(draft) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(returns, blankReturn(draft.kind));
                setError(undefined);
              }}
            >
              Clear
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={add}>
            <Plus /> Add return
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Returns added in a dialog, each with a remove button */
export function ReturnList({ returns, onRemove }: { returns: ReturnDraft[]; onRemove: (key: string) => void }) {
  const itemMap = useItemMap();
  if (returns.length === 0) return null;
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
      {returns.map((r) => (
        <li key={r.key} className="flex items-center gap-3 px-3 py-2 text-sm">
          <ReturnKindBadge kind={r.kind} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? r.sapCode}</p>
            <p className="text-xs text-slate-500">
              {formatQty(toNumber(r.qty))} × {formatMoney(toNumber(r.unitPrice))}
            </p>
          </div>
          <span className="font-medium text-red-600 tabular-nums">− {formatMoney(returnValue(r))}</span>
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-red-50 hover:text-red-600"
            onClick={() => onRemove(r.key)}
            aria-label={`Remove return of ${r.sapCode}`}
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Returns on the bill form, as a table like its items */
export function ReturnTable({ returns, onRemove }: { returns: ReturnDraft[]; onRemove: (key: string) => void }) {
  const itemMap = useItemMap();
  if (returns.length === 0) return null;
  return (
    <Table>
      <THead>
        <tr>
          <TH className="w-10">#</TH>
          <TH>Type</TH>
          <TH>Item</TH>
          <TH className="text-right">Qty</TH>
          <TH className="text-right">Unit Price</TH>
          <TH className="text-right">Value</TH>
          <TH className="w-16">
            <span className="sr-only">Actions</span>
          </TH>
        </tr>
      </THead>
      <TBody>
        {returns.map((r, index) => (
          <TR key={r.key}>
            <TD className="text-slate-400 tabular-nums">{index + 1}</TD>
            <TD>
              <ReturnKindBadge kind={r.kind} />
            </TD>
            <TD className="whitespace-normal">
              <span className="block font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? "Unknown item"}</span>
              <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
            </TD>
            <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(toNumber(r.qty))}</TD>
            <TD className="text-right tabular-nums">{formatMoney(toNumber(r.unitPrice))}</TD>
            <TD className="text-right font-medium text-red-600 tabular-nums">− {formatMoney(returnValue(r))}</TD>
            <TD>
              <div className="flex items-center justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-red-50 hover:text-red-600"
                  onClick={() => onRemove(r.key)}
                  aria-label={`Remove return ${index + 1}`}
                  title="Remove"
                >
                  <Trash2 />
                </Button>
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
