"use client";

import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/form";
import { FilterTabs } from "@/components/ui/layout";
import type { Payment } from "@/lib/types";
import { formatDate, todayISO } from "@/lib/utils";

type Status = "toCollect" | "collected";

/** A cheque: still to collect from the store, or collected (in hand) on a date. `collectedDate` "" = to collect. */
export function ChequeStatusField({
  collectedDate,
  onChange,
  receivedDate,
  className,
}: {
  collectedDate: string;
  onChange: (collectedDate: string) => void;
  /** The payment's date: a cheque marked collected was usually handed over then */
  receivedDate?: string;
  className?: string;
}) {
  const collected = collectedDate !== "";
  return (
    <Field
      label="Cheque status"
      className={className}
      hint={
        collected
          ? "You have the cheque (collected from the store)."
          : "The store still has to give you this cheque: it isn't counted as paid until you mark it collected."
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs<Status>
          value={collected ? "collected" : "toCollect"}
          onChange={(s) => onChange(s === "collected" ? receivedDate || todayISO() : "")}
          options={[
            { value: "toCollect", label: "To collect" },
            { value: "collected", label: "Collected" },
          ]}
        />
        {collected && (
          <Input
            type="date"
            value={collectedDate}
            onChange={(e) => onChange(e.target.value || todayISO())}
            className="h-9 w-40"
            aria-label="Date collected"
          />
        )}
      </div>
    </Field>
  );
}

/** "To collect" / "Collected 25/10/2026" for a cheque payment; nothing for cash or transfers */
export function ChequeStatusBadge({ payment }: { payment: Pick<Payment, "method" | "chequeCollectedDate"> }) {
  if (payment.method !== "Cheque") return null;
  return payment.chequeCollectedDate ? (
    <Badge tone="green">Collected {formatDate(payment.chequeCollectedDate)}</Badge>
  ) : (
    <Badge tone="amber">To collect</Badge>
  );
}
