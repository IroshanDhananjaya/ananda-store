import type { ReactNode } from "react";
import type { BillStatus, LineStatus, OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tone = "green" | "amber" | "red" | "blue" | "slate";

const tones: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const dots: Record<Tone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-sky-500",
  slate: "bg-slate-400",
};

export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dots[tone])} aria-hidden />
      {children}
    </span>
  );
}

type OrderStep = BillStatus | "Ordered" | "Loaded" | "Cancelled";
const billTone: Record<OrderStep, Tone> = { Ordered: "slate", Loaded: "blue", Paid: "green", "Part paid": "amber", Unpaid: "red", Cancelled: "slate" };
const billLabel: Record<OrderStep, string> = {
  Ordered: "To load",
  Loaded: "On lorry",
  Paid: "Paid",
  "Part paid": "Part paid",
  Unpaid: "Unpaid",
  Cancelled: "Cancelled",
};

/**
 * Store order status: To load → On lorry → (delivered) Unpaid / Part paid / Paid, or Cancelled.
 * `late` adds a "Late" tag while a late bill is still waiting to be delivered.
 */
export function BillStatusBadge({ status, late = false }: { status: OrderStep; late?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={billTone[status]} className={status === "Cancelled" ? "line-through" : undefined}>
        {billLabel[status]}
      </Badge>
      {late && (status === "Ordered" || status === "Loaded") && <Badge tone="amber">Late</Badge>}
    </span>
  );
}

/** End date for collecting a bill's balance, with overdue / days-left hint */
export function DueDateLabel({ dueDate, due, overdueDays }: { dueDate: string; due: number; overdueDays: number }) {
  if (!dueDate) return <span className="text-slate-400">—</span>;
  const [y, m, d] = dueDate.split("-");
  const label = `${d}/${m}/${y}`;
  if (due <= 0) return <span className="text-slate-500 tabular-nums">{label}</span>;
  if (overdueDays > 0) {
    return (
      <span className="tabular-nums">
        <span className="font-medium text-red-600">{label}</span>
        <span className="block text-xs font-medium text-red-600">
          {overdueDays} day{overdueDays === 1 ? "" : "s"} overdue
        </span>
      </span>
    );
  }
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const left = Math.round((Date.UTC(Number(y), Number(m) - 1, Number(d)) - today) / 86_400_000);
  return (
    <span className="tabular-nums">
      <span className="text-slate-900">{label}</span>
      <span className={cn("block text-xs", left <= 3 ? "font-medium text-amber-700" : "text-slate-500")}>
        {left === 0 ? "due today" : `${left} day${left === 1 ? "" : "s"} left`}
      </span>
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "green" : "slate"}>{active ? "Active" : "Inactive"}</Badge>;
}

/** Visit days as compact chips, e.g. Mon Thu */
export function DayChips({ days }: { days: string[] }) {
  if (days.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {days.map((d) => (
        <span key={d} className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-800">
          {d}
        </span>
      ))}
    </span>
  );
}

const orderTone: Record<OrderStatus, Tone> = { Pending: "amber", Received: "blue", Partial: "blue", Posted: "green" };
const orderLabel: Record<OrderStatus, string> = {
  Pending: "Pending delivery",
  Received: "Received",
  Partial: "Partly in stock",
  Posted: "Posted to stock",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={orderTone[status]}>{orderLabel[status]}</Badge>;
}

const lineTone: Record<LineStatus, Tone> = { Pending: "slate", Match: "green", Unmatch: "red", Missing: "red", Extra: "blue" };
const lineLabel: Record<LineStatus, string> = { Pending: "Pending", Match: "Match", Unmatch: "Unmatch", Missing: "Missing", Extra: "Not ordered" };

export function LineStatusBadge({ status }: { status: LineStatus }) {
  return <Badge tone={lineTone[status]}>{lineLabel[status]}</Badge>;
}
