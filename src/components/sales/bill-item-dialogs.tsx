"use client";

import { ArrowLeft, Ban, ChevronRight, Gift, PackageMinus, StickyNote, Tag, Trash2, Undo2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, toNumber } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";
import { itemPickOptions } from "@/lib/categories";
import { billDiscount, chargedQty, isFreeItem, isRemoved, lineValue, missingSold, saleSubtotal, saleTotal } from "@/lib/ledger";
import { useAppStore, useItemMap, useItemPickOptions } from "@/lib/store";
import { RETURN_KINDS, type BillItemInput, type Item, type ReturnKind, type Sale, type SaleLine, type SaleReturn } from "@/lib/types";
import { cn, formatMoney, formatQty, round2 } from "@/lib/utils";
import { RETURN_KIND_HINT } from "./return-items";

// Items and return items changed on the bill's own page, without opening the whole bill form.
//   Add item / Add free issue item  one simple form
//   Update item                     pick ONE change first (qty, remove, free issue, price, note), then only its boxes show
//   Add / edit return               one simple form

/** A sold item's free issue: more of the same item, or another item given with it */
type FreeKind = "same" | "other";
/** What Add puts on the bill: an item sold, or a free issue item */
export type AddKind = "item" | "free";
/** Update item: the list of changes, or the one being made */
type Step = "choose" | "qty" | "remove" | "free" | "price" | "note";

const isWhole = (v: string) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;
/** Typed box as a whole number; "" counts as 0 */
const wholeOrZero = (v: string) => (v === "" ? 0 : Number(v));
/** Reducing and removing are done before delivery (at delivery the store's cancelled qty is used) */
const canReduceOn = (sale: Sale) => sale.status === "Ordered" || sale.status === "Loaded";

/** The bill's invoice value with its lines (or return items) changed (the bill discount follows) */
function totalWith(sale: Sale, lines: Parameters<typeof lineValue>[0][], returns: { qty: number; unitPrice: number }[] = sale.returns) {
  const gross = saleSubtotal({ lines, returns });
  return round2(gross - billDiscount(gross, sale.discountPercent));
}

/** "Rs A → Rs B" when an invoice value changes */
function TotalChange({ before, after }: { before: number; after: number }) {
  const changed = Math.abs(after - before) > 0.004;
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
      <span className="text-slate-500">Invoice value</span>
      <span className="font-semibold text-slate-900 tabular-nums">
        {changed && <span className="mr-2 font-normal text-slate-400 line-through">{formatMoney(before)}</span>}
        {formatMoney(after)}
        {changed && (
          <span className={cn("ml-2 text-xs font-medium", after < before ? "text-red-600" : "text-emerald-700")}>
            ({after < before ? "−" : "+"} {formatMoney(Math.abs(round2(after - before)))})
          </span>
        )}
      </span>
    </div>
  );
}

/** Items to pick from, by category; ones already on the bill can't be picked again (except `allow`) */
function itemOptions(items: Item[], sale: Sale, allow?: string) {
  return itemPickOptions(items).map((o) => ({ ...o, disabled: o.value !== allow && sale.lines.some((l) => l.sapCode === o.value) }));
}

/** Free issue of a sold item: one qty, of the same item or of another item given with it */
function FreeIssueFields({
  kind,
  onKind,
  qty,
  onQty,
  otherCode,
  onOther,
  options,
  itemName,
  hintFor,
}: {
  kind: FreeKind;
  onKind: (kind: FreeKind) => void;
  qty: string;
  onQty: (qty: string) => void;
  otherCode: string;
  onOther: (code: string) => void;
  options: ReturnType<typeof itemOptions>;
  itemName: string;
  /** "N in stock · pack" for the item given free */
  hintFor: (code: string) => string | undefined;
}) {
  return (
    <div className="flex flex-col gap-3">
      <FilterTabs<FreeKind>
        value={kind}
        onChange={(k) => {
          onKind(k);
          requestAnimationFrame(() => document.getElementById(k === "other" ? "billFreeOther" : "billFreeQty")?.focus());
        }}
        options={[
          { value: "same", label: "Same item" },
          { value: "other", label: "Another item" },
        ]}
      />
      {kind === "other" && (
        <Field label="Item given free" htmlFor="billFreeOther" hint={otherCode ? hintFor(otherCode) : "e.g. Coffee 50g free with Coffee 100g"}>
          <SearchSelect
            id="billFreeOther"
            value={otherCode}
            onChange={(code) => {
              onOther(code);
              requestAnimationFrame(() => document.getElementById("billFreeQty")?.focus());
            }}
            options={options}
            placeholder="Pick the item…"
            showDescription
          />
        </Field>
      )}
      <div className="flex items-end gap-3">
        <Field label="Free qty" htmlFor="billFreeQty" className="w-28">
          <Input
            id="billFreeQty"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={qty}
            placeholder="0"
            onChange={(e) => onQty(e.target.value)}
            className="text-right tabular-nums"
          />
        </Field>
        <p className="pb-2.5 text-xs text-slate-500">{kind === "same" ? `More ${itemName}, given free` : "0 = no free item"}</p>
      </div>
    </div>
  );
}

