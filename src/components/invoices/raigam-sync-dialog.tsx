"use client";

import { AlertTriangle, CloudDownload, Loader2, Store } from "lucide-react";
import { useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { SearchSelect, type SearchOption } from "@/components/ui/search-select";
import { StackBox } from "@/components/ui/table";
import { readRaigamBills, readRaigamItems } from "@/lib/actions";
import { wholesaleDifference } from "@/lib/ledger";
import {
  billsNeedingItems,
  planRaigamSync,
  RAIGAM_ITEMS_BATCH,
  suggestItem,
  type ItemPicks,
  type RaigamBill,
  type RaigamLine,
  type SyncAction,
  type SyncData,
  type SyncPlan,
  type SyncRow,
} from "@/lib/raigam";
import { goToLogin, useAppStore } from "@/lib/store";
import type { Item } from "@/lib/types";
import { cn, formatDate, formatMoney, formatQty } from "@/lib/utils";

type Step = "dates" | "reading" | "review" | "saving";
/** Bill list tabs, by what happens to the bill */
type Tab = "add" | "update" | "problem" | "rest";

const TAB_OF: Record<SyncAction, Tab> = { add: "add", update: "update", problem: "problem", same: "rest", kept: "rest", ignore: "rest" };
/** Rows listed at most (the counts cover them all) */
const MAX_ROWS = 300;
/** New store names listed before "and N more" */
const MAX_STORE_NAMES = 20;

const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;

function countByTab(plan: SyncPlan) {
  const counts: Record<Tab, number> = { add: 0, update: 0, problem: 0, rest: 0 };
  for (const r of plan.rows) counts[TAB_OF[r.action]]++;
  return counts;
}

/** Raigam items not matched before whose names are the same as an item here (the rest are picked by hand) */
function sureMatches(bills: RaigamBill[], data: SyncData): ItemPicks {
  const linked = new Set(data.raigamLinks.filter((l) => l.kind === "Item").map((l) => l.raigamId));
  const seen = new Set<number>();
  const picks: ItemPicks = {};
  for (const l of bills.flatMap((b) => b.lines ?? [])) {
    if (linked.has(l.itemId) || seen.has(l.itemId)) continue;
    seen.add(l.itemId);
    const match = suggestItem(l.itemName, data.items);
    if (match?.sure) picks[l.itemId] = match.sapCode;
  }
  return picks;
}

function useSyncData(): SyncData {
  const items = useAppStore((s) => s.items);
  const stock = useAppStore((s) => s.stock);
  const locations = useAppStore((s) => s.locations);
  const routes = useAppStore((s) => s.routes);
  const shops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const raigamLinks = useAppStore((s) => s.raigamLinks);
  return useMemo(() => ({ items, stock, locations, routes, shops, sales, raigamLinks }), [items, stock, locations, routes, shops, sales, raigamLinks]);
}

/**
 * Sync from Raigam: reads the bills booked on Raigam's SFA system for a date range, shows what
 * would change here (src/lib/raigam.ts), and saves it once confirmed.
 */
export function RaigamSyncDialog({ from, to, onClose }: { from: string; to: string; onClose: () => void }) {
  const data = useSyncData();
  const syncRaigamBills = useAppStore((s) => s.syncRaigamBills);
  const [step, setStep] = useState<Step>("dates");
  const [range, setRange] = useState({ from, to });
  const [progress, setProgress] = useState("");
  const [bills, setBills] = useState<RaigamBill[]>([]);
  const [picks, setPicks] = useState<ItemPicks>({});
  const [tab, setTab] = useState<Tab>("add");
  /** What the last save couldn't do */
  const [notes, setNotes] = useState<string[]>([]);

  const plan = useMemo(() => planRaigamSync(data, bills, picks), [data, bills, picks]);
  const counts = countByTab(plan);
  const toSave = counts.add + counts.update;

  async function check(e: FormEvent) {
    e.preventDefault();
    if (!range.from || !range.to || range.from > range.to) return void toast.error("Choose a From date on or before the To date.");
    const back = (error: string) => {
      toast.error(error);
      setStep("dates");
    };
    setNotes([]);
    setStep("reading");
    setProgress("Signing in to Raigam…");
    try {
      const listed = await readRaigamBills(range.from, range.to);
      if ("signedOut" in listed) return goToLogin();
      if ("error" in listed) return back(listed.error);
      // Items are only read for bills that may be added or changed
      const ids = billsNeedingItems(useAppStore.getState().sales, listed.bills);
      const lines: Record<number, RaigamLine[]> = {};
      for (let i = 0; i < ids.length; i += RAIGAM_ITEMS_BATCH) {
        setProgress(`Reading the items on ${plural(ids.length, "bill")}… ${Math.round((i / ids.length) * 100)}%`);
        const read = await readRaigamItems(ids.slice(i, i + RAIGAM_ITEMS_BATCH));
        if ("signedOut" in read) return goToLogin();
        if ("error" in read) return back(read.error);
        Object.assign(lines, read.lines);
      }
      const full = listed.bills
        .map((b) => (lines[b.id] ? { ...b, lines: lines[b.id] } : b))
        .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo));
      const state = useAppStore.getState();
      const firstPicks = sureMatches(full, state);
      const first = countByTab(planRaigamSync(state, full, firstPicks));
      setBills(full);
      setPicks(firstPicks);
      setTab((["add", "update", "problem"] as const).find((t) => first[t] > 0) ?? "rest");
      setStep("review");
    } catch {
      back("Couldn't reach the server. Check the internet connection and try again.");
    }
  }

  async function save() {
    const before = { ...counts, shops: data.shops.length };
    setStep("saving");
    // Bills already here go first: they show which store an outlet is before new bills need it
    const order = [...plan.rows].sort((a, b) => Number(!a.sale) - Number(!b.sale)).map((r) => r.bill);
    const left: string[] = [];
    for (let i = 0; i < order.length; i += RAIGAM_ITEMS_BATCH) {
      setProgress(`Saving… ${Math.round((i / order.length) * 100)}%`);
      const result = await syncRaigamBills(order.slice(i, i + RAIGAM_ITEMS_BATCH), picks);
      if (!result.ok) {
        left.push(result.error);
        break;
      }
      left.push(...(result.notes ?? []));
    }
    // What's still to do is what didn't save
    const now = useAppStore.getState();
    const after = countByTab(planRaigamSync(now, bills, picks));
    const done = [
      before.add > after.add && `${plural(before.add - after.add, "new bill")} added`,
      before.update > after.update && `${plural(before.update - after.update, "bill")} updated`,
      now.shops.length > before.shops && plural(now.shops.length - before.shops, "new store"),
    ].filter(Boolean);
    if (done.length) toast.success(`From Raigam: ${done.join(" · ")}`);
    if (left.length) {
      setNotes(left);
      setStep("review");
    } else {
      onClose();
    }
  }

  const busy = step === "reading" || step === "saving";
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      size="lg"
      title="Sync from Raigam"
      description={
        step === "review"
          ? `${plural(bills.length, "bill")} on Raigam booked ${range.from === range.to ? `on ${formatDate(range.from)}` : `${formatDate(range.from)} – ${formatDate(range.to)}`}`
          : "Bring in the bills your reps booked on Raigam's system."
      }
      footer={
        step === "dates" ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="raigam-dates">
              <CloudDownload /> Check Raigam
            </Button>
          </>
        ) : step === "review" ? (
          <>
            <Button variant="outline" onClick={() => setStep("dates")}>
              Change dates
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={save} disabled={toSave === 0}>
              {toSave ? `Save ${plural(toSave, "bill")}` : "Nothing to save"}
            </Button>
          </>
        ) : undefined
      }
    >
      {step === "dates" && (
        <form id="raigam-dates" onSubmit={check} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            New bills are added, and bills already here that changed on Raigam (and aren&apos;t delivered yet) are updated. You&apos;ll see
            everything before it&apos;s saved.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Booked from" htmlFor="syncFrom">
              <Input id="syncFrom" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </Field>
            <Field label="To" htmlFor="syncTo">
              <Input id="syncTo" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </Field>
          </div>
        </form>
      )}

      {busy && (
        <div className="flex flex-col items-center gap-3 py-12 text-sm text-slate-600" role="status">
          <Loader2 className="size-6 animate-spin text-brand-600" />
          {progress}
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          {notes.length > 0 && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4 shrink-0" /> Some of it couldn&apos;t be saved
              </p>
              <ul className="mt-1 list-disc pl-6 text-xs">
                {notes.slice(0, 10).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
                {notes.length > 10 && <li>and {formatQty(notes.length - 10)} more</li>}
              </ul>
            </div>
          )}
          <RaigamTotals bills={bills} />
          <ItemMatching bills={bills} data={data} picks={picks} onPick={(itemId, sapCode) => setPicks((p) => ({ ...p, [itemId]: sapCode }))} />
          <NewStores plan={plan} />
          <div className="flex flex-col gap-2">
            <FilterTabs<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "add", label: "New", count: counts.add },
                { value: "update", label: "Changed", count: counts.update },
                { value: "problem", label: "Can't save yet", count: counts.problem },
                { value: "rest", label: "Nothing to do", count: counts.rest },
              ]}
            />
            <BillRows rows={plan.rows.filter((r) => TAB_OF[r.action] === tab)} plan={plan} data={data} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Invoice count and value per tab of Raigam's invoice page, to compare with it (and with Daily Invoices once saved) */
