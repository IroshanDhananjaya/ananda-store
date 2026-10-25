"use server";

import { cookies } from "next/headers";
import { getDb } from "@/db";
import { applyAction, fetchData, type ActionResponse } from "@/db/repo";
import { ACTION_NAMES, fail, type ActionName, type Data } from "./core";
import { RAIGAM_ITEMS_BATCH, type RaigamBill, type RaigamLine } from "./raigam";
import { listRaigamBills, RaigamError, readRaigamLines } from "./raigam-sfa";
import { createSupabase } from "./supabase";
import type { Result } from "./types";
import { addDays, todayISO } from "./utils";

// The browser calls these; every check in core.ts runs here again on fresh data,
// so a stale screen can't oversell stock or overpay a bill.
// Each one checks the login first: anyone can call a server action, signed in or not.

/** Off unless ALLOW_DEMO_RESET=true: one click would wipe the real data */
const canResetDemo = () => process.env.ALLOW_DEMO_RESET === "true";

/** The browser goes to the login page when it gets this */
export type SignedOut = { signedOut: true };

async function supabase() {
  const store = await cookies();
  return createSupabase({
    getAll: () => store.getAll(),
    setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
  });
}

/** Email of the signed-in user, or null if no one is signed in (or the login has ended) */
async function signedInEmail(): Promise<string | null> {
  const { data } = await (await supabase()).auth.getClaims();
  return data ? (data.claims.email ?? "") : null;
}

/** `next`: signed in, the page to open (the login form loads it) */
export type SignInState = { error: string; next?: string };

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "invalid_credentials") return { error: "Wrong email or password." };
    if (error.code === "email_not_confirmed") return { error: "This email hasn't been confirmed in Supabase yet." };
    console.error("[signIn] failed:", error);
    return { error: "Couldn't sign in. Check the internet connection and try again." };
  }

  return { error: "", next: pathOnThisSite(String(form.get("next") ?? "")) };
}

/**
 * `next` if it's a page on this site, otherwise "/". Read the way the browser will read it:
 * "//other.site", "/\other.site" and "/<tab>/other.site" all lead to another site.
 */
function pathOnThisSite(next: string): string {
  const here = "http://this.site";
  try {
    const url = new URL(next, here);
    return next.startsWith("/") && url.origin === here ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

/** Signs out on this device only; anyone else using the same login stays signed in */
export async function signOut(): Promise<Result> {
  const { error } = await (await supabase()).auth.signOut({ scope: "local" });
  if (error) {
    console.error("[signOut] failed:", error);
    return fail("Couldn't sign out. Check the internet connection and try again.");
  }
  return { ok: true };
}

export async function fetchAllData(): Promise<{ data: Data; canResetDemo: boolean; userEmail: string } | SignedOut> {
  const userEmail = await signedInEmail();
  if (userEmail === null) return { signedOut: true };
  try {
    return { data: await fetchData(getDb()), canResetDemo: canResetDemo(), userEmail };
  } catch (error) {
    console.error("[fetchAllData] failed:", error instanceof Error ? error.stack : error);
    throw error;
  }
}

export async function runAction(name: ActionName, args: unknown[], today: string): Promise<ActionResponse & Partial<SignedOut>> {
  if ((await signedInEmail()) === null)
    return { result: fail("You have been signed out. Please sign in again."), changes: {}, signedOut: true };
  if (!ACTION_NAMES.includes(name) || !Array.isArray(args)) return { result: fail("Unknown action."), changes: {} };
  if (name === "resetDemoData" && !canResetDemo())
    return { result: fail("Reset demo data is turned off for this database."), changes: {} };
  // The user's local date; the server may be in another time zone
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : todayISO();
  try {
    return await applyAction(getDb(), name, args, day);
  } catch (error) {
    console.error(`[runAction] ${name} failed:`, error);
    return { result: fail("Couldn't save the change. Please try again."), changes: {} };
  }
}

// ---------- Sync from Raigam: reading only; saving goes through runAction("syncRaigamBills") ----------

/** Longest date range read at once */
const RAIGAM_MAX_DAYS = 92;

const isISODate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function raigamFailure(where: string, error: unknown) {
  if (error instanceof RaigamError) return { error: error.message };
  console.error(`[${where}] failed:`, error);
  return { error: "Couldn't read the bills from Raigam. Please try again." };
}

/** Bills booked on Raigam between two dates (without their items) */
export async function readRaigamBills(from: string, to: string): Promise<{ bills: RaigamBill[] } | { error: string } | SignedOut> {
  if ((await signedInEmail()) === null) return { signedOut: true };
  if (!isISODate(from) || !isISODate(to) || from > to) return { error: "Choose a From date on or before the To date." };
  if (addDays(from, RAIGAM_MAX_DAYS) < to) return { error: `Choose up to ${RAIGAM_MAX_DAYS} days at a time.` };
  try {
    return { bills: await listRaigamBills(from, to) };
  } catch (error) {
    return raigamFailure("readRaigamBills", error);
  }
}

/** Items on Raigam bills, by bill id */
export async function readRaigamItems(ids: number[]): Promise<{ lines: Record<number, RaigamLine[]> } | { error: string } | SignedOut> {
  if ((await signedInEmail()) === null) return { signedOut: true };
  if (!Array.isArray(ids) || ids.length > RAIGAM_ITEMS_BATCH || !ids.every((id) => Number.isInteger(id) && id > 0)) return { error: "Unknown bills." };
  try {
    return { lines: await readRaigamLines(ids) };
  } catch (error) {
    return raigamFailure("readRaigamItems", error);
  }
}
