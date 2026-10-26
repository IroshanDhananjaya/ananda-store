"use client";

import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button, buttonClass } from "@/components/ui/button";
import { ShopFormDialog } from "@/components/shops/shop-form-dialog";
import { Field, Input, ReadOnlyValue, toNumber } from "@/components/ui/form";
import { SearchSelect } from "@/components/ui/search-select";
import { Card, CardHeader, FilterTabs } from "@/components/ui/layout";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  amountOwed,
  billDiscount,
  chargedQty,
  isFreeItem,
  isRemoved,
  itemsTotal,
  lineValue,
  missingSold,
  returnsTotal,
  saleSubtotal,
  saleTotal,
  stockIsOut,
} from "@/lib/ledger";
import { useAppStore, useItemMap, useItemPickOptions, useRouteMap, useSaleDues, useShopBalances } from "@/lib/store";
import type { Sale, SaleInput, SaleLine, Shop } from "@/lib/types";
import { addDays, cn, formatDate, formatMoney, formatQty, newId, nextCode, round2, todayISO } from "@/lib/utils";
import { AddPaymentButton, BillPaymentDialog, BillPaymentList, type BillPaymentRow } from "./bill-payment-dialog";
import { blankReturn, pricedReturn, ReturnPanel, returnsInput, returnStarted, ReturnTable, toReturnDrafts, type ReturnDraft } from "./return-items";

/**
 * One bill line while editing; cancelQty only comes from a delivered bill (entered at delivery, not here),
 * missingQty from a loaded one (entered at loading), takenOff only from Raigam (synced: booked there but
 * taken off the bill; qty may then be 0). Qty is also 0 for a free item (only free issue).
 */
type LineDraft = {
  key: string;
  stockKey: string;
  qty: string;
  freeQty: string;
  unitPrice: string;
  discountPct: string;
  cancelQty: number;
  missingQty: number;
  takenOff: number;
  /** A free issue item given with another item on the bill: that item's SAP code ("" = not linked) */
  freeWith: string;
};
type DraftErrors = Partial<Record<"stockKey" | "qty" | "freeQty" | "unitPrice" | "discountPct", string>>;
/** The item box's free issue: more of the same item, or another item given with it (its own linked line) */
type FreeKind = "same" | "other";

const stockKeyOf = (sapCode: string, locationNumber: string) => `${sapCode}|${locationNumber}`;
const splitKey = (key: string) => {
  const [sapCode = "", locationNumber = ""] = key.split("|");
  return { sapCode, locationNumber };
};
const emptyDraft = (): LineDraft => ({
  key: newId(),
  stockKey: "",
  qty: "",
  freeQty: "0",
  unitPrice: "",
  discountPct: "0",
  cancelQty: 0,
  missingQty: 0,
  takenOff: 0,
  freeWith: "",
});
const isWhole = (v: string) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;
/** A line as numbers, for the bill maths in ledger.ts */
const priced = (l: LineDraft) => ({
  qty: toNumber(l.qty),
  unitPrice: toNumber(l.unitPrice),
  discountPct: toNumber(l.discountPct),
  cancelQty: l.cancelQty,
  missingQty: l.missingQty,
});
/** Units a line takes out of stock: sold + free, less what's missing in the store and was cancelled at delivery */
const unitsOut = (l: LineDraft) => toNumber(l.qty) + toNumber(l.freeQty) - l.missingQty - l.cancelQty;
/** A free issue item: another item given only free (qty 0), listed under Free issue items */
const isFreeLine = (l: LineDraft) => isFreeItem({ qty: toNumber(l.qty), freeQty: toNumber(l.freeQty), takenOff: l.takenOff });
/** The free issue box: an item and its free qty */
const emptyFree = { stockKey: "", freeQty: "" };

/** Focus a field once React has drawn it */
const focusField = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/** What the bill's page set on a saved item (kept when the form is saved): removed, its note */
function SavedLineNotes({ line }: { line?: SaleLine }) {
  if (!line) return null;
  return (
    <>
      {isRemoved(line) && <span className="block text-xs font-semibold text-red-600">Removed from the bill</span>}
      {line.note && <span className="block text-xs text-slate-600 italic">Note: {line.note}</span>}
    </>
  );
}

/** The free issue item given with an item (its free line linked to it), if any */
const linkedFree = (lines: LineDraft[], sapCode: string) => (sapCode ? lines.find((l) => l.freeWith === sapCode && isFreeLine(l)) : undefined);