function RaigamTotals({ bills }: { bills: RaigamBill[] }) {
  const tabs = [
    { label: "Booking", bills: bills.filter((b) => !b.cancelled && !b.delivered && !b.late) },
    { label: "Actual", bills: bills.filter((b) => !b.cancelled && b.delivered) },
    { label: "Late delivery", bills: bills.filter((b) => !b.cancelled && !b.delivered && b.late) },
    { label: "Cancelled", bills: bills.filter((b) => b.cancelled) },
  ];
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">On Raigam for these dates</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tabs.map((t) => (
          <div key={t.label} className={cn("rounded-lg border border-slate-200 px-3 py-2", t.bills.length === 0 && "opacity-60")}>
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className="text-lg font-semibold text-slate-900 tabular-nums">{formatQty(t.bills.length)}</p>
            <p className="text-xs text-slate-600 tabular-nums">{formatMoney(t.bills.reduce((sum, b) => sum + b.total, 0))}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Raigam items on the bills and the items here they stand for: new ones to match, and (on request) the ones matched before */
function ItemMatching({
  bills,
  data,
  picks,
  onPick,
}: {
  bills: RaigamBill[];
  data: SyncData;
  picks: ItemPicks;
  onPick: (itemId: number, sapCode: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const itemMap = useMemo(() => new Map(data.items.map((i) => [i.sapCode, i])), [data.items]);
  const linked = useMemo(
    () => new Map(data.raigamLinks.filter((l) => l.kind === "Item" && itemMap.has(l.appId)).map((l) => [l.raigamId, l.appId])),
    [data.raigamLinks, itemMap],
  );
  const raigamItems = useMemo(() => {
    // Raigam's price for each item: the one on most of these bills
    const map = new Map<number, { itemId: number; itemName: string; bills: number; prices: Map<number, number> }>();
    for (const b of bills) {
      for (const l of new Map((b.lines ?? []).map((x) => [x.itemId, x])).values()) {
        const entry = map.get(l.itemId) ?? { itemId: l.itemId, itemName: l.itemName, bills: 0, prices: new Map() };
        entry.bills++;
        if (l.unitPrice > 0) entry.prices.set(l.unitPrice, (entry.prices.get(l.unitPrice) ?? 0) + 1);
        map.set(l.itemId, entry);
      }
    }
    return [...map.values()]
      .map(({ prices, ...i }) => ({ ...i, price: [...prices].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0 }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [bills]);
  // Matching goes by name, so the name leads and the SAP code is underneath; pack size and wholesale price help tell items apart
  const options = useMemo<SearchOption[]>(
    () =>
      data.items.map((i) => ({
        value: i.sapCode,
        label: i.description,
        description: i.sapCode,
        hint: [i.packageDetails, i.wholesalePrice > 0 ? formatMoney(i.wholesalePrice) : ""].filter(Boolean).join(" · "),
      })),
    [data.items],
  );

  if (raigamItems.length === 0) return null;
  const matchOf = (id: number) => (picks[id] && itemMap.has(picks[id]) ? picks[id] : (linked.get(id) ?? ""));
  const fresh = raigamItems.filter((i) => !linked.has(i.itemId));
  const unmatched = fresh.filter((i) => !matchOf(i.itemId)).length;
  const shown = showAll ? raigamItems : fresh;

  return (
    <section className={cn("rounded-lg border p-3", unmatched ? "border-amber-300 bg-amber-50/50" : "border-slate-200")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {fresh.length ? "Match Raigam's items to yours" : "Items"}
            {unmatched > 0 && <span className="ml-2 font-normal text-amber-800">{formatQty(unmatched)} to match</span>}
          </h3>
          <p className="text-xs text-slate-500">
            {fresh.length
              ? "Only needed once: the app remembers each match. A bill with an unmatched item waits for the next sync."
              : `All ${formatQty(raigamItems.length)} items on these bills were matched before.`}
          </p>
        </div>
        <button type="button" onClick={() => setShowAll((v) => !v)} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">
          {showAll ? "Show only new items" : `Check all ${formatQty(raigamItems.length)} matches`}
        </button>
      </div>
      {shown.length > 0 && (
        <div className="mt-2 divide-y divide-slate-200/70">
          {shown.map((i) => (
            <ItemMatchRow
              key={i.itemId}
              item={i}
              value={matchOf(i.itemId)}
              options={options}
              items={data.items}
              onPick={(sapCode) => onPick(i.itemId, sapCode)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ItemMatchRow({
  item,
  value,
  options,
  items,
  onPick,
}: {
  item: { itemName: string; bills: number; price: number };
  value: string;
  options: SearchOption[];
  items: Item[];
  onPick: (sapCode: string) => void;
}) {
  // Nothing picked yet: offer the closest name (never picked for you unless the names are the same)
  const suggestion = useMemo(() => {
    const match = value ? null : suggestItem(item.itemName, items);
    return match && items.find((i) => i.sapCode === match.sapCode);
  }, [value, item.itemName, items]);
  const picked = value ? items.find((i) => i.sapCode === value) : undefined;
  const priceDiff = picked && item.price > 0 ? wholesaleDifference(item.price, picked.wholesalePrice) : 0;

  return (
    <div className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center sm:gap-3">
      <div className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{item.itemName}</span>
        <span className="text-xs text-slate-500">
          On Raigam · {plural(item.bills, "bill")}
          {item.price > 0 && ` · ${formatMoney(item.price)}`}
        </span>
        {picked && picked.wholesalePrice > 0 && (
          <span className={cn("block text-xs", priceDiff ? "font-medium text-amber-700" : "text-emerald-700")}>
            Your wholesale {formatMoney(picked.wholesalePrice)}
            {priceDiff ? ` · Raigam ${priceDiff > 0 ? "+" : "−"} ${formatMoney(Math.abs(priceDiff))}` : " · same as Raigam"}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <SearchSelect
          value={value}
          onChange={onPick}
          options={options}
          placeholder="Pick your item…"
          showDescription
          aria-label={`Your item for ${item.itemName}`}
          aria-invalid={!value}
        />
        {suggestion && (
          <button type="button" onClick={() => onPick(suggestion.sapCode)} className="mt-1 text-left text-xs text-brand-700 hover:underline">
            Use {suggestion.description} · {suggestion.sapCode}?
          </button>
        )}
      </div>
    </div>
  );
}

/** Stores (and routes) the sync adds, with just their names */
function NewStores({ plan }: { plan: SyncPlan }) {
  const outlets = new Set(plan.rows.filter((r) => r.action === "add" || r.action === "update").map((r) => r.bill.outletId));
  const stores = [...plan.stores].flatMap(([id, ref]) => ("name" in ref && outlets.has(id) ? [ref] : []));
  if (stores.length === 0) return null;
  const routes = [...new Set(stores.filter((s) => !s.routeId).map((s) => s.routeName))];

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Store className="size-4 text-brand-600" /> {plural(stores.length, "new store")}
        {routes.length > 0 && ` and ${plural(routes.length, "new route")}`}
      </h3>
      <p className="text-xs text-slate-500">Added with just the name from Raigam. Fill in the owner, phone and credit days on the Stores page later.</p>
      <p className="mt-2 text-sm text-slate-700">
        {stores
          .slice(0, MAX_STORE_NAMES)
          .map((s) => s.name)
          .join(", ")}
        {stores.length > MAX_STORE_NAMES && ` and ${formatQty(stores.length - MAX_STORE_NAMES)} more`}
      </p>
      {routes.length > 0 && <p className="mt-1 text-xs text-slate-500">New routes: {routes.join(", ")}</p>}
    </section>
  );
}

type Tone = ComponentProps<typeof Badge>["tone"];

function rowBadge(r: SyncRow): { tone: Tone; label: string } {
  if (r.cancel) return { tone: "red", label: "Cancel here" };
  const badges: Record<SyncAction, { tone: Tone; label: string }> = {
    add: { tone: "green", label: "Add" },
    update: { tone: "blue", label: "Update" },
    problem: { tone: "amber", label: "Can't save yet" },
    same: { tone: "slate", label: "Up to date" },
    kept: { tone: "slate", label: "Left as it is" },
    ignore: { tone: "slate", label: "Not added" },
  };
  return badges[r.action];
}

function BillRows({ rows, plan, data }: { rows: SyncRow[]; plan: SyncPlan; data: SyncData }) {
  const shopName = useMemo(() => new Map(data.shops.map((s) => [s.id, s.shopName])), [data.shops]);
  if (rows.length === 0) return <p className="rounded-lg border border-slate-200 px-3 py-8 text-center text-sm text-slate-500">No bills here.</p>;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <StackBox>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Store</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">What happens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, MAX_ROWS).map((r) => {
              const ref = plan.stores.get(r.bill.outletId);
              const badge = rowBadge(r);
              return (
                <tr key={r.bill.id} className="align-top">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">{r.bill.invoiceNo}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDate(r.bill.date)}
                      {r.sale && ` · ${r.sale.saleNo}`}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-slate-900">{(ref?.shopId && shopName.get(ref.shopId)) || r.bill.outletName}</span>
                    {ref && "name" in ref && (
                      <Badge tone="blue" className="ml-1.5">
                        New store
                      </Badge>
                    )}
                    <span className="block text-xs text-slate-500">{r.bill.routeName}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(r.bill.total)}
                    {r.differentTotal !== undefined && (
                      <span className="block text-xs text-amber-700" title="Our total for this bill isn't the same as Raigam's">
                        Here {formatMoney(r.differentTotal)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-normal">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    <span className="mt-0.5 block text-xs text-slate-500">{r.note}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StackBox>
      {rows.length > MAX_ROWS && (
        <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Showing the first {formatQty(MAX_ROWS)} of {formatQty(rows.length)}.
        </p>
      )}
    </div>
  );
}
