"use client";

import { BellRing, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { CHEQUE_REMIND_DAYS, chequeReminders, cn, formatDate, formatMoney, RAIGAM_CHEQUE_DAYS, round2, todayISO, weekdayOf } from "@/lib/utils";
import { ChequeCountdown } from "./order-payment";

/** The day the reminder was hidden; it shows again the next day */
const HIDDEN_KEY = "cheque-reminder-hidden-on";

function hiddenToday() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === todayISO();
  } catch {
    return false;
  }
}

/**
 * On every page: our cheques to Raigam that are deposited within the next 5 days (21 days after
 * the goods came), or are past that date with no payment entered, so the money is in the bank in
 * time. Can be hidden for the rest of the day.
 */
export function ChequeReminder() {
  const orders = useAppStore((s) => s.orders);
  const [hidden, setHidden] = useState(hiddenToday);
  const due = chequeReminders(orders);
  if (hidden || due.length === 0) return null;

  const total = round2(due.reduce((sum, r) => sum + r.order.totalBillAmount, 0));
  // Red on the last day, or once the date has passed with nothing paid
  const urgent = due.some((r) => r.days <= 1);

  function hide() {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, todayISO());
    } catch {
      // Hidden until the page is reloaded
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        "mb-6 flex gap-3 rounded-xl border px-4 py-3 shadow-sm print:hidden",
        urgent ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      <BellRing className={cn("mt-0.5 size-5 shrink-0", urgent ? "text-red-600" : "text-amber-600")} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">
          {due.length === 1 ? "Cheque to Raigam" : `${due.length} cheques to Raigam`}: have {formatMoney(total)} in the bank
        </p>
        <ul className="mt-1 flex flex-col gap-1">
          {due.map(({ order, date }) => (
            <li key={order.id} className="flex flex-wrap items-baseline gap-x-2">
              <Link href={`/orders/${order.id}`} className="font-semibold underline-offset-2 hover:underline">
                {order.orderId}
              </Link>
              <span className="tabular-nums">{formatMoney(order.totalBillAmount)}</span>
              <span className="opacity-80">
                · {order.paymentMethod ? `cheque ${order.chequeNumber}` : "no cheque entered yet"} · deposit on {weekdayOf(date)} {formatDate(date)} ·
              </span>
              <ChequeCountdown order={order} />
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs opacity-80">
          Shown from {CHEQUE_REMIND_DAYS} days before Raigam deposits the cheque: {RAIGAM_CHEQUE_DAYS} days after the goods came, or the date on the cheque.
        </p>
      </div>
      <button
        type="button"
        onClick={hide}
        className="h-fit shrink-0 rounded-md p-1 opacity-70 hover:bg-black/5 hover:opacity-100"
        aria-label="Hide for today"
        title="Hide for today"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
