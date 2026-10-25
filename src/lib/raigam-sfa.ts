import "server-only";
import { onRaigamBill, raigamInvoiceNo, type RaigamBill, type RaigamLine } from "./raigam";
import { addDays, todayISO } from "./utils";

// Reads bills from Raigam's SFA system (www.raigamsfa.com) with the agency's own login, through the
// same API its website uses. It's Raigam's private API and may change without notice: anything
// unexpected comes back to the sync dialog as a RaigamError message.

const API = "https://raigam-sfa-api-gateway.purplesand-bdf733b9.southeastasia.azurecontainerapps.io/api/v1";
const REPORTS = "/reports/invoiceReport";
/** Stay well inside the hosting's 10-second limit per request */
const TIMEOUT_MS = 7000;
/** Bill details read at once */
const PARALLEL = 8;

export class RaigamError extends Error {}

type Session = { token: string; territoryId: number; until: number };
/** Kept while the server stays up, so each batch doesn't sign in again */
let session: Session | null = null;

async function send(path: string, init?: RequestInit) {
  try {
    return await fetch(API + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new RaigamError("Couldn't reach Raigam's system. Check the internet connection and try again.");
  }
}

async function signIn(): Promise<Session> {
  const userName = process.env.RAIGAM_SFA_USERNAME;
  const password = process.env.RAIGAM_SFA_PASSWORD;
  if (!userName || !password) {
    throw new RaigamError("The Raigam login isn't set up. Add RAIGAM_SFA_USERNAME and RAIGAM_SFA_PASSWORD to the server's settings.");
  }
  const res = await send("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, password }),
  });
  if (res.status >= 400 && res.status < 500) {
    throw new RaigamError("Raigam didn't accept the user name or password (RAIGAM_SFA_USERNAME / RAIGAM_SFA_PASSWORD).");
  }
  const p = res.ok ? (await res.json().catch(() => null))?.payload : null;
  if (!p?.token || !Number.isInteger(p.territoryId)) throw new RaigamError(`Raigam's login didn't work (${res.status}). Try again later.`);
  // The token lasts 14 days (accessTokenExpiry, in ms); sign in again a day before
  const lasts = Number(p.accessTokenExpiry) || 0;
  return { token: p.token, territoryId: p.territoryId, until: Date.now() + Math.max(0, lasts - 86_400_000) };
}

/** GET from Raigam's API; signs in first, and once more if the login has ended */
async function get(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  for (let attempt = 0; ; attempt++) {
    if (!session || Date.now() >= session.until) session = await signIn();
    const res = await send(`${path}${query ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (res.status === 401 && attempt === 0) {
      session = null;
      continue;
    }
    if (!res.ok) throw new RaigamError(`Raigam's system answered with an error (${res.status}). Try again later.`);
    const body = await res.json().catch(() => null);
    if (!body || !("payload" in body)) throw new RaigamError("Raigam's system answered in an unexpected way.");
    return body.payload;
  }
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const whole = (v: unknown) => Math.max(0, Math.round(num(v)));
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);

/**
 * Bills booked between two dates, without their items (readRaigamLines). Active bills come from
 * "BOOK" (by booked date); cancelled and late ones are looked up until today, as they may have
 * changed after the range, then kept to the booked dates.
 */
export async function listRaigamBills(from: string, to: string): Promise<RaigamBill[]> {
  if (!session || Date.now() >= session.until) session = await signIn();
  const base = { territoryId: session.territoryId, startDate: from, invoiceType: "" };
  const until = [to, addDays(todayISO(), 1)].sort().at(-1)!;
  const [booked, cancelled, late] = await Promise.all([
    get(`${REPORTS}/getAllInvoicesByStatus`, { ...base, endDate: to, invoiceStatus: "BOOK" }),
    get(`${REPORTS}/getAllInvoicesByStatus`, { ...base, endDate: until, invoiceStatus: "CANCEL" }),
    get(`${REPORTS}/getAllInvoicesByStatus`, { ...base, endDate: until, invoiceStatus: "LATE" }),
  ]);
  const cancelledIds = new Set(list(cancelled).map((i) => i.id));
  const lateIds = new Set(list(late).map((i) => i.id));

  const bills = new Map<number, RaigamBill>();
  for (const i of [...list(booked), ...list(cancelled), ...list(late)]) {
    const id = whole(i.id);
    const date = text(i.dateBook);
    if (!id || bills.has(id) || date < from || date > to) continue;
    bills.set(id, {
      id,
      invoiceNo: raigamInvoiceNo(text(i.invoiceNo)),
      date,
      outletId: whole(i.outletId),
      outletName: text(i.outletName),
      routeId: whole(i.routeId),
      routeName: text(i.routeName),
      cancelled: cancelledIds.has(i.id) || i.isActive === false,
      late: lateIds.has(i.id) || i.isLateDelivery === true,
      delivered: i.isActual === true,
      discountPct: num(i.discountPercentage),
      total: num(i.totalBookFinalValue),
    });
  }
  return [...bills.values()].filter((b) => b.invoiceNo && b.outletId && b.outletName);
}

/** Items on each bill, by bill id */
export async function readRaigamLines(ids: number[]): Promise<Record<number, RaigamLine[]>> {
  const lines: Record<number, RaigamLine[]> = {};
  for (let i = 0; i < ids.length; i += PARALLEL) {
    await Promise.all(
      ids.slice(i, i + PARALLEL).map(async (id) => {
        const bill = (await get(`${REPORTS}/findInvoiceWithDetailsByInvoiceId/${id}`)) as Record<string, unknown> | null;
        lines[id] = list(bill?.invoiceDetailDTOList)
          .filter((l) => l.isActive !== false && whole(l.itemId) > 0)
          .map((l) => ({
            itemId: whole(l.itemId),
            itemName: text(l.itemName),
            // Raigam keeps what was taken off a booked bill as its cancelled qty
            qty: Math.max(0, whole(l.totalBookQty) - whole(l.totalCancelQty)),
            freeQty: whole(l.totalFreeQty),
            unitPrice: num(l.sellUnitPrice),
            discountPct: num(l.bookDiscountPercentage),
            goodQty: whole(l.goodReturnTotalQty),
            goodPrice: num(l.goodReturnUnitPrice),
            marketQty: whole(l.marketReturnTotalQty),
            marketPrice: num(l.marketReturnUnitPrice),
            takenOff: Math.min(whole(l.totalCancelQty), whole(l.totalBookQty)),
          }))
          .filter(onRaigamBill);
      }),
    );
  }
  return lines;
}