export function SaleForm({
  sale,
  defaultShopId,
  onSaved,
  cancelHref,
}: {
  sale: Sale | null;
  defaultShopId?: string;
  onSaved: (id: string) => void;
  cancelHref: string;
}) {
  const shops = useAppStore((s) => s.shops);
  const routes = useAppStore((s) => s.routes);
  const stock = useAppStore((s) => s.stock);
  const locations = useAppStore((s) => s.locations);
  const sales = useAppStore((s) => s.sales);
  const createSale = useAppStore((s) => s.createSale);
  const updateSale = useAppStore((s) => s.updateSale);
  const itemMap = useItemMap();
  const routeMap = useRouteMap();
  const balances = useShopBalances();
  // Loaded or delivered: the items are already out of stock
  const stockOut = !!sale && stockIsOut(sale);
  const delivered = sale?.status === "Delivered";

  const repOf = (shopId: string) => routeMap.get(shops.find((s) => s.id === shopId)?.routeId ?? "")?.salesRep ?? "";

  const initialShop = sale?.shopId ?? defaultShopId ?? "";
  const initialDate = sale?.date ?? todayISO();
  const [date, setDate] = useState(initialDate);
  const [shopId, setShopId] = useState(initialShop);
  const [repName, setRepName] = useState(sale?.repName ?? repOf(initialShop));
  // The end date is set at delivery (delivery date + the store's credit days); only a delivered bill's can be changed here
  const [dueDate, setDueDate] = useState(sale?.dueDate ?? "");
  // The rep follows the store until the user changes it
  const [repTouched, setRepTouched] = useState(!!sale);
  const [notes, setNotes] = useState(sale?.notes ?? "");
  const [invoiceNo, setInvoiceNo] = useState(sale?.invoiceNo ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (sale?.lines ?? []).map((l) => ({
      key: l.id,
      stockKey: stockKeyOf(l.sapCode, l.locationNumber),
      qty: String(l.qty),
      freeQty: String(l.freeQty),
      unitPrice: String(l.unitPrice),
      discountPct: String(l.discountPct),
      cancelQty: l.cancelQty,
      missingQty: l.missingQty,
      takenOff: l.takenOff,
      freeWith: l.freeWith,
    })),
  );
  const [draft, setDraft] = useState<LineDraft>(emptyDraft);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // The item box's free issue: of the same item (the draft's free qty), or another item given with it (that qty)
  const [draftFreeKind, setDraftFreeKind] = useState<FreeKind>("same");
  const [draftOther, setDraftOther] = useState("");
  // The item box as it was when an item was loaded into it, to tell if it was changed
  const [editStart, setEditStart] = useState("");
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [discountPercent, setDiscountPercent] = useState(sale?.discountPercent ? String(sale.discountPercent) : "");
  // Return items (good / market): the box opens when there are some, or when asked for
  const [returns, setReturns] = useState<ReturnDraft[]>(() => toReturnDrafts(sale?.returns ?? []));
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>(() => blankReturn());
  const [showReturns, setShowReturns] = useState(() => (sale?.returns.length ?? 0) > 0);
  // The return loaded into the box to change (its key), if any
  const [editingReturn, setEditingReturn] = useState<string | null>(null);
  // Free issue items (other items given only free): their own box, open when there are some or when asked for
  const [showFree, setShowFree] = useState(() => (sale?.lines ?? []).some(isFreeItem));
  const [freeDraft, setFreeDraft] = useState(emptyFree);
  const [freeError, setFreeError] = useState<string>();
  // Name typed in the Store box for a store that isn't in the list yet (opens Add store)
  const [newStoreName, setNewStoreName] = useState<string | null>(null);
  const [formError, setFormError] = useState<string>();
  // New bill: payments the store makes with the order, saved together with the bill
  const [paidWithOrder, setPaidWithOrder] = useState<BillPaymentRow[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const allPayments = useAppStore((s) => s.payments);
  const savedDue = useSaleDues().get(sale?.id ?? "");

  // When editing a loaded/delivered bill, what it already holds out of stock counts as available
  const available = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of stock) map.set(stockKeyOf(r.sapCode, r.locationNumber), r.availableQty);
    if (stockOut) {
      for (const l of sale?.lines ?? []) {
        const k = stockKeyOf(l.sapCode, l.locationNumber);
        map.set(k, (map.get(k) ?? 0) + l.qty + l.freeQty - l.missingQty - (delivered ? l.cancelQty : 0));
      }
    }
    return map;
  }, [stock, sale, stockOut, delivered]);

  // The item list shows the name (bold) and code only, grouped by category; each line's stock location comes from the item (locationFor)
  const itemOptions = useItemPickOptions();
  const reps = useMemo(() => [...new Set(routes.map((r) => r.salesRep).filter(Boolean))], [routes]);

  const shop: Shop | undefined = shops.find((s) => s.id === shopId);
  // Days to pay, counted from delivery (21 until a store is picked: the default for new stores)
  const creditDays = shop?.creditDays ?? 21;
  const pct = toNumber(discountPercent);
  const bill = { lines: lines.map(priced), returns: returns.map(pricedReturn) };
  const gross = saleSubtotal(bill);
  const discount = billDiscount(gross, pct);
  const total = round2(gross - discount);
  const draftCode = splitKey(draft.stockKey).sapCode;
  const draftItem = itemMap.get(draftCode);
  const editingIndex = lines.findIndex((l) => l.key === editingKey);

  // Store balance without this order (when editing a delivered one) so it isn't counted twice
  const balanceBefore = shop
    ? round2((balances.get(shop.id)?.balance ?? 0) - (sale && delivered && sale.shopId === shop.id ? amountOwed(sale) : 0))
    : 0;
  // Payments already on this bill (editing) or added to the new bill here
  const savedPayments: BillPaymentRow[] = (savedDue?.payments ?? []).map((p) => {
    const payment = allPayments.find((x) => x.id === p.paymentId);
    return {
      key: p.paymentId,
      receiptNo: p.receiptNo,
      date: p.date,
      amount: p.amount,
      method: payment?.method ?? "Cash",
      chequeNumber: payment?.chequeNumber ?? "",
      chequeDate: payment?.chequeDate ?? "",
      chequeCollectedDate: payment?.chequeCollectedDate ?? "",
      reference: payment?.reference ?? "",
      ofReceipt: payment?.amount,
    };
  });
  const paidRows = sale ? savedPayments : paidWithOrder;
  const paidTotal = round2(paidRows.reduce((sum, p) => sum + p.amount, 0));
  const leftToCollect = round2(total - paidTotal);
  const balanceAfter = round2(balanceBefore + total - (sale ? 0 : paidTotal));
  const overLimit = shop ? balanceAfter > shop.creditLimit : false;
  // The store's other bills not delivered yet: not owed yet, so not in the balance
  const waiting = shop ? sales.filter((s) => s.shopId === shop.id && (s.status === "Ordered" || s.status === "Loaded") && s.id !== sale?.id) : [];
  const shortLines = lines.filter((l) => unitsOut(l) > (available.get(l.stockKey) ?? 0));

  function changeShop(id: string) {
    // From the store itself: one just added in the Add store dialog isn't in this render's list yet
    const picked = useAppStore.getState().shops.find((s) => s.id === id);
    setShopId(id);
    if (!repTouched) setRepName(routeMap.get(picked?.routeId ?? "")?.salesRep ?? "");
  }

  // A return is credited at the price on this bill, else the list price
  function returnPrice(sapCode: string) {
    const line = lines.find((l) => splitKey(l.stockKey).sapCode === sapCode);
    return line && line.unitPrice !== "" ? toNumber(line.unitPrice) : itemMap.get(sapCode)?.wholesalePrice;
  }

  /** Taken off changed: the booked qty stays, so what's taken off comes out of the qty (or goes back into it) */
  function changeDraftTakenOff(value: string) {
    const taken = value === "" ? 0 : Math.max(0, Math.trunc(Number(value)) || 0);
    const qty = isWhole(draft.qty) ? String(Math.max(0, toNumber(draft.qty) + draft.takenOff - taken)) : draft.qty;
    setDraftField({ takenOff: taken, qty });
  }

  function setDraftField(patch: Partial<LineDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDraftErrors({});
  }

  /** Where a line takes its stock from: the item's own location, unless its stock is kept elsewhere (else the only location) */
  function locationFor(sapCode: string) {
    const own = itemMap.get(sapCode)?.locationNumber ?? "";
    const kept = stock.filter((r) => r.sapCode === sapCode && r.availableQty > 0).sort((a, b) => b.availableQty - a.availableQty);
    if (own && (kept.length === 0 || kept.some((r) => r.locationNumber === own))) return own;
    return kept[0]?.locationNumber ?? (locations.length === 1 ? locations[0].locationNumber : "");
  }

  // A picked item starts at its wholesale price (unless a price was typed)
  function pickDraftItem(sapCode: string) {
    const priceOf = (code: string) => String(itemMap.get(code)?.wholesalePrice ?? "");
    const autoPrice = draft.unitPrice === "" || draft.unitPrice === priceOf(draftCode);
    // Editing a line keeps its location while the item stays the same
    const stockKey = sapCode === draftCode ? draft.stockKey : stockKeyOf(sapCode, locationFor(sapCode));
    setDraftField({ stockKey, unitPrice: autoPrice ? priceOf(sapCode) : draft.unitPrice });
    focusField("saleDraftQty");
  }

  function checkDraft(d: LineDraft): DraftErrors {
    const e: DraftErrors = {};
    const { sapCode, locationNumber } = splitKey(d.stockKey);
    if (!sapCode) e.stockKey = "Pick an item.";
    else if (!locationNumber) e.stockKey = "This item has no stock location yet. Set it on the Items page.";
    else {
      const onBill = lines.find((l) => splitKey(l.stockKey).sapCode === sapCode && l.key !== d.key);
      if (onBill)
        e.stockKey = isFreeLine(onBill)
          ? "It's in the free issue items below. Remove it there, then add it here with its Free Issue."
          : "Already on the bill below. Edit it there.";
    }
    const free = isWhole(d.freeQty) ? toNumber(d.freeQty) : 0;
    // Qty 0 only for an item taken off on Raigam; an item given only free goes under Free issue items
    if (!isWhole(d.qty) || (toNumber(d.qty) === 0 && !d.takenOff))
      e.qty = toNumber(d.qty) === 0 && free > 0 ? "Only free? Add it under Free issue items below." : "A whole number above 0.";
    else if (d.missingQty > toNumber(d.qty) + free) e.qty = `${d.missingQty} were reduced on the bill, so qty + free can't be less.`;
    else if (d.cancelQty > toNumber(d.qty) - missingSold(priced(d)))
      e.qty = `${d.cancelQty} were cancelled at delivery, so at least ${d.cancelQty + Math.min(d.missingQty, toNumber(d.qty))}.`;
    if (!isWhole(d.freeQty)) e.freeQty = "A whole number, 0 or more.";
    if (d.unitPrice === "" || toNumber(d.unitPrice) < 0) e.unitPrice = "Enter the price.";
    if (d.discountPct === "" || toNumber(d.discountPct) < 0 || toNumber(d.discountPct) > 100) e.discountPct = "A % from 0 to 100.";
    // Loaded/delivered bills must stay within stock; new bills are only checked when loading
    if (stockOut && !e.qty && !e.freeQty && d.stockKey && unitsOut(d) > (available.get(d.stockKey) ?? 0))
      e.qty = `Only ${formatQty(available.get(d.stockKey) ?? 0)} available (qty + free).`;
    return e;
  }

  /** The item box and its free issue choice, to tell if an item loaded into it was changed */
  const draftSnapshot = () => JSON.stringify([draft, draftFreeKind, draftOther]);

  /** What's wrong with the item box's free issue of another item, if anything */
  function checkOtherFree(mainCode: string, linked: LineDraft | undefined): string | undefined {
    const qty = toNumber(draft.freeQty);
    if (draftFreeKind !== "other" || !isWhole(draft.freeQty) || qty === 0) return undefined;
    if (!draftOther) return "Pick the item given free.";
    if (draftOther === mainCode) return "For the same item, pick Same item.";
    if (lines.some((l) => splitKey(l.stockKey).sapCode === draftOther && l.key !== linked?.key))
      return "That item is already on the bill. Give its free issue on its own row.";
    const keep = linked && splitKey(linked.stockKey).sapCode === draftOther ? linked.stockKey : stockKeyOf(draftOther, locationFor(draftOther));
    if (!splitKey(keep).locationNumber) return "That item has no stock location yet. Set it on the Items page.";
    if (stockOut && qty > (available.get(keep) ?? 0)) return `Only ${formatQty(available.get(keep) ?? 0)} of it in stock.`;
    return undefined;
  }

  /** Add the panel's item to the bill (or update the one being edited), with its free issue */
  function saveDraft() {
    const mainCode = splitKey(draft.stockKey).sapCode;
    const before = lines.find((l) => l.key === editingKey);
    // The free issue item given with this one so far (by its item code before the edit)
    const linked = linkedFree(lines, before ? splitKey(before.stockKey).sapCode : mainCode);
    const other = draftFreeKind === "other";
    // Another item's free issue goes on its own line; this line keeps only free issue of the same item
    const main = { ...draft, freeQty: other ? "0" : draft.freeQty };
    const e = checkDraft(main);
    const otherErr = checkOtherFree(mainCode, linked);
    if (other && !isWhole(draft.freeQty)) e.freeQty = "A whole number, 0 or more.";
    else if (otherErr) e.freeQty = otherErr;
    setDraftErrors(e);
    if (Object.keys(e).length) return;

    const freeQty = toNumber(draft.freeQty);
    setLines((ls) => {
      let next = editingKey ? ls.map((l) => (l.key === editingKey ? main : l)) : [...ls, main];
      if (linked) next = next.filter((l) => l.key !== linked.key);
      if (other && freeQty > 0) {
        // The same free item keeps its line (location, price, anything reduced)
        const same = linked && splitKey(linked.stockKey).sapCode === draftOther ? linked : undefined;
        next = [
          ...next,
          {
            ...(same ?? emptyDraft()),
            stockKey: same?.stockKey ?? stockKeyOf(draftOther, locationFor(draftOther)),
            qty: "0",
            freeQty: String(freeQty),
            unitPrice: same?.unitPrice ?? String(itemMap.get(draftOther)?.wholesalePrice ?? 0),
            discountPct: "0",
            freeWith: mainCode,
          },
        ];
      }
      return next;
    });
    setFormError(undefined);
    resetDraft();
    focusField("saleDraftItem");
  }

  /** Empty the item box (and stop editing) */
  function resetDraft() {
    setDraft(emptyDraft());
    setEditingKey(null);
    setDraftErrors({});
    setDraftFreeKind("same");
    setDraftOther("");
  }

  function editLine(l: LineDraft) {
    // Its free issue: of another item if one is given with it, else of the same item
    const linked = linkedFree(lines, splitKey(l.stockKey).sapCode);
    const loaded = linked ? { ...l, freeQty: linked.freeQty } : l;
    const kind: FreeKind = linked ? "other" : "same";
    const other = linked ? splitKey(linked.stockKey).sapCode : "";
    setDraft(loaded);
    setDraftFreeKind(kind);
    setDraftOther(other);
    setEditStart(JSON.stringify([loaded, kind, other]));
    setEditingKey(l.key);
    setDraftErrors({});
    document.getElementById("saleDraftPanel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    focusField("saleDraftQty");
  }

  /** Empty the add-item boxes */
  function clearDraft() {
    resetDraft();
    focusField("saleDraftItem");
  }

  function cancelEdit() {
    resetDraft();
  }

  function removeLine(key: string) {
    // A free issue item given with it goes too
    setLines((ls) => {
      const code = splitKey(ls.find((l) => l.key === key)?.stockKey ?? "").sapCode;
      return ls.filter((l) => l.key !== key && !(isFreeLine(l) && l.freeWith && l.freeWith === code));
    });
    if (editingKey === key) cancelEdit();
  }

  // Enter in the panel adds the item instead of saving the whole bill
  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.defaultPrevented || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    saveDraft();
  }

  function pickFreeItem(sapCode: string) {
    setFreeDraft((d) => ({ ...d, stockKey: stockKeyOf(sapCode, locationFor(sapCode)) }));
    setFreeError(undefined);
    focusField("saleFreeQty");
  }

  /** Add the free issue box's item to the bill: a line with qty 0, valued at its wholesale price (what Raigam pays back) */
  function addFreeItem() {
    const { sapCode, locationNumber } = splitKey(freeDraft.stockKey);
    const qty = Number(freeDraft.freeQty);
    const onBill = lines.find((l) => splitKey(l.stockKey).sapCode === sapCode);
    const have = available.get(freeDraft.stockKey) ?? 0;
    let err: string | undefined;
    if (!sapCode) err = "Pick the free issue item.";
    else if (!locationNumber) err = "This item has no stock location yet. Set it on the Items page.";
    else if (onBill)
      err = isFreeLine(onBill)
        ? "Already in the free issue items. Remove it and add it again with the full qty."
        : "Already on the bill as an item: enter its free qty in that item's Free Issue box.";
    else if (freeDraft.freeQty === "" || !Number.isInteger(qty) || qty <= 0) err = "Enter the free qty (a whole number above 0).";
    // Loaded/delivered bills must stay within stock; new bills are only checked when loading
    else if (stockOut && qty > have) err = `Only ${formatQty(have)} in stock.`;
    setFreeError(err);
    if (err) return;
    setLines((ls) => [
      ...ls,
      {
        ...emptyDraft(),
        stockKey: freeDraft.stockKey,
        qty: "0",
        freeQty: String(qty),
        unitPrice: String(itemMap.get(sapCode)?.wholesalePrice ?? 0),
      },
    ]);
    setFreeDraft(emptyFree);
    setFormError(undefined);
    focusField("saleFreeItem");
  }

  // Enter in the free issue box adds the item instead of saving the whole bill
  function onFreeKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.defaultPrevented || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    addFreeItem();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const editing = lines.find((l) => l.key === editingKey);
    const pending = editing ? draftSnapshot() !== editStart : !!draft.stockKey || draft.qty !== "";

    let error: string | undefined;
    if (!shopId) error = "Select the store this bill is for.";
    else if (!date) error = "Select the order date.";
    else if (delivered && !dueDate) error = "Set the end date for collecting the balance.";
    else if (delivered && dueDate < date) error = "The end date for collecting can't be before the order date.";
    else if (invoiceNo.trim() && sales.some((s) => s.id !== sale?.id && s.invoiceNo === invoiceNo.trim().toUpperCase()))
      error = `Raigam invoice ${invoiceNo.trim().toUpperCase()} is already on ${sales.find((s) => s.invoiceNo === invoiceNo.trim().toUpperCase())?.saleNo}.`;
    else if (pending) error = editing ? "Press Update item to keep your changes to the item, or Cancel edit." : "You started an item but didn't add it. Press Add item, or clear it.";
    else if (freeDraft.stockKey || freeDraft.freeQty !== "") error = "You started a free issue item but didn't add it. Press Add free item, or clear it.";
    else if (editingReturn && JSON.stringify(returns.find((r) => r.key === editingReturn)) !== JSON.stringify(returnDraft))
      error = "Press Update return to keep your changes to the return, or Cancel edit.";
    else if (!editingReturn && returnStarted(returnDraft)) error = "You started a return but didn't add it. Press Add return, or Clear.";
    else if (lines.length === 0) error = "Add at least one item.";
    else if (Number.isNaN(Number(discountPercent)) || pct < 0 || pct >= 100) error = "Bill discount must be a % from 0 to 99.99.";
    else if (gross < 0) error = "The returns on this bill are worth more than its items.";
    else if (!sale && paidTotal > total + 0.004)
      error = `The payments added (${formatMoney(paidTotal)}) are more than the bill (${formatMoney(total)}). Remove one or change the items.`;
    setFormError(error);
    if (error) return;

    const input: SaleInput = {
      date,
      shopId,
      repName,
      // Not delivered yet: a stand-in (booking date + credit days) until delivery sets the real end date
      dueDate: delivered ? dueDate : addDays(date, creditDays),
      notes,
      invoiceNo,
      discountPercent: pct,
      lines: lines.map((l) => ({
        ...splitKey(l.stockKey),
        qty: Number(l.qty),
        freeQty: Number(l.freeQty),
        takenOff: l.takenOff,
        unitPrice: toNumber(l.unitPrice),
        discountPct: toNumber(l.discountPct),
        freeWith: l.freeWith,
      })),
      returns: returnsInput(returns),
    };
    const result = await (sale
      ? updateSale(sale.id, input)
      : createSale(
          input,
          paidWithOrder.map((p) => ({
            date: p.date,
            amount: p.amount,
            method: p.method,
            chequeNumber: p.chequeNumber,
            chequeDate: p.chequeDate,
            chequeCollectedDate: p.chequeCollectedDate,
            reference: p.reference,
          })),
        ));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(sale ? `${sale.saleNo} updated` : `Bill created · ${formatMoney(total)} · ready to load`);
    onSaved(result.id!);
  }

  const shopOptions = shops.filter((s) => s.active || s.id === shopId).sort((a, b) => a.shopName.localeCompare(b.shopName));
  // Items sold (the Items card), and other items given only free (the Free issue items card)
  const soldLines = lines.filter((l) => !isFreeLine(l));
  const freeLines = lines.filter(isFreeLine);
  const showCancel = soldLines.some((l) => l.cancelQty > 0);
  const showMissing = soldLines.some((l) => l.missingQty > 0);
  const freeMissing = freeLines.some((l) => l.missingQty > 0);
  const freeCode = splitKey(freeDraft.stockKey).sapCode;
  const freeItem = itemMap.get(freeCode);

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        <Card>
          <CardHeader
            title="Bill details"
            actions={
              <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                Bill No. <span className="text-sm font-semibold text-slate-900">{sale?.saleNo ?? nextCode(sales.map((s) => s.saleNo), "SI", 4)}</span>
              </span>
            }
          />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {/* The store first: rep, end date and the balance below follow from it */}
            <Field label="Store" htmlFor="saleShop" required className="sm:col-span-2">
              <SearchSelect
                id="saleShop"
                value={shopId}
                onChange={changeShop}
                options={shopOptions.map((s) => ({
                  value: s.id,
                  label: s.shopName,
                  description: `${s.shopCode} · ${routeMap.get(s.routeId)?.routeCode ?? "No route"}${s.town ? ` · ${s.town}` : ""}`,
                }))}
                placeholder="Select a store…"
                showDescription
                onCreate={setNewStoreName}
                createLabel={(name) => (name ? `Add “${name}” as a new store` : "Add a new store")}
                aria-invalid={formError?.startsWith("Select the store")}
                autoFocus={!shopId}
              />
            </Field>
            {shop ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 self-end rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs sm:col-span-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Owner</dt>
                  <dd className="truncate font-medium text-slate-800">{shop.ownerName || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Route</dt>
                  <dd className="truncate font-medium text-slate-800">{routeMap.get(shop.routeId)?.routeCode ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Cash balance</dt>
                  <dd className="font-medium text-slate-800 tabular-nums">{formatMoney(balanceBefore)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Credit limit</dt>
                  <dd className="font-medium text-slate-800 tabular-nums">{formatMoney(shop.creditLimit)}</dd>
                </div>
                {(balances.get(shop.id)?.overdue ?? 0) > 0 && (
                  <div className="col-span-2 flex justify-between gap-2 font-medium text-red-600">
                    <dt>Overdue</dt>
                    <dd className="tabular-nums">{formatMoney(balances.get(shop.id)!.overdue)}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="self-end rounded-lg border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500 sm:col-span-2">
                Type the store name to find it. A new store? Pick <span className="font-medium text-slate-700">Add a new store</span> at the end of the list.
              </p>
            )}

            <Field label="Booking Date" htmlFor="saleDate" required>
              <Input id="saleDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Raigam Invoice No." htmlFor="saleInvoiceNo" error={formError?.startsWith("Raigam invoice") ? formError : undefined}>
              <Input
                id="saleInvoiceNo"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="e.g. CN00344701"
                className="uppercase placeholder:normal-case"
                aria-invalid={formError?.startsWith("Raigam invoice")}
              />
            </Field>
            <Field label="Rep" htmlFor="saleRep">
              <Input
                id="saleRep"
                list="rep-options"
                value={repName}
                onChange={(e) => {
                  setRepTouched(true);
                  setRepName(e.target.value);
                }}
                placeholder="Who took the order"
              />
              <datalist id="rep-options">
                {reps.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            {/* Set when the bill is marked Actual / delivered: delivery date + the store's credit days */}
            {delivered ? (
              <Field label="End Date" htmlFor="dueDate" required hint={`Delivered ${formatDate(sale?.deliveredDate ?? "")} · ${creditDays} days to pay`}>
                <Input
                  id="dueDate"
                  type="date"
                  min={date}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-invalid={formError?.includes("end date")}
                />
              </Field>
            ) : (
              <Field label="End Date" hint="Set when you mark it Actual">
                <ReadOnlyValue className="text-slate-600">
                  {creditDays} day{creditDays === 1 ? "" : "s"} after delivery
                </ReadOnlyValue>
              </Field>
            )}
            <Field label="Note" htmlFor="saleNotes" className="sm:col-span-2 lg:col-span-4">
              <Input id="saleNotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, printed on the bill, e.g. deliver before noon" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Items
                {soldLines.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums">{soldLines.length}</span>
                )}
              </span>
            }
            description={
              stockOut
                ? "These items are already out of stock (loaded). Changing them adjusts the stock."
                : "Stock (qty + free) is taken out when the bill is loaded on the lorry."
            }
          />

          <div
            id="saleDraftPanel"
            onKeyDown={onPanelKeyDown}
            className={cn("scroll-mt-20 border-b border-slate-200 px-5 py-4", editingKey ? "bg-amber-50/60" : "bg-slate-50/70")}
          >
            {editingKey && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-amber-900">Editing item {editingIndex + 1}</p>
                <button type="button" onClick={cancelEdit} className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
                  Cancel edit
                </button>
              </div>
            )}
            {/* One row on a wide screen: item, qty, price, discount, value, add; its free issue below */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_6rem_6rem_7.5rem_5.5rem_8.5rem_auto] lg:items-start">
              <Field
                label="Item"
                htmlFor="saleDraftItem"
                required
                error={draftErrors.stockKey}
                className="col-span-2 sm:col-span-4 lg:col-span-1"
                hint={draftItem ? [`${formatQty(available.get(draft.stockKey) ?? 0)} in stock`, draftItem.packageDetails].filter(Boolean).join(" · ") : undefined}
              >
                <SearchSelect
                  id="saleDraftItem"
                  value={draftCode}
                  onChange={pickDraftItem}
                  options={itemOptions.map((o) => ({
                    ...o,
                    disabled: o.value !== draftCode && lines.some((l) => splitKey(l.stockKey).sapCode === o.value && l.key !== draft.key),
                  }))}
                  placeholder="Search item code or name…"
                  showDescription
                  aria-invalid={!!draftErrors.stockKey}
                />
              </Field>
              {/* Booked − taken off = qty (as on Raigam's bill) */}
              <Field
                label="Taken off"
                htmlFor="saleDraftTakenOff"
                hint={draft.takenOff && isWhole(draft.qty) ? `Booked ${formatQty(toNumber(draft.qty) + draft.takenOff)}` : "As on Raigam"}
              >
                <Input
                  id="saleDraftTakenOff"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.takenOff ? String(draft.takenOff) : ""}
                  placeholder="0"
                  onChange={(e) => changeDraftTakenOff(e.target.value)}
                  className="text-right tabular-nums"
                />
              </Field>
              <Field label="Qty" htmlFor="saleDraftQty" required error={draftErrors.qty}>
                <Input
                  id="saleDraftQty"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.qty}
                  onChange={(e) => setDraftField({ qty: e.target.value })}
                  aria-invalid={!!draftErrors.qty}
                  className="text-right tabular-nums"
                />
              </Field>
              <Field
                label="Price (Rs.)"
                htmlFor="saleDraftPrice"
                required
                error={draftErrors.unitPrice}
                hint={
                  draftItem && draft.unitPrice !== "" && toNumber(draft.unitPrice) !== draftItem.wholesalePrice
                    ? `List ${formatMoney(draftItem.wholesalePrice)}`
                    : undefined
                }
              >
                <Input
                  id="saleDraftPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.unitPrice}
                  onChange={(e) => setDraftField({ unitPrice: e.target.value })}
                  aria-invalid={!!draftErrors.unitPrice}
                  className="text-right tabular-nums"
                />
              </Field>
              <Field label="Disc. %" htmlFor="saleDraftDiscount" error={draftErrors.discountPct}>
                <Input
                  id="saleDraftDiscount"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.discountPct}
                  onChange={(e) => setDraftField({ discountPct: e.target.value })}
                  aria-invalid={!!draftErrors.discountPct}
                  className="text-right tabular-nums"
                />
              </Field>
              <Field label="Value" className="col-span-2 lg:col-span-1">
                <ReadOnlyValue className="justify-end font-semibold text-slate-900 tabular-nums">{formatMoney(lineValue(priced(draft)))}</ReadOnlyValue>
              </Field>
              {/* pt = the label's height, so the buttons line up with the boxes */}
              <div className="col-span-2 flex gap-2 pt-[1.625rem] lg:col-span-1">
                <Button variant="outline" onClick={editingKey ? cancelEdit : clearDraft} className="flex-1 lg:flex-none">
                  {editingKey ? "Cancel" : "Clear"}
                </Button>
                <Button onClick={saveDraft} className="flex-1 lg:flex-none">
                  {editingKey ? (
                    <>
                      <Pencil /> Update
                    </>
                  ) : (
                    <>
                      <Plus /> Add item
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Its free issue: more of the same item, or another item given with it (saved as its own linked line) */}
            <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Free issue</span>
                <FilterTabs<FreeKind>
                  value={draftFreeKind}
                  onChange={(kind) => {
                    setDraftFreeKind(kind);
                    setDraftErrors((e) => ({ ...e, freeQty: undefined }));
                    focusField(kind === "other" ? "saleDraftOther" : "saleDraftFree");
                  }}
                  options={[
                    { value: "same", label: "Same item" },
                    { value: "other", label: "Another item" },
                  ]}
                />
              </div>
              {draftFreeKind === "other" && (
                <Field
                  label="Item given free"
                  htmlFor="saleDraftOther"
                  className="min-w-56 flex-1 sm:max-w-md"
                  hint={
                    draftOther
                      ? `${formatQty(available.get(stockKeyOf(draftOther, locationFor(draftOther))) ?? 0)} in stock`
                      : "e.g. Coffee 50g free with Coffee 100g"
                  }
                >
                  <SearchSelect
                    id="saleDraftOther"
                    value={draftOther}
                    onChange={(code) => {
                      setDraftOther(code);
                      setDraftErrors((e) => ({ ...e, freeQty: undefined }));
                      focusField("saleDraftFree");
                    }}
                    options={itemOptions.map((o) => ({
                      ...o,
                      // Not the item itself, nor one already on the bill (its own linked free item can stay)
                      disabled:
                        o.value === draftCode ||
                        lines.some(
                          (l) => splitKey(l.stockKey).sapCode === o.value && !(l.freeWith && l.freeWith === draftCode && isFreeLine(l)),
                        ),
                    }))}
                    placeholder="Pick the item…"
                    showDescription
                  />
                </Field>
              )}
              <Field label="Free Qty" htmlFor="saleDraftFree" error={draftErrors.freeQty} className="w-28">
                <Input
                  id="saleDraftFree"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.freeQty}
                  onChange={(e) => setDraftField({ freeQty: e.target.value })}
                  aria-invalid={!!draftErrors.freeQty}
                  className="text-right tabular-nums"
                />
              </Field>
              {draftFreeKind === "same" && (
                <p className="pb-2.5 text-xs text-slate-500">More {draftItem?.description ?? "of the same item"}, given free</p>
              )}
            </div>
          </div>

          <Table>
            <THead>
              <tr>
                <TH className="w-10">#</TH>
                <TH>Item</TH>
                <TH className="text-right">In Stock</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Free</TH>
                <TH className="text-right">Unit Price</TH>
                <TH className="text-right">Disc. %</TH>
                <TH className="text-right">Disc. Value</TH>
                {showMissing && <TH className="text-right">Reduced</TH>}
                {showCancel && <TH className="text-right">Cancelled</TH>}
                <TH className="text-right">Value</TH>
                <TH className="w-24">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {soldLines.length === 0 && <EmptyRow colSpan={10 + Number(showCancel) + Number(showMissing)}>No items yet. Add the first one above.</EmptyRow>}
              {soldLines.map((l, index) => {
                const { sapCode, locationNumber } = splitKey(l.stockKey);
                const item = itemMap.get(sapCode);
                const p = priced(l);
                const book = round2(chargedQty(p) * p.unitPrice);
                const short = unitsOut(l) > (available.get(l.stockKey) ?? 0);
                return (
                  <TR key={l.key} className={cn(l.key === editingKey && "bg-amber-50/70")}>
                    <TD className="text-slate-400 tabular-nums">{index + 1}</TD>
                    <TD className="whitespace-normal">
                      <span className="block font-medium text-slate-900">{item?.description ?? "Unknown item"}</span>
                      <span className="block font-mono text-xs text-slate-500">
                        {sapCode} · {locationNumber}
                      </span>
                      {l.takenOff > 0 && (
                        <span className="block text-xs font-medium text-red-600">
                          Booked {formatQty(toNumber(l.qty) + l.takenOff)} · {formatQty(l.takenOff)} taken off
                        </span>
                      )}
                      {(() => {
                        const given = linkedFree(lines, sapCode);
                        return given ? (
                          <span className="block text-xs text-emerald-700">
                            + {formatQty(toNumber(given.freeQty))} {itemMap.get(splitKey(given.stockKey).sapCode)?.description ?? "item"} free
                          </span>
                        ) : null;
                      })()}
                      <SavedLineNotes line={sale?.lines.find((x) => x.id === l.key)} />
                    </TD>
                    <TD className={cn("text-right tabular-nums", short ? "font-medium text-amber-700" : "text-slate-500")}>
                      {formatQty(available.get(l.stockKey) ?? 0)}
                    </TD>
                    <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(p.qty)}</TD>
                    <TD className="text-right tabular-nums">{toNumber(l.freeQty) ? formatQty(toNumber(l.freeQty)) : "—"}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(p.unitPrice)}</TD>
                    <TD className="text-right tabular-nums">{p.discountPct ? `${p.discountPct}%` : "—"}</TD>
                    <TD className="text-right tabular-nums">{p.discountPct ? formatMoney(round2(book - lineValue(p))) : "—"}</TD>
                    {showMissing && (
                      <TD className={cn("text-right tabular-nums", l.missingQty > 0 && "font-medium text-amber-700")}>
                        {l.missingQty ? formatQty(l.missingQty) : "—"}
                      </TD>
                    )}
                    {showCancel && <TD className="text-right tabular-nums">{l.cancelQty ? formatQty(l.cancelQty) : "—"}</TD>}
                    <TD className="text-right font-medium text-slate-900 tabular-nums">{formatMoney(lineValue(p))}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => editLine(l)} aria-label={`Edit item ${index + 1}`} title="Edit">
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-red-50 hover:text-red-600"
                          onClick={() => removeLine(l.key)}
                          aria-label={`Remove item ${index + 1}`}
                          title="Remove"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {!stockOut && shortLines.length > 0 && (
            <p className="flex items-center gap-2 border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">
              <AlertTriangle className="size-3.5 shrink-0" />
              Not enough stock right now for {shortLines.length} item{shortLines.length > 1 ? "s" : ""} (qty + free). You can save the bill, but it can
              only be loaded once stock is available.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Free issue items
                {freeLines.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums">{freeLines.length}</span>
                )}
              </span>
            }
            description="Other items given free with this bill, e.g. Coffee 50g free with Coffee 100g. Not charged (Raigam pays them back); taken from stock when the bill is loaded."
            actions={
              !showFree && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowFree(true);
                    focusField("saleFreeItem");
                  }}
                >
                  <Plus /> Add free issue item
                </Button>
              )
            }
          />
          {showFree && (
            <>
              <div onKeyDown={onFreeKeyDown} className={cn("bg-slate-50/70 px-5 py-4", freeLines.length > 0 && "border-b border-slate-200")}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_7rem_8.5rem_auto] lg:items-start">
                  <Field
                    label="Free item"
                    htmlFor="saleFreeItem"
                    required
                    className="col-span-2 sm:col-span-4 lg:col-span-1"
                    hint={
                      freeItem
                        ? [`${formatQty(available.get(freeDraft.stockKey) ?? 0)} in stock`, freeItem.packageDetails].filter(Boolean).join(" · ")
                        : undefined
                    }
                  >
                    <SearchSelect
                      id="saleFreeItem"
                      value={freeCode}
                      onChange={pickFreeItem}
                      options={itemOptions.map((o) => ({ ...o, disabled: o.value !== freeCode && lines.some((l) => splitKey(l.stockKey).sapCode === o.value) }))}
                      placeholder="Search item code or name…"
                      showDescription
                    />
                  </Field>
                  <Field label="Free Qty" htmlFor="saleFreeQty" required>
                    <Input
                      id="saleFreeQty"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={freeDraft.freeQty}
                      onChange={(e) => {
                        setFreeDraft((d) => ({ ...d, freeQty: e.target.value }));
                        setFreeError(undefined);
                      }}
                      className="text-right tabular-nums"
                    />
                  </Field>
                  <Field label="Free Value" hint="At the wholesale price">
                    <ReadOnlyValue className="justify-end tabular-nums">
                      {formatMoney(round2(toNumber(freeDraft.freeQty) * (freeItem?.wholesalePrice ?? 0)))}
                    </ReadOnlyValue>
                  </Field>
                  {/* pt = the label's height, so the buttons line up with the boxes */}
                  <div className="col-span-2 flex gap-2 pt-[1.625rem] lg:col-span-1">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setFreeDraft(emptyFree);
                        setFreeError(undefined);
                        focusField("saleFreeItem");
                      }}
                      className="flex-1 lg:flex-none"
                    >
                      Clear
                    </Button>
                    <Button onClick={addFreeItem} className="flex-1 lg:flex-none">
                      <Plus /> Add free item
                    </Button>
                  </div>
                </div>
                {freeError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{freeError}</p>}
              </div>
              {freeLines.length > 0 && (
                <Table>
                  <THead>
                    <tr>
                      <TH className="w-10">#</TH>
                      <TH>Item</TH>
                      <TH className="text-right">In Stock</TH>
                      <TH className="text-right">Free Qty</TH>
                      <TH className="text-right">Unit Price</TH>
                      {freeMissing && <TH className="text-right">Reduced</TH>}
                      <TH className="text-right">Free Value</TH>
                      <TH className="w-16">
                        <span className="sr-only">Actions</span>
                      </TH>
                    </tr>
                  </THead>
                  <TBody>
                    {freeLines.map((l, index) => {
                      const { sapCode, locationNumber } = splitKey(l.stockKey);
                      const item = itemMap.get(sapCode);
                      const short = unitsOut(l) > (available.get(l.stockKey) ?? 0);
                      return (
                        <TR key={l.key}>
                          <TD className="text-slate-400 tabular-nums">{index + 1}</TD>
                          <TD className="whitespace-normal">
                            <span className="block font-medium text-slate-900">{item?.description ?? "Unknown item"}</span>
                            <span className="block font-mono text-xs text-slate-500">
                              {sapCode} · {locationNumber}
                            </span>
                            {l.freeWith && (
                              <span className="block text-xs text-emerald-700">Free with {itemMap.get(l.freeWith)?.description ?? l.freeWith}</span>
                            )}
                            <SavedLineNotes line={sale?.lines.find((x) => x.id === l.key)} />
                          </TD>
                          <TD className={cn("text-right tabular-nums", short ? "font-medium text-amber-700" : "text-slate-500")}>
                            {formatQty(available.get(l.stockKey) ?? 0)}
                          </TD>
                          <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatQty(toNumber(l.freeQty))}</TD>
                          <TD className="text-right tabular-nums">{formatMoney(toNumber(l.unitPrice))}</TD>
                          {freeMissing && (
                            <TD className={cn("text-right tabular-nums", l.missingQty > 0 && "font-medium text-amber-700")}>
                              {l.missingQty ? formatQty(l.missingQty) : "—"}
                            </TD>
                          )}
                          <TD className="text-right tabular-nums">
                            {formatMoney(round2(Math.max(0, toNumber(l.freeQty) - l.missingQty) * toNumber(l.unitPrice)))}
                          </TD>
                          <TD>
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="hover:bg-red-50 hover:text-red-600"
                                onClick={() => removeLine(l.key)}
                                aria-label={`Remove free item ${index + 1}`}
                                title="Remove"
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Return items
                {returns.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums">{returns.length}</span>}
              </span>
            }
            description={
              delivered
                ? "Goods the store gave back, credited on this bill. They're kept in Return Items (not stock) to send back to Raigam."
                : "Good or market returns the store gives back, credited on this bill. Once delivered they're kept in Return Items (not stock) to send back to Raigam."
            }
            actions={
              !showReturns && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowReturns(true);
                    focusField("saleReturnItem");
                  }}
                >
                  <Plus /> Add return items
                </Button>
              )
            }
          />
          {showReturns && (
            <>
              <ReturnPanel
                wide
                idPrefix="saleReturn"
                returns={returns}
                draft={returnDraft}
                onChange={(next, draft) => {
                  setReturns(next);
                  setReturnDraft(draft);
                  setFormError(undefined);
                }}
                priceOf={returnPrice}
                editingKey={editingReturn}
                onEditEnd={() => setEditingReturn(null)}
                className={cn("bg-slate-50/70 p-5", editingReturn ? "bg-amber-50/60" : "", returns.length > 0 && "border-b border-slate-200")}
              />
              <ReturnTable
                returns={returns}
                editingKey={editingReturn}
                onEdit={(key) => {
                  // Load it into the box above; Update return puts it back in its place
                  setReturnDraft(returns.find((r) => r.key === key) ?? blankReturn());
                  setEditingReturn(key);
                  setFormError(undefined);
                  focusField("saleReturnQty");
                }}
                onRemove={(key) => {
                  setReturns((rs) => rs.filter((r) => r.key !== key));
                  if (key === editingReturn) {
                    setEditingReturn(null);
                    setReturnDraft(blankReturn());
                  }
                }}
              />
            </>
          )}
        </Card>

        <Card className="ml-auto w-full max-w-xl">
          <div className="flex flex-col gap-3 p-5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Items total</span>
              <span className="tabular-nums">{formatMoney(itemsTotal(bill))}</span>
            </div>
            {returns.length > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-500">Returns</span>
                  <span className="text-red-600 tabular-nums">− {formatMoney(returnsTotal(bill))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Gross value</span>
                  <span className="tabular-nums">{formatMoney(gross)}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="billDiscount" className="text-slate-500">
                Bill discount
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 tabular-nums">{discount ? `− ${formatMoney(discount)}` : ""}</span>
                <Input
                  id="billDiscount"
                  type="number"
                  min={0}
                  max={99.99}
                  step="0.01"
                  inputMode="decimal"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                  placeholder="0"
                  className="h-9 w-24 text-right tabular-nums"
                />
                <span className="text-slate-500">%</span>
              </div>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
              <span>Invoice value</span>
              <span className="tabular-nums">{formatMoney(total)}</span>
            </div>
            <div className="-mx-5 border-y border-slate-100 bg-slate-50/60 py-3">
              <div className="flex items-center justify-between gap-3 px-5">
                <div>
                  <p className="font-medium text-slate-900">{sale ? "Payments on this bill" : "Paid with the order"}</p>
                  <p className="text-xs text-slate-500">
                    {sale ? "Add or change payments on the bill's page." : "Cash or a cheque the store gives now. One bill can have several payments."}
                  </p>
                </div>
                {!sale && <AddPaymentButton onClick={() => setPayOpen(true)} disabled={leftToCollect <= 0.004} />}
              </div>
              <BillPaymentList
                rows={paidRows}
                onRemove={sale ? undefined : (key) => setPaidWithOrder((ps) => ps.filter((p) => p.key !== key))}
                className="mt-2"
              />
            </div>
            <div className="flex justify-between font-semibold text-slate-900">
              <span>{delivered ? "Cash balance" : "To collect after delivery"}</span>
              <span className={cn("tabular-nums", leftToCollect > 0 ? "text-red-600" : "text-emerald-700")}>{formatMoney(leftToCollect)}</span>
            </div>
            {shop && (
              <div className={cn("rounded-lg border px-3 py-2.5", overLimit ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50")}>
                <div className="flex justify-between">
                  <span className="text-slate-600">This bill</span>
                  <span className="tabular-nums">{formatMoney(total)}</span>
                </div>
                {!sale && paidTotal > 0 && (
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-slate-600">Paid with the order</span>
                    <span className="text-emerald-700 tabular-nums">− {formatMoney(paidTotal)}</span>
                  </div>
                )}
                <div className="mt-1.5 flex justify-between">
                  <span className="text-slate-600">{balanceBefore < 0 ? "Advance paid by the store" : "Old balance to collect"}</span>
                  <span className="tabular-nums">{formatMoney(balanceBefore)}</span>
                </div>
                <div
                  className={cn(
                    "mt-2 flex justify-between border-t pt-2 text-base font-semibold",
                    overLimit ? "border-red-200 text-red-700" : "border-slate-200 text-slate-900",
                  )}
                >
                  <span>Total with old balance</span>
                  <span className="tabular-nums">{formatMoney(balanceAfter)}</span>
                </div>
                {waiting.length > 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Not included: {waiting.length} other bill{waiting.length > 1 ? "s" : ""} for this store not delivered yet (
                    {formatMoney(waiting.reduce((sum, s) => sum + saleTotal(s), 0))}).
                  </p>
                )}
              </div>
            )}
            {!delivered && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
                The rest is collected after delivery, where you can also cancel items the store doesn&apos;t take and check the returns. Until delivery
                this bill doesn&apos;t add to the store&apos;s cash balance; money paid with the order counts as paid in advance.
              </p>
            )}
            {overLimit && shop && (
              <p className="flex items-start gap-2 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                This takes {shop.shopName} {formatMoney(balanceAfter - shop.creditLimit)} over its {formatMoney(shop.creditLimit)} credit limit. You can
                still save, but consider collecting cash.
              </p>
            )}
            {/* Next to the button, so it's seen on a phone too (the box it's about is marked red) */}
            {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
            <div className="mt-2 flex gap-2 sm:justify-end">
              <Link href={cancelHref} className={buttonClass("outline", "md", "flex-1 sm:flex-none")}>
                Cancel
              </Link>
              <Button type="submit" className="flex-1 sm:flex-none">
                {sale ? "Save changes" : "Create bill"}
              </Button>
            </div>
          </div>
        </Card>
      </form>
      {/* Dialogs sit outside the bill's <form>: a form inside a form would submit (and reload) the whole page */}
      <ShopFormDialog
        shop={null}
        defaultName={newStoreName ?? ""}
        open={newStoreName !== null}
        onClose={() => setNewStoreName(null)}
        onSaved={(id) => {
          changeShop(id);
          setFormError(undefined);
        }}
      />
      {!sale && (
        <BillPaymentDialog
          title="Add payment · new bill"
          description="Saved with the bill when you press Create bill."
          left={leftToCollect}
          balanceLabel="To collect after delivery"
          open={payOpen}
          onClose={() => setPayOpen(false)}
          onSave={(payment) => {
            setPaidWithOrder((ps) => [...ps, { ...payment, key: newId() }]);
            setFormError(undefined);
            return null;
          }}
        />
      )}
    </>
  );
}