// ---------- Add item / Add free issue item ----------

function AddItemForm({ sale, addKind, onDone }: { sale: Sale; addKind: AddKind; onDone: () => void }) {
  const items = useAppStore((s) => s.items);
  const stock = useAppStore((s) => s.stock);
  const saveBillItem = useAppStore((s) => s.saveBillItem);
  const itemMap = useItemMap();
  const freeOnly = addKind === "free";

  const [sapCode, setSapCode] = useState("");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [discountPct, setDiscountPct] = useState("0");
  const [freeKind, setFreeKind] = useState<FreeKind>("same");
  const [freeQty, setFreeQty] = useState("");
  const [otherCode, setOtherCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();

  const item = itemMap.get(sapCode);
  const inStock = (code: string) => stock.filter((r) => r.sapCode === code).reduce((n, r) => n + r.availableQty, 0);
  const hintFor = (code: string) => [`${formatQty(inStock(code))} in stock`, itemMap.get(code)?.packageDetails].filter(Boolean).join(" · ");
  const added = freeOnly
    ? { qty: 0, freeQty: wholeOrZero(qty), missingQty: 0, unitPrice: toNumber(unitPrice), discountPct: 0 }
    : { qty: wholeOrZero(qty), freeQty: freeKind === "same" ? wholeOrZero(freeQty) : 0, missingQty: 0, unitPrice: toNumber(unitPrice), discountPct: toNumber(discountPct) };
  const after = totalWith(sale, [...sale.lines, added]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let err: string | undefined;
    if (!sapCode) err = freeOnly ? "Pick the free issue item." : "Pick the item.";
    else if (!isWhole(qty) || Number(qty) === 0) err = freeOnly ? "Enter the free qty." : "Enter the qty.";
    else if (unitPrice === "" || added.unitPrice < 0) err = "Enter the unit price.";
    else if (!(added.discountPct >= 0 && added.discountPct <= 100)) err = "Discount must be a % from 0 to 100.";
    else if (freeQty !== "" && !isWhole(freeQty)) err = "Free qty must be a whole number, 0 or more.";
    else if (!freeOnly && freeKind === "other" && wholeOrZero(freeQty) > 0 && !otherCode) err = "Pick the item given free.";
    setError(err);
    if (err) return;
    const input: BillItemInput = {
      sapCode,
      ...added,
      note,
      // Another item given free with it; null = none
      ...(freeOnly ? {} : { otherFree: freeKind === "other" && otherCode && wholeOrZero(freeQty) > 0 ? { sapCode: otherCode, freeQty: wholeOrZero(freeQty) } : null }),
    };
    const saved = await saveBillItem(sale.id, null, input);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    const name = item?.description ?? sapCode;
    toast.success(`${name} × ${formatQty(freeOnly ? input.freeQty : input.qty)}${freeOnly ? " free" : ""} added · ${sale.saleNo} invoice ${formatMoney(after)}`);
    onDone();
  }

  return (
    <form id="bill-item-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={freeOnly ? "Free issue item" : "Item"}
        htmlFor="billItemPick"
        required
        hint={item ? hintFor(sapCode) : freeOnly ? "e.g. Coffee 50g given free" : undefined}
      >
        <SearchSelect
          id="billItemPick"
          value={sapCode}
          onChange={(code) => {
            setSapCode(code);
            // Starts at the wholesale price (for a free issue item: what Raigam pays back)
            setUnitPrice(String(itemMap.get(code)?.wholesalePrice ?? 0));
            setError(undefined);
            requestAnimationFrame(() => document.getElementById("billItemQty")?.focus());
          }}
          options={itemOptions(items, sale)}
          placeholder="Search item code or name…"
          showDescription
          autoFocus
        />
      </Field>

      <div className={cn("grid gap-4", freeOnly ? "grid-cols-2" : "grid-cols-3")}>
        <Field label={freeOnly ? "Free qty" : "Qty"} htmlFor="billItemQty" required>
          <Input
            id="billItemQty"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="text-right tabular-nums"
          />
        </Field>
        {!freeOnly && (
          <>
            <Field label="Price (Rs.)" htmlFor="billItemPrice" required hint={item && added.unitPrice !== item.wholesalePrice ? `List ${formatMoney(item.wholesalePrice)}` : undefined}>
              <Input
                id="billItemPrice"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="text-right tabular-nums"
              />
            </Field>
            <Field label="Disc. %" htmlFor="billItemDiscount">
              <Input
                id="billItemDiscount"
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                className="text-right tabular-nums"
              />
            </Field>
          </>
        )}
      </div>

      {!freeOnly && (
        <fieldset className="rounded-lg border border-slate-200 px-3 pt-2 pb-3">
          <legend className="px-1 text-sm font-semibold text-slate-900">Free issue</legend>
          <FreeIssueFields
            kind={freeKind}
            onKind={setFreeKind}
            qty={freeQty}
            onQty={setFreeQty}
            otherCode={otherCode}
            onOther={setOtherCode}
            options={itemOptions(items, sale).map((o) => (o.value === sapCode ? { ...o, disabled: true } : o))}
            itemName={item?.description ?? "of this item"}
            hintFor={hintFor}
          />
        </fieldset>
      )}

      <Field label="Note" htmlFor="billItemNote" hint="Optional. Shown on the bill under the item.">
        <Input id="billItemNote" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {freeOnly ? (
        <p className="text-xs text-slate-500">
          Not charged to the store: Raigam pays it back ({formatMoney(round2(added.freeQty * added.unitPrice))} at {formatMoney(added.unitPrice)} each). It&apos;s taken
          from stock when the bill is loaded.
        </p>
      ) : (
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Item value</span>
          <span className="font-medium text-slate-900 tabular-nums">{formatMoney(lineValue(added))}</span>
        </div>
      )}
      <TotalChange before={saleTotal(sale)} after={after} />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

// ---------- Update item: pick one change, then only its boxes ----------

/** The item at a glance: booked, taken off, reduced, giving and its value */
function ItemSummary({ sale, line }: { sale: Sale; line: SaleLine }) {
  const itemMap = useItemMap();
  const item = itemMap.get(line.sapCode);
  const removed = isRemoved(line);
  const freeOnly = isFreeItem(line);
  const tiles: { label: string; value: string; tone?: "red" }[] = freeOnly
    ? [
        { label: "Free qty", value: formatQty(line.freeQty) },
        { label: "Reduced", value: line.missingQty ? formatQty(line.missingQty) : "—", tone: line.missingQty ? "red" : undefined },
        { label: "Giving", value: formatQty(Math.max(0, line.freeQty - line.missingQty)) },
      ]
    : [
        { label: "Booked", value: formatQty(line.qty + line.takenOff) },
        { label: "Taken off", value: line.takenOff ? formatQty(line.takenOff) : "—", tone: line.takenOff ? "red" : undefined },
        { label: "Reduced", value: missingSold(line) ? formatQty(missingSold(line)) : "—", tone: missingSold(line) ? "red" : undefined },
        { label: "Giving", value: formatQty(chargedQty(line)) },
        { label: "Value", value: formatMoney(lineValue(line)) },
      ];
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", removed ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("font-medium", removed ? "text-red-700 line-through" : "text-slate-900")}>{item?.description ?? line.sapCode}</p>
          <p className="font-mono text-xs text-slate-500">
            {line.sapCode} · {line.locationNumber}
            {item?.packageDetails ? ` · ${item.packageDetails}` : ""}
          </p>
        </div>
        {removed && <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Removed from the bill</span>}
      </div>
      <dl className={cn("mt-2 grid gap-2 text-center", freeOnly ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-5")}>
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md bg-white px-2 py-1.5 ring-1 ring-slate-200">
            <dt className="text-[11px] text-slate-500">{t.label}</dt>
            <dd className={cn("text-sm font-semibold tabular-nums", t.tone === "red" ? "text-red-600" : "text-slate-900")}>{t.value}</dd>
          </div>
        ))}
      </dl>
      {(line.freeWith || line.cancelQty > 0 || sale.status !== "Ordered") && (
        <p className="mt-2 text-xs text-slate-500">
          {[
            line.freeWith ? `Free with ${itemMap.get(line.freeWith)?.description ?? line.freeWith}` : "",
            line.cancelQty ? `${formatQty(line.cancelQty)} cancelled at delivery` : "",
            sale.status === "Loaded" ? "On the lorry: stock follows any change" : sale.status === "Delivered" ? "Delivered: stock follows any change" : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

/** One change to pick on the Update item list */
function ChangeCard({ icon, title, now, tone, onClick }: { icon: ReactNode; title: string; now: string; tone?: "red"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-white px-3 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50",
        tone === "red" ? "border-red-200" : "border-slate-200",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4.5",
          tone === "red" ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-700",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-semibold", tone === "red" ? "text-red-700" : "text-slate-900")}>{title}</span>
        <span className="block truncate text-xs text-slate-500">{now}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" />
    </button>
  );
}

/** A row in a step: what it is on the left (with a hint), its box or value on the right */
function StepRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const STEP_TITLES: Record<Exclude<Step, "choose">, string> = {
  qty: "Change qty",
  remove: "Remove from the bill",
  free: "Free issue",
  price: "Price & discount",
  note: "Note",
};

function UpdateItemForm({ sale, line, step, onStep, onDone }: { sale: Sale; line: SaleLine; step: Step; onStep: (s: Step) => void; onDone: () => void }) {
  const items = useAppStore((s) => s.items);
  const stock = useAppStore((s) => s.stock);
  const saveBillItem = useAppStore((s) => s.saveBillItem);
  const removeBillItem = useAppStore((s) => s.removeBillItem);
  const itemMap = useItemMap();
  const item = itemMap.get(line.sapCode);
  const name = item?.description ?? line.sapCode;
  const freeOnly = isFreeItem(line);
  const canReduce = canReduceOn(sale);
  const removed = isRemoved(line);
  const linked = freeOnly ? undefined : sale.lines.find((l) => l.freeWith === line.sapCode && l.id !== line.id);
  // A sold item as booked on Raigam: what's left on the bill + what was taken off
  const bookedAll = line.qty + line.takenOff;

  // Each change starts from the item as it is (a removed item's qty starts at all of it: putting it back)
  const [takenOff, setTakenOff] = useState(line.takenOff ? String(line.takenOff) : "");
  const [give, setGive] = useState(() => {
    if (freeOnly) return String(removed || !canReduce ? line.freeQty : line.freeQty - line.missingQty);
    return String(removed || !canReduce ? line.qty : line.qty - missingSold(line));
  });
  const [freeKind, setFreeKind] = useState<FreeKind>(linked ? "other" : "same");
  const [freeQty, setFreeQty] = useState(linked ? String(linked.freeQty) : line.freeQty && !freeOnly ? String(line.freeQty) : "");
  const [otherCode, setOtherCode] = useState(linked?.sapCode ?? "");
  const [unitPrice, setUnitPrice] = useState(String(line.unitPrice));
  const [discountPct, setDiscountPct] = useState(String(line.discountPct));
  const [note, setNote] = useState(line.note);
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const inStock = (code: string) => stock.filter((r) => r.sapCode === code).reduce((n, r) => n + r.availableQty, 0);
  const hintFor = (code: string) => [`${formatQty(inStock(code))} in stock`, itemMap.get(code)?.packageDetails].filter(Boolean).join(" · ");
  /** Units left after taken off (giving more books more, giving less reduces the rest) */
  const leftAfter = (taken: number) => Math.max(0, bookedAll - taken);

  /** The item as this step would save it; everything the step doesn't touch stays as it is */
  function changed(): BillItemInput {
    const base: BillItemInput = {
      sapCode: line.sapCode,
      qty: line.qty,
      freeQty: line.freeQty,
      missingQty: line.missingQty,
      takenOff: line.takenOff,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
      note: line.note,
    };
    const g = wholeOrZero(give);
    switch (step) {
      case "qty": {
        if (freeOnly) {
          if (!canReduce) return { ...base, freeQty: g, note };
          const total = Math.max(line.freeQty, g);
          return { ...base, freeQty: total, missingQty: total - g, note };
        }
        const taken = wholeOrZero(takenOff);
        if (!canReduce) return { ...base, qty: g, takenOff: taken, note };
        const qty = Math.max(leftAfter(taken), g);
        // Giving none of it (and no free issue) leaves it removed
        return { ...base, qty, takenOff: taken, missingQty: qty - g, note };
      }
      case "remove":
        return { ...base, missingQty: removed ? 0 : line.qty + line.freeQty, note };
      case "free": {
        const n = wholeOrZero(freeQty);
        const same = freeKind === "same" ? n : 0;
        return {
          ...base,
          freeQty: same,
          // A removed item stays removed with its new free issue
          missingQty: removed ? line.qty + same : Math.min(line.missingQty, line.qty + same),
          otherFree: freeKind === "other" && otherCode && n > 0 ? { sapCode: otherCode, freeQty: n } : null,
        };
      }
      case "price":
        return { ...base, unitPrice: toNumber(unitPrice), discountPct: toNumber(discountPct) };
      case "note":
        return { ...base, note };
      default:
        return base;
    }
  }

  const next = changed();
  const nextLine = { ...next, cancelQty: line.cancelQty };
  const after = totalWith(
    sale,
    sale.lines.map((l) => (l.id === line.id ? nextLine : l)),
  );

  function check(): string | undefined {
    if (step === "qty") {
      if (!isWhole(give)) return `${freeOnly ? "Free qty" : "Qty"} to give must be a whole number, 0 or more.`;
      if (!freeOnly && takenOff !== "" && !isWhole(takenOff)) return "Taken off must be a whole number, 0 or more.";
      if (!freeOnly && canReduce && wholeOrZero(takenOff) > bookedAll)
        return `Taken off can't be more than booked (${formatQty(bookedAll)}). To book more, raise the qty to give.`;
      if (line.cancelQty > next.qty - missingSold(next))
        return `${formatQty(line.cancelQty)} were cancelled at delivery, so the qty can't be less than ${formatQty(line.cancelQty)}.`;
    }
    if (step === "free") {
      if (freeQty !== "" && !isWhole(freeQty)) return "Free qty must be a whole number, 0 or more.";
      if (freeKind === "other" && wholeOrZero(freeQty) > 0 && !otherCode) return "Pick the item given free.";
    }
    if (step === "price") {
      if (unitPrice === "" || toNumber(unitPrice) < 0) return "Enter the unit price.";
      if (!(toNumber(discountPct) >= 0 && toNumber(discountPct) <= 100)) return "Discount must be a % from 0 to 100.";
    }
    return undefined;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (step === "choose") return;
    const err = check();
    setError(err);
    if (err) return;
    const saved = await saveBillItem(sale.id, line.id, next);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    const done: Record<Exclude<Step, "choose">, string> = {
      qty: isRemoved(next) ? `${name} removed from the bill` : `${name}: giving ${formatQty(freeOnly ? next.freeQty - next.missingQty : chargedQty(next))}`,
      remove: removed ? `${name} is back on the bill` : `${name} removed from the bill`,
      free: `${name}: free issue saved`,
      price: `${name}: price saved`,
      note: `${name}: note saved`,
    };
    toast.success(`${done[step]} · ${sale.saleNo} invoice ${formatMoney(after)}`);
    onDone();
  }

  async function deleteLine() {
    const result = await removeBillItem(sale.id, line.id);
    if (!result.ok) {
      setError(result.error);
      setConfirmDelete(false);
      return;
    }
    toast.success(`${name} deleted from ${sale.saleNo}`);
    onDone();
  }

  function open(s: Step) {
    setError(undefined);
    onStep(s);
  }

  // What each change is now, shown on its card
  const freeNow = linked
    ? `${formatQty(linked.freeQty)} × ${itemMap.get(linked.sapCode)?.description ?? linked.sapCode}`
    : line.freeQty && !freeOnly
      ? `${formatQty(line.freeQty)} more of the same item`
      : "None";
  const qtyNow = freeOnly
    ? `Giving ${formatQty(Math.max(0, line.freeQty - line.missingQty))} of ${formatQty(line.freeQty)} free`
    : `Giving ${formatQty(chargedQty(line))} of ${formatQty(bookedAll)} booked${line.takenOff ? ` · ${formatQty(line.takenOff)} taken off` : ""}`;

  if (step === "choose") {
    return (
      <div className="flex flex-col gap-4">
        <ItemSummary sale={sale} line={line} />
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-900">What do you want to change?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ChangeCard icon={<PackageMinus />} title="1. Change qty" now={canReduce ? `${qtyNow} · reduce or taken off` : qtyNow} onClick={() => open("qty")} />
            {canReduce && (
              <ChangeCard
                icon={removed ? <Undo2 /> : <Ban />}
                title={removed ? "2. Put back on the bill" : "2. Remove from the bill"}
                now={removed ? "It's removed now (red row)" : "Not in our store: red row, not charged"}
                tone="red"
                onClick={() => open("remove")}
              />
            )}
            {!freeOnly && <ChangeCard icon={<Gift />} title={`${canReduce ? 3 : 2}. Free issue`} now={freeNow} onClick={() => open("free")} />}
            {!freeOnly && (
              <ChangeCard
                icon={<Tag />}
                title={`${canReduce ? 4 : 3}. Price & discount`}
                now={`${formatMoney(line.unitPrice)}${line.discountPct ? ` · ${line.discountPct}% off` : " · no discount"}`}
                onClick={() => open("price")}
              />
            )}
            <ChangeCard
              icon={<StickyNote />}
              title={`${[true, canReduce, !freeOnly, !freeOnly].filter(Boolean).length + 1}. Note`}
              now={line.note || "None"}
              onClick={() => open("note")}
            />
          </div>
        </div>
        {/* Entered by mistake: deleted outright (not given to the store: Remove keeps it on the bill as a red row) */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          {confirmDelete ? (
            <>
              <span className="text-sm text-red-700">
                Delete {name} from the bill completely{linked ? ` (and ${itemMap.get(linked.sapCode)?.description ?? linked.sapCode} given free with it)` : ""}?
              </span>
              <Button variant="danger" size="sm" onClick={deleteLine}>
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete (entered by mistake)
            </Button>
          )}
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <form id="bill-item-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => open("choose")}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <h3 className="text-base font-semibold text-slate-900">{STEP_TITLES[step]}</h3>
        <span className="truncate text-sm text-slate-500">· {name}</span>
      </div>

      {step === "qty" && (
        <div className="rounded-lg border border-slate-200 px-3">
          {freeOnly ? (
            <>
              <StepRow label="Free qty booked">
                <span className="text-sm font-semibold tabular-nums">{formatQty(line.freeQty)}</span>
              </StepRow>
              <StepRow label="Free qty to give" hint={canReduce ? `Less than ${formatQty(line.freeQty)} = reduced` : undefined}>
                <QtyBox id="billStepGive" value={give} onChange={setGive} autoFocus />
              </StepRow>
            </>
          ) : (
            <>
              <StepRow label="Booked on Raigam">
                <span className="text-sm font-semibold tabular-nums">{formatQty(next.qty + (next.takenOff ?? 0))}</span>
              </StepRow>
              <StepRow label="Taken off" hint="As on Raigam's bill">
                <QtyBox
                  id="billStepTakenOff"
                  value={takenOff}
                  onChange={(v) => {
                    // A qty to give that matched what was left follows the new amount left
                    if (canReduce && wholeOrZero(give) === leftAfter(wholeOrZero(takenOff)) && isWhole(v || "0")) setGive(String(leftAfter(wholeOrZero(v))));
                    setTakenOff(v);
                  }}
                />
              </StepRow>
              <StepRow
                label={canReduce ? "Qty to give" : "Qty"}
                hint={canReduce ? `Up to ${formatQty(leftAfter(wholeOrZero(takenOff)))}. Less = reduced (e.g. not in our store)` : undefined}
              >
                <QtyBox id="billStepGive" value={give} onChange={setGive} autoFocus />
              </StepRow>
              {canReduce && missingSold(next) > 0 && !isRemoved(next) && (
                <StepRow label="Reduced">
                  <span className="text-sm font-semibold text-red-600 tabular-nums">{formatQty(missingSold(next))}</span>
                </StepRow>
              )}
            </>
          )}
        </div>
      )}

      {step === "remove" && (
        <div className={cn("rounded-lg border px-4 py-3 text-sm", removed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
          {removed ? (
            <>
              <p className="font-semibold">Put {name} back on the bill?</p>
              <p className="mt-1">It&apos;s loaded and charged again, as booked.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Remove {name} from the bill?</p>
              <ul className="mt-1 list-disc pl-5">
                <li>It stays on the bill as a red, crossed-out row.</li>
                <li>It isn&apos;t loaded and isn&apos;t charged.</li>
                <li>You can put it back any time before delivery.</li>
              </ul>
            </>
          )}
        </div>
      )}

      {step === "free" && (
        <FreeIssueFields
          kind={freeKind}
          onKind={(k) => {
            setFreeKind(k);
            setError(undefined);
          }}
          qty={freeQty}
          onQty={setFreeQty}
          otherCode={otherCode}
          onOther={(code) => {
            setOtherCode(code);
            setError(undefined);
          }}
          options={itemOptions(items, sale, linked?.sapCode).map((o) => (o.value === line.sapCode ? { ...o, disabled: true } : o))}
          itemName={name}
          hintFor={hintFor}
        />
      )}

      {step === "price" && (
        <div className="rounded-lg border border-slate-200 px-3">
          <StepRow label="Unit price (Rs.)" hint={item ? `List ${formatMoney(item.wholesalePrice)}` : undefined}>
            <Input
              id="billStepPrice"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="w-32 text-right tabular-nums"
              autoFocus
            />
          </StepRow>
          <StepRow label="Discount %">
            <Input
              id="billStepDiscount"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
              className="w-32 text-right tabular-nums"
            />
          </StepRow>
        </div>
      )}

      {/* A note goes with a change of qty or a removal, or on its own */}
      {(step === "qty" || step === "remove" || step === "note") && (
        <Field label={step === "note" ? "Note" : "Note (optional)"} htmlFor="billStepNote" hint="Why it was changed. Shown on the bill under the item.">
          <Input
            id="billStepNote"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder={step === "note" ? "" : "e.g. only 10 in our store"}
            autoFocus={step === "note" || step === "remove"}
          />
        </Field>
      )}

      {!freeOnly && step !== "note" && (
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Item value</span>
          <span className={cn("font-medium tabular-nums", isRemoved(next) ? "text-red-600" : "text-slate-900")}>
            {formatMoney(lineValue(nextLine))}
            {Math.abs(lineValue(nextLine) - lineValue(line)) > 0.004 && <span className="ml-2 text-xs text-slate-400 line-through">{formatMoney(lineValue(line))}</span>}
          </span>
        </div>
      )}
      {step !== "note" && <TotalChange before={saleTotal(sale)} after={after} />}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** A whole-number box for a step row */
function QtyBox({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Input
      id={id}
      type="number"
      min={0}
      step={1}
      inputMode="numeric"
      value={value}
      placeholder="0"
      onChange={(e) => onChange(e.target.value)}
      className="w-28 text-right tabular-nums"
      autoFocus={autoFocus}
    />
  );
}

/** Change one item on a bill (`line`), or add one (`line` null): a sold item or a free issue item (`addKind`) */
export function BillItemDialog({
  sale,
  line,
  addKind = "item",
  open,
  onClose,
}: {
  sale: Sale;
  line: SaleLine | null;
  addKind?: AddKind;
  open: boolean;
  onClose: () => void;
}) {
  // Update item opens on the list of changes; it's back there next time it opens
  const [step, setStep] = useState<Step>("choose");
  function close() {
    setStep("choose");
    onClose();
  }

  if (!line) {
    return (
      <Modal
        open={open}
        onClose={close}
        title={`${addKind === "free" ? "Add free issue item" : "Add item"} · ${sale.saleNo}`}
        description={addKind === "free" ? "Another item given free with this bill." : "A new item on this bill."}
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="bill-item-form">
              {addKind === "free" ? "Add free item" : "Add item"}
            </Button>
          </>
        }
      >
        {/* A fresh form each time it opens */}
        {open && <AddItemForm key={`new-${addKind}`} sale={sale} addKind={addKind} onDone={close} />}
      </Modal>
    );
  }

  const removing = step === "remove" && !isRemoved(line);
  const saveLabel: Record<Exclude<Step, "choose">, string> = {
    qty: "Save qty",
    remove: isRemoved(line) ? "Put back on the bill" : "Remove from the bill",
    free: "Save free issue",
    price: "Save price",
    note: "Save note",
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Update item · ${sale.saleNo}`}
      description={step === "choose" ? "Pick one change. The rest of the bill stays as it is." : "Change this, then Save."}
      footer={
        step === "choose" ? (
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="bill-item-form" variant={removing ? "danger" : "primary"}>
              {saveLabel[step]}
            </Button>
          </>
        )
      }
    >
      {open && <UpdateItemForm key={line.id} sale={sale} line={line} step={step} onStep={setStep} onDone={close} />}
    </Modal>
  );
}

// ---------- Return items ----------

function BillReturnForm({ sale, ret, onDone }: { sale: Sale; ret: SaleReturn | null; onDone: () => void }) {
  const pickOptions = useItemPickOptions();
  const saveBillReturn = useAppStore((s) => s.saveBillReturn);
  const itemMap = useItemMap();
  const [kind, setKind] = useState<ReturnKind>(ret?.kind ?? "Market");
  const [sapCode, setSapCode] = useState(ret?.sapCode ?? "");
  const [qty, setQty] = useState(ret ? String(ret.qty) : "");
  const [unitPrice, setUnitPrice] = useState(ret ? String(ret.unitPrice) : "");
  const [error, setError] = useState<string>();

  const others = sale.returns.filter((r) => r.id !== ret?.id);
  const credit = round2(toNumber(qty) * toNumber(unitPrice));
  const after = totalWith(sale, sale.lines, [...others, { qty: toNumber(qty), unitPrice: toNumber(unitPrice) }]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let err: string | undefined;
    if (!sapCode) err = "Pick the returned item.";
    else if (!isWhole(qty) || Number(qty) === 0) err = "Enter the returned qty (a whole number).";
    else if (unitPrice === "" || toNumber(unitPrice) < 0) err = "Enter the price to credit.";
    else if (others.some((r) => r.kind === kind && r.sapCode === sapCode))
      err = `${itemMap.get(sapCode)?.description ?? sapCode} is already a ${kind.toLowerCase()} return on this bill. Change that one instead.`;
    setError(err);
    if (err) return;
    const saved = await saveBillReturn(sale.id, ret?.id ?? null, { kind, sapCode, qty: Number(qty), unitPrice: toNumber(unitPrice) });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    toast.success(
      `${kind} return ${ret ? "updated" : "added"}: ${itemMap.get(sapCode)?.description ?? sapCode} × ${formatQty(Number(qty))} · ${sale.saleNo} invoice ${formatMoney(after)}`,
    );
    onDone();
  }

  return (
    <form id="bill-return-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Type" hint={RETURN_KIND_HINT[kind]}>
        <FilterTabs<ReturnKind> value={kind} onChange={setKind} options={RETURN_KINDS.map((k) => ({ value: k, label: `${k} return` }))} />
      </Field>
      <Field label="Item" htmlFor="billReturnItem" required>
        <SearchSelect
          id="billReturnItem"
          value={sapCode}
          onChange={(code) => {
            setSapCode(code);
            // Credited at the price on this bill if the item is on it, else the list price
            setUnitPrice(String(sale.lines.find((l) => l.sapCode === code)?.unitPrice ?? itemMap.get(code)?.wholesalePrice ?? ""));
            setError(undefined);
            requestAnimationFrame(() => document.getElementById("billReturnQty")?.focus());
          }}
          options={pickOptions}
          placeholder="Search the returned item…"
          showDescription
          autoFocus={!ret}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Qty" htmlFor="billReturnQty" required>
          <Input
            id="billReturnQty"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="text-right tabular-nums"
            autoFocus={!!ret}
          />
        </Field>
        <Field label="Price (Rs.)" htmlFor="billReturnPrice" required>
          <Input
            id="billReturnPrice"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            className="text-right tabular-nums"
          />
        </Field>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-500">Credit on the bill</span>
        <span className="font-medium text-red-600 tabular-nums">− {formatMoney(credit)}</span>
      </div>
      <TotalChange before={saleTotal(sale)} after={after} />
      {sale.status === "Delivered" && <p className="text-xs text-slate-500">This bill is delivered: Return Items (to send to Raigam) follows the change.</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** Add a return item to a bill (`ret` null), or change one */
export function BillReturnDialog({ sale, ret, open, onClose }: { sale: Sale; ret: SaleReturn | null; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${ret ? "Edit return" : "Add return"} · ${sale.saleNo}`}
      description="Goods the store gives back, credited on this bill. They're kept for Raigam, not put back in stock."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bill-return-form">
            {ret ? "Save return" : "Add return"}
          </Button>
        </>
      }
    >
      {open && <BillReturnForm key={ret?.id ?? "new"} sale={sale} ret={ret} onDone={onClose} />}
    </Modal>
  );
}
