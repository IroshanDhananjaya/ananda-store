"use server";

import { getDb } from "@/db";
import { applyAction, fetchData, type ActionResponse } from "@/db/repo";
import { ACTION_NAMES, fail, type ActionName, type Data } from "./core";
import { todayISO } from "./utils";

// The browser calls these; every check in core.ts runs here again on fresh data,
// so a stale screen can't oversell stock or overpay a bill.
// No login yet: anyone who can open the app can call these. Add auth before
// putting the app on the internet.

/** Off unless ALLOW_DEMO_RESET=true: one click would wipe the real data */
const canResetDemo = () => process.env.ALLOW_DEMO_RESET === "true";

export async function fetchAllData(): Promise<{ data: Data; canResetDemo: boolean }> {
  try {
    return { data: await fetchData(getDb()), canResetDemo: canResetDemo() };
  } catch (error) {
    console.error("[fetchAllData] failed:", error instanceof Error ? error.stack : error);
    throw error;
  }
}

export async function runAction(name: ActionName, args: unknown[], today: string): Promise<ActionResponse> {
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
