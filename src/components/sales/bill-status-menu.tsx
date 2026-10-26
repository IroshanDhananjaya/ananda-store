"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAppStore } from "@/lib/store";
import type { Sale } from "@/lib/types";
import { addDays, cn, formatDate, formatMoney, todayISO } from "@/lib/utils";
import { changesError, changesFrom, changesInput, DeliveryChanges, totalsWith, type DeliveryChangesValue } from "./delivery-changes";

// Quick status changes for a bill, in Raigam's words:
//   Actual        the store took the goods: delivered (with anything it didn't take or gave back), no money entered
//   Late Delivery not delivered on its day: loaded goods go back to the warehouse, the bill waits to load again
//   Cancel        the store doesn't want it: kept as a Cancelled record, loaded goods go back to stock
//   Restore       undo a cancel

type Choice = "actual" | "late" | "cancel" | "restore";

const LABELS: Record<Choice, string> = { actual: "Actual", late: "Late Delivery", cancel: "Cancel", restore: "Restore" };

function choicesFor(sale: Sale): Choice[] {
  if (sale.status === "Cancelled") return ["restore"];
  if (sale.status === "Delivered") return [];
  return ["actual", "late", "cancel"];
}

function ActualForm({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const deliverSale = useAppStore((s) => s.deliverSale);
  const creditDays = useAppStore((s) => s.shops.find((x) => x.id === sale.shopId)?.creditDays ?? 21);
  const [date, setDate] = useState(todayISO);
  const [changes, setChanges] = useState<DeliveryChangesValue>(() => changesFrom(sale));
  const [error, setError] = useState<string>();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = date ? changesError(sale, changes) : "Enter the delivery date.";
    setError(err);
    if (err) return;
    const result = await deliverSale(sale.id, {
      ...changesInput(changes),
      date,
      // End date for collecting the balance: the store's credit days after delivery
      dueDate: addDays(date, creditDays),
      collection: null,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`${sale.saleNo} delivered · invoice ${formatMoney(totalsWith(sale, changes).total)}${sale.status === "Ordered" ? " · items taken from stock" : ""}`);
    onDone();
  }

  return (
    <form
      id="actual-form"
      onSubmit={handleSubmit}
      // Enter in a box doesn't mark the bill delivered by accident
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <Field
        label="Delivery date"
        htmlFor="actualDate"
        required
        className="max-w-xs"
        hint={date ? `End date ${formatDate(addDays(date, creditDays))} (${creditDays} day${creditDays === 1 ? "" : "s"} after delivery)` : undefined}
      >
        <Input id="actualDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <DeliveryChanges sale={sale} value={changes} onChange={setChanges} />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** "Actual": mark delivered, with anything the store didn't take or gave back (no money; record payments separately) */
export function ActualDialog({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Actual delivery · ${sale.saleNo}`}
      description="Mark the bill delivered. If the store took everything, just press Mark delivered."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="actual-form">
            Mark delivered
          </Button>
        </>
      }
    >
      <ActualForm sale={sale} onDone={onClose} />
    </Modal>
  );
}

export function BillStatusMenu({ sale, className }: { sale: Sale; className?: string }) {
  const markLate = useAppStore((s) => s.markLate);
  const cancelSale = useAppStore((s) => s.cancelSale);
  const restoreSale = useAppStore((s) => s.restoreSale);
  const [confirm, setConfirm] = useState<Exclude<Choice, "restore"> | null>(null);

  const choices = choicesFor(sale);
  if (choices.length === 0) return null;
  const loaded = sale.status === "Loaded";

  async function run(choice: Exclude<Choice, "actual">) {
    const result = choice === "late" ? await markLate(sale.id) : choice === "cancel" ? await cancelSale(sale.id) : await restoreSale(sale.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const done: Record<Exclude<Choice, "actual">, string> = {
      late: `${sale.saleNo} marked late${loaded ? " · goods back in the warehouse" : ""} · waiting to load`,
      cancel: `${sale.saleNo} cancelled${loaded ? " · goods back in stock" : ""}`,
      restore: `${sale.saleNo} restored · waiting to load`,
    };
    toast.success(done[choice]);
  }

  return (
    <>
      <Select
        value=""
        onChange={(e) => {
          const choice = e.target.value as Choice;
          if (choice === "restore") void run(choice);
          else setConfirm(choice);
        }}
        className={cn("h-8 w-36 text-xs", className)}
        aria-label={`Change status of ${sale.saleNo}`}
      >
        <option value="" disabled hidden>
          Change status
        </option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {LABELS[c]}
          </option>
        ))}
      </Select>

      <ActualDialog sale={sale} open={confirm === "actual"} onClose={() => setConfirm(null)} />
      <ConfirmDialog
        open={confirm === "late"}
        onClose={() => setConfirm(null)}
        title={`Mark ${sale.saleNo} as late delivery?`}
        message={
          loaded
            ? "It wasn't delivered today. The goods come off the lorry and go back into warehouse stock, and the bill waits to be loaded again."
            : "It wasn't delivered on its day. The bill stays waiting to load, marked Late."
        }
        confirmLabel="Mark late"
        tone="primary"
        onConfirm={async () => {
          await run("late");
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        title={`Cancel ${sale.saleNo}?`}
        message={`The bill is kept as Cancelled for your records and won't count in sales, profit or the store's balance.${
          loaded ? " The goods come off the lorry and go back into stock." : ""
        } Any payments on it stay with the store as an advance. You can restore it later.`}
        confirmLabel="Cancel bill"
        onConfirm={async () => {
          await run("cancel");
          setConfirm(null);
        }}
      />
    </>
  );
}
