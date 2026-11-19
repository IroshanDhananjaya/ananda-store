"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { fetchAllData, runAction } from "./actions";
import { categoryRanks, itemPickOptions } from "./categories";
import { ACTION_NAMES, emptyData, fail, type Actions, type Data } from "./core";
import { computeBalances, computeSaleDues } from "./ledger";
import type { Result } from "./types";
import { lastInvoicePrices, todayISO } from "./utils";

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
        // No answer in 30 seconds: stop waiting, so the app isn't stuck on "Saving…" for good
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000));
        const { result, changes, signedOut } = await Promise.race([runAction(name, args, todayISO()), timeout]);
        if (signedOut) goToLogin();
        set(changes);
        return result;
      } catch (e) {
        if (e instanceof Error && e.message === "timeout")
          return fail("No answer from the server after 30 seconds. Check the internet, then reload the page to see whether it was saved before trying again.");
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

/** Item category -> its place in lists (Raigam's order sheet order; see categories.ts) */
export function useCategoryRanks() {
  const items = useAppStore((s) => s.items);
  return useMemo(() => categoryRanks(items), [items]);
}

/** Items to pick from, grouped under their categories */
export function useItemPickOptions() {
  const items = useAppStore((s) => s.items);
  return useMemo(() => itemPickOptions(items), [items]);
}

/** Order ID -> Order lookup */
export function useOrderMap() {
  const orders = useAppStore((s) => s.orders);
  return useMemo(() => new Map(orders.map((o) => [o.orderId, o])), [orders]);
}

/** SAP code -> unit price on the latest Raigam invoice / order (see lastInvoicePrices) */
export function useLastInvoicePrices() {
  const orderItems = useAppStore((s) => s.orderItems);
  return useMemo(() => lastInvoicePrices(orderItems), [orderItems]);
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
