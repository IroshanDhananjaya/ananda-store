"use client";

import { Circle, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Checked" tick for a bill compared with Raigam's printed bill: click to tick, click again to untick */
export function CheckedToggle({ sale, className }: { sale: Sale; className?: string }) {
  const markChecked = useAppStore((s) => s.markChecked);
  if (!sale.invoiceNo) return <span className="text-xs text-slate-400" title="No Raigam invoice number on this bill">—</span>;

  return (
    <button
      type="button"
      onClick={async (e) => {
        // Inside clickable table rows
        e.stopPropagation();
        const result = await markChecked([sale.id], !sale.checked);
        if (!result.ok) toast.error(result.error);
      }}
      aria-pressed={sale.checked}
      title={sale.checked ? "Matches Raigam's bill. Click to untick." : `Tick once ${sale.saleNo} matches Raigam's printed bill ${sale.invoiceNo}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 transition-colors ring-inset print:hidden",
        sale.checked
          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/25 hover:bg-emerald-100"
          : "bg-white text-slate-500 ring-slate-300 hover:bg-slate-50 hover:text-slate-800",
        className,
      )}
    >
      {sale.checked ? <CircleCheck className="size-3.5" /> : <Circle className="size-3.5" />}
      {sale.checked ? "Checked" : "Check"}
    </button>
  );
}
