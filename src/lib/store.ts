"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { fetchAllData, runAction } from "./actions";
import { ACTION_NAMES, emptyData, fail, type Actions, type Data } from "./core";
import { computeBalances, computeSaleDues } from "./ledger";
import type { Result } from "./types";
import { todayISO } from "./utils";

// Browser copy of the database. Pages read from it; every change goes to the
// server (runAction), which checks it, saves it in Supabase and sends back the
// tables it changed.

/** Same actions as core.ts, but they wait for the server */
type AsyncActions = { [K in keyof Actions]: (...args: Parameters<Actions[K]>) => Promise<Result> };

type Status = {
  /** True once the data has come from the server */
  loaded: boolean;
  /** Why loading failed, if it did */
  loadError: string;
  /** True while a change is being saved */
  saving: boolean;
  canResetDemo: boolean;
  /** Who is signed in */
  userEmail: string;
  /** Fetch everything again (on start, and when the user comes back to the tab) */
  reload: () => Promise<void>;
};

export type AppStore = Data & AsyncActions & Status;

/** The login has ended (signed out elsewhere, or removed in Supabase): sign in again, then come back here */
export function goToLogin() {
  const here = window.location.pathname + window.location.search;
  window.location.replace(here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`);
}

export const useAppStore = create<AppStore>()((set, get) => {
  const call =
    (name: keyof Actions) =>
    async (...args: unknown[]): Promise<Result> => {
      // A second click while saving would repeat the change (e.g. two receipts)
      if (get().saving) return fail("Still saving the last change. Please wait a moment.");
      set({ saving: true });
      try {
        const { result, changes, signedOut } = await runAction(name, args, todayISO());
        if (signedOut) goToLogin();
        set(changes);
        return result;
      } catch {
        return fail("Couldn't reach the server. Check the internet connection and try again.");
      } finally {
        set({ saving: false });
      }
    };

  return {
    ...emptyData(),
    ...(Object.fromEntries(ACTION_NAMES.map((name) => [name, call(name)])) as AsyncActions),
    loaded: false,
    loadError: "",
    saving: false,
    canResetDemo: false,
    userEmail: "",
    reload: async () => {
      try {
        const response = await fetchAllData();
        if ("signedOut" in response) return goToLogin();
        const { data, canResetDemo, userEmail } = response;
        set({ ...data, canResetDemo, userEmail, loaded: true, loadError: "" });
      } catch {
        set({ loadError: "Couldn't load the store data from the database." });
      }
    },
  };
});

/** SAP code -> Item lookup */
export function useItemMap() {
  const items = useAppStore((s) => s.items);
  return useMemo(() => new Map(items.map((i) => [i.sapCode, i])), [items]);
}

/** Order ID -> Order lookup */
export function useOrderMap() {
  const orders = useAppStore((s) => s.orders);
  return useMemo(() => new Map(orders.map((o) => [o.orderId, o])), [orders]);
}

/**
 * SAP code -> unit price on the latest Raigam invoice / order (order IDs count up).
 * New order lines start at this price, not the cost price: cost is net of the invoice discount,
 * which the order takes off again.
 */
export function useLastInvoicePrices() {
  const orderItems = useAppStore((s) => s.orderItems);
  return useMemo(() => {
    const latest = new Map<string, { orderId: string; price: number }>();
    for (const l of orderItems) {
      if (!(l.unitPrice > 0)) continue;
      const seen = latest.get(l.itemCode);
      if (!seen || l.orderId > seen.orderId) latest.set(l.itemCode, { orderId: l.orderId, price: l.unitPrice });
    }
    return new Map([...latest].map(([code, v]) => [code, v.price]));
  }, [orderItems]);
}

/** Route id -> Route lookup */
export function useRouteMap() {
  const routes = useAppStore((s) => s.routes);
  return useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
}

/** Store (shop) id -> Shop lookup */
export function useShopMap() {
  const shops = useAppStore((s) => s.shops);
  return useMemo(() => new Map(shops.map((s) => [s.id, s])), [shops]);
}

/** Sale id -> what has been paid and what is still to collect */
export function useSaleDues() {
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  return useMemo(() => computeSaleDues(sales, payments), [sales, payments]);
}

/** Store (shop) id -> cash balance summary */
export function useShopBalances() {
  const shops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  return useMemo(() => computeBalances(shops, sales, payments), [shops, sales, payments]);
}
