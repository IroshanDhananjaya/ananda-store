"use client";

import { AlertTriangle, PackageX, Truck } from "lucide-react";
import { Fragment, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, toNumber } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { StackBox } from "@/components/ui/table";
import { billDiscount, saleSubtotal, saleTotal } from "@/lib/ledger";
import { useAppStore, useItemMap, useShopMap } from "@/lib/store";
import type { Sale, SaleLine } from "@/lib/types";
import { cn, formatDate, formatMoney, formatQty, round2, todayISO } from "@/lib/utils";

/** Units a bill line puts on the lorry when nothing is missing */
const unitsOf = (l: SaleLine) => l.qty + l.freeQty;

/** One item + location on the loading sheet, across the ticked bills */
type SheetRow = {
  key: string;
  sapCode: string;
  locationNumber: string;
  /** Qty + free on the bills */
  need: number;
  /** Marked missing in the store */
  missing: number;
  /** Going on the lorry: need − missing */
  qty: number;
  /** Available in stock now */
  have: number;
  lines: { sale: Sale; line: SaleLine }[];
};

function LoadForm({ preselect, onDone }: { preselect: string[]; onDone: () => void }) {
  const sales = useAppStore((s) => s.sales);
  const routes = useAppStore((s) => s.routes);
  const stock = useAppStore((s) => s.stock);
  const loadSales = useAppStore((s) => s.loadSales);
  const shopMap = useShopMap();
  const itemMap = useItemMap();

  const waiting = useMemo(
    () => sales.filter((s) => s.status === "Ordered").sort((a, b) => a.date.localeCompare(b.date) || a.saleNo.localeCompare(b.saleNo)),
    [sales],
  );
  const routeOfSale = (id: string) => shopMap.get(sales.find((s) => s.id === id)?.shopId ?? "")?.routeId ?? "";

  // Start on the route of the preselected bill (if any)
  const [routeId, setRouteId] = useState(() => (preselect[0] ? routeOfSale(preselect[0]) : ""));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselect));
  const [date, setDate] = useState(todayISO);
  const [vehicle, setVehicle] = useState(() => routes.find((r) => r.id === routeId)?.vehicleNumber ?? "");
  const [vehicleTouched, setVehicleTouched] = useState(false);
  // Bill line id -> units not in the store, as typed (only lines on ticked bills count); starts with what's marked on the bill
  const [missing, setMissing] = useState<Record<string, string>>({});
  // Loading sheet items opened to mark missing units
  const [opened, setOpened] = useState<Set<string>>(() => new Set());

  const visible = waiting.filter((s) => !routeId || shopMap.get(s.shopId)?.routeId === routeId);
  const chosen = waiting.filter((s) => selected.has(s.id));

  const missingTyped = (l: SaleLine) => missing[l.id] ?? (l.missingQty ? String(l.missingQty) : "");
  const missingOk = (l: SaleLine) => {
    const v = missingTyped(l);
    return v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= unitsOf(l));
  };
  /** Units marked missing on a line (a number out of range counts as none until it's fixed) */
  const missingOf = (l: SaleLine) => (missingOk(l) ? toNumber(missingTyped(l)) : 0);
  /** A bill's invoice value once its missing items are taken off (`booked`: with nothing missing) */
  function totalAfterMissing(s: Sale, booked = false) {
    const lines = s.lines.map((l) => ({ ...l, missingQty: booked ? 0 : missingOf(l) }));
    const gross = saleSubtotal({ lines, returns: s.returns });
    return round2(gross - billDiscount(gross, s.discountPercent));
  }

  // Loading sheet: total quantity per item + location across the ticked bills
  const sheetMap = new Map<string, SheetRow>();
  for (const s of chosen) {
    // An item taken off the bill on Raigam (nothing left) isn't loaded
    for (const l of s.lines.filter((x) => unitsOf(x) > 0)) {
      const key = `${l.sapCode}|${l.locationNumber}`;
      const row = sheetMap.get(key) ?? { key, sapCode: l.sapCode, locationNumber: l.locationNumber, need: 0, missing: 0, qty: 0, have: 0, lines: [] };
      // Free issue goes on the lorry too
      row.need += unitsOf(l);
      row.missing += missingOf(l);
      row.lines.push({ sale: s, line: l });
      sheetMap.set(key, row);
    }
  }
  const sheet = [...sheetMap.values()]
    .map((r) => ({ ...r, qty: r.need - r.missing, have: stock.find((x) => x.sapCode === r.sapCode && x.locationNumber === r.locationNumber)?.availableQty ?? 0 }))
    .sort((a, b) => a.locationNumber.localeCompare(b.locationNumber) || a.sapCode.localeCompare(b.sapCode));
  const shortRows = sheet.filter((r) => r.have < r.qty);
  const missingUnits = sheet.reduce((n, r) => n + r.missing, 0);
  const missingItems = sheet.filter((r) => r.missing > 0).length;
  const missingValue = round2(chosen.reduce((sum, s) => sum + totalAfterMissing(s, true) - totalAfterMissing(s), 0));

  function changeRoute(id: string) {
    setRouteId(id);
    // Keep only bills on the chosen route
    setSelected((sel) => new Set([...sel].filter((x) => !id || routeOfSale(x) === id)));
    if (!vehicleTouched) setVehicle(routes.find((r) => r.id === id)?.vehicleNumber ?? "");
  }

  function toggle(id: string) {
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOpened(key: string) {
    setOpened((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Every unit of a sheet item missing (or none again) */
  function setAllMissing(row: SheetRow, all: boolean) {
    setMissing((m) => ({ ...m, ...Object.fromEntries(row.lines.map(({ line }) => [line.id, all ? String(unitsOf(line)) : ""])) }));
  }

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (chosen.length === 0) return void toast.error("Tick the bills to load.");
    const bad = chosen.flatMap((s) => s.lines.filter((l) => !missingOk(l)).map((l) => ({ sale: s, line: l })))[0];
    if (bad)
      return void toast.error(
        `Reduce for ${itemMap.get(bad.line.sapCode)?.description ?? bad.line.sapCode} on ${bad.sale.saleNo} must be a whole number from 0 to ${formatQty(unitsOf(bad.line))}.`,
      );
    if (shortRows.length) return void toast.error("Not enough stock for some items. Reduce them on the bills, untick bills or add stock first.");
    const result = await loadSales(
      chosen.map((s) => s.id),
      {
        date,
        vehicleNumber: vehicle,
        // Lines with missing units, and lines whose missing (marked on the bill) was cleared here
        missing: Object.fromEntries(
          chosen
            .flatMap((s) => s.lines)
            .filter((l) => missingOf(l) > 0 || l.missingQty > 0)
            .map((l) => [l.id, missingOf(l)]),
        ),
      },
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const units = sheet.reduce((n, r) => n + r.qty, 0);
    toast.success(
      `${chosen.length} bill${chosen.length > 1 ? "s" : ""} loaded${vehicle ? ` on ${vehicle.toUpperCase()}` : ""} · ${formatQty(units)} units taken from stock${
        missingUnits ? ` · ${formatQty(missingUnits)} reduced on the bills (− ${formatMoney(missingValue)})` : ""
      }`,
    );
    onDone();
  }

  return (
    <form id="load-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Route" htmlFor="loadRoute">
          <Select id="loadRoute" value={routeId} onChange={(e) => changeRoute(e.target.value)}>
            <option value="">All routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.routeCode} · {r.routeName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lorry (vehicle no.)" htmlFor="loadVehicle">
          <Input
            id="loadVehicle"
            list="vehicle-options"
            value={vehicle}
            onChange={(e) => {
              setVehicleTouched(true);
              setVehicle(e.target.value);
            }}
            className="uppercase"
            placeholder="WP LB-4521"
          />
          <datalist id="vehicle-options">
            {[...new Set(routes.map((r) => r.vehicleNumber).filter(Boolean))].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="Loading date" htmlFor="loadDate">
          <Input id="loadDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <StackBox>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((sel) => {
                        const next = new Set(sel);
                        for (const s of visible) {
                          if (allVisibleSelected) next.delete(s.id);
                          else next.add(s.id);
                        }
                        return next;
                      })
                    }
                    aria-label="Select all bills"
                  />
                </th>
                <th className="px-3 py-2">Bill</th>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    No bills waiting to load{routeId ? " on this route" : ""}.
                  </td>
                </tr>
              )}
              {visible.map((s) => {
                const shop = shopMap.get(s.shopId);
                const ticked = selected.has(s.id);
                const lost = ticked ? s.lines.reduce((n, l) => n + missingOf(l), 0) : s.lines.reduce((n, l) => n + l.missingQty, 0);
                const total = ticked ? totalAfterMissing(s) : saleTotal(s);
                const cut = round2(totalAfterMissing(s, true) - total);
                return (
                  <tr key={s.id} className={cn("cursor-pointer", ticked && "bg-brand-50/60")} onClick={() => toggle(s.id)}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={ticked}
                        onChange={() => toggle(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Load ${s.saleNo}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-slate-900">{s.saleNo}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDate(s.date)} · {s.repName || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {shop?.shopName ?? "Deleted store"}
                      <span className="block text-xs text-slate-500">{shop?.town}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatQty(s.lines.reduce((n, l) => n + unitsOf(l), 0) - lost)}
                      {lost > 0 && <span className="block text-xs font-medium text-amber-700">{formatQty(lost)} reduced</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(total)}
                      {cut > 0.004 && <span className="block text-xs font-medium text-red-600">− {formatMoney(cut)} reduced</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StackBox>
      </div>

      {sheet.length > 0 && (
        <div>
          <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-slate-700">
            <Truck className="size-4" /> Loading sheet: {chosen.length} bill{chosen.length > 1 ? "s" : ""}
            {missingItems > 0 && (
              <span className="font-normal text-amber-700">
                · {missingItems} item{missingItems > 1 ? "s" : ""} reduced, bills {formatMoney(missingValue)} less
              </span>
            )}
          </p>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <StackBox>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2 text-right">Load</th>
                    <th className="px-3 py-2 text-right">Stock now → after</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Reduce on bills</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sheet.map((r) => {
                    const short = r.have < r.qty;
                    // Open while the item is short (before missing is marked) or has missing units, or when asked for
                    const forced = r.have < r.need || r.missing > 0;
                    const showPanel = forced || opened.has(r.key);
                    const item = itemMap.get(r.sapCode);
                    return (
                      // The item, and under it the bills to mark missing
                      <Fragment key={r.key}>
                        <tr className={short ? "bg-red-50" : r.missing > 0 ? "bg-amber-50/60" : ""}>
                          <td className="px-3 py-2">
                            <span className="font-medium text-slate-900">{item?.description ?? r.sapCode}</span>
                            <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                          </td>
                          <td className="px-3 py-2">{r.locationNumber}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatQty(r.qty)}
                            {r.missing > 0 && (
                              <span className="block text-xs font-medium text-amber-700">
                                of {formatQty(r.need)} · {formatQty(r.missing)} reduced
                              </span>
                            )}
                          </td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", short ? "font-medium text-red-600" : "text-slate-600")}>
                            {formatQty(r.have)} → {short ? `short by ${formatQty(r.qty - r.have)}` : formatQty(r.have - r.qty)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!forced && (
                              <button
                                type="button"
                                onClick={() => toggleOpened(r.key)}
                                className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-slate-500 hover:text-amber-700"
                                aria-expanded={showPanel}
                              >
                                <PackageX className="size-3.5" /> {showPanel ? "Close" : "Reduce?"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {showPanel && (
                          <tr className={short ? "bg-red-50" : "bg-amber-50/60"}>
                            <td colSpan={5} className="px-3 pt-0 pb-3">
                              <div className="rounded-lg border border-amber-200 bg-white">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 px-3 py-2">
                                  <p className="text-xs text-amber-900">
                                    {r.have < r.need ? <span className="font-semibold">Only {formatQty(r.have)} in stock. </span> : null}
                                    How many to take off each bill? They aren&apos;t loaded and come off the bill (all of it = removed).
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setAllMissing(r, r.missing < r.need)}
                                    className="text-xs font-semibold whitespace-nowrap text-amber-800 hover:underline"
                                  >
                                    {r.missing < r.need ? "Remove from all" : "Put all back"}
                                  </button>
                                </div>
                                <ul className="divide-y divide-slate-100">
                                  {r.lines.map(({ sale, line }) => (
                                    <li key={line.id} className="flex items-center gap-3 px-3 py-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-slate-900">
                                          {sale.saleNo} · {shopMap.get(sale.shopId)?.shopName ?? "Deleted store"}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          {line.qty > 0 ? `Qty ${formatQty(line.qty)}` : "Free item"}
                                          {line.freeQty ? ` + ${formatQty(line.freeQty)} free` : ""}
                                          {line.qty > 0 ? ` · ${formatMoney(line.unitPrice)}` : ""}
                                        </p>
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-slate-500">
                                        Reduce by
                                        <Input
                                          type="number"
                                          min={0}
                                          max={unitsOf(line)}
                                          step={1}
                                          inputMode="numeric"
                                          value={missingTyped(line)}
                                          placeholder="0"
                                          onChange={(e) => setMissing((m) => ({ ...m, [line.id]: e.target.value }))}
                                          aria-invalid={!missingOk(line)}
                                          className="h-9 w-20 text-right tabular-nums"
                                          aria-label={`Reduce ${r.sapCode} on ${sale.saleNo} by`}
                                        />
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </StackBox>
          </div>
          {missingItems > 0 && (
            <p className="mt-2 text-xs text-slate-500">Reduced units come off the charged qty first, then the free issue.</p>
          )}
        </div>
      )}
      {shortRows.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" /> Not enough stock for {shortRows.length} item{shortRows.length > 1 ? "s" : ""}. Reduce it on
          the bills under the red item, untick a bill or add stock first.
        </p>
      )}
    </form>
  );
}

export function LoadLorryDialog({ open, onClose, preselect = [] }: { open: boolean; onClose: () => void; preselect?: string[] }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Load lorry"
      description="Tick the bills going on the lorry. Their items are taken out of stock now. Not enough in the store? Reduce it on the bills from the loading sheet."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="load-form">
            <Truck /> Mark loaded
          </Button>
        </>
      }
    >
      <LoadForm key={preselect.join(",")} preselect={preselect} onDone={onClose} />
    </Modal>
  );
}
