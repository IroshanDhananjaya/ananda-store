"use client";

import { AlertTriangle, Truck } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { StackBox } from "@/components/ui/table";
import { saleTotal } from "@/lib/ledger";
import { useAppStore, useItemMap, useShopMap } from "@/lib/store";
import { cn, formatDate, formatMoney, formatQty, todayISO } from "@/lib/utils";

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

  const visible = waiting.filter((s) => !routeId || shopMap.get(s.shopId)?.routeId === routeId);
  const chosen = waiting.filter((s) => selected.has(s.id));

  // Loading sheet: total quantity per item + location across the selected bills
  const sheet = useMemo(() => {
    const map = new Map<string, { sapCode: string; locationNumber: string; qty: number }>();
    for (const s of chosen) {
      for (const l of s.lines) {
        const key = `${l.sapCode}|${l.locationNumber}`;
        const row = map.get(key) ?? { sapCode: l.sapCode, locationNumber: l.locationNumber, qty: 0 };
        // Free issue goes on the lorry too
        row.qty += l.qty + l.freeQty;
        map.set(key, row);
      }
    }
    return [...map.values()]
      .map((r) => ({ ...r, have: stock.find((x) => x.sapCode === r.sapCode && x.locationNumber === r.locationNumber)?.availableQty ?? 0 }))
      .sort((a, b) => a.locationNumber.localeCompare(b.locationNumber) || a.sapCode.localeCompare(b.sapCode));
  }, [chosen, stock]);
  const shortRows = sheet.filter((r) => r.have < r.qty);

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

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (chosen.length === 0) return void toast.error("Tick the bills to load.");
    if (shortRows.length) return void toast.error("Not enough stock for some items. Untick bills or add stock first.");
    const result = await loadSales(
      chosen.map((s) => s.id),
      { date, vehicleNumber: vehicle },
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const units = sheet.reduce((n, r) => n + r.qty, 0);
    toast.success(`${chosen.length} bill${chosen.length > 1 ? "s" : ""} loaded${vehicle ? ` on ${vehicle.toUpperCase()}` : ""} · ${formatQty(units)} units taken from stock`);
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
                return (
                  <tr key={s.id} className={cn("cursor-pointer", selected.has(s.id) && "bg-brand-50/60")} onClick={() => toggle(s.id)}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={selected.has(s.id)}
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
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(s.lines.reduce((n, l) => n + l.qty + l.freeQty, 0))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(saleTotal(s))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StackBox>
      </div>

      {sheet.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Truck className="size-4" /> Loading sheet: {chosen.length} bill{chosen.length > 1 ? "s" : ""}
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sheet.map((r) => {
                    const short = r.have < r.qty;
                    return (
                      <tr key={`${r.sapCode}|${r.locationNumber}`} className={short ? "bg-red-50" : ""}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-slate-900">{itemMap.get(r.sapCode)?.description ?? r.sapCode}</span>
                          <span className="block font-mono text-xs text-slate-500">{r.sapCode}</span>
                        </td>
                        <td className="px-3 py-2">{r.locationNumber}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatQty(r.qty)}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", short ? "font-medium text-red-600" : "text-slate-600")}>
                          {formatQty(r.have)} → {short ? `short by ${formatQty(r.qty - r.have)}` : formatQty(r.have - r.qty)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </StackBox>
          </div>
        </div>
      )}
      {shortRows.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" /> Not enough stock for {shortRows.length} item{shortRows.length > 1 ? "s" : ""}. Untick a
          bill or add stock first.
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
      description="Tick the bills going on the lorry. Their items are taken out of stock now."
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
