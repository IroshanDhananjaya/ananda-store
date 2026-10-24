"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, ReadOnlyValue, Select, toNumber } from "@/components/ui/form";
import { SearchSelect } from "@/components/ui/search-select";
import { Modal } from "@/components/ui/modal";
import { useAppStore, useItemMap } from "@/lib/store";
import type { StockRecord } from "@/lib/types";
import { formatQty, todayISO } from "@/lib/utils";

type Values = { sapCode: string; locationNumber: string; availableQty: string; issuedQty: string; lastUpdate: string };

function StockForm({ record, onDone }: { record: StockRecord | null; onDone: () => void }) {
  const items = useAppStore((s) => s.items);
  const locations = useAppStore((s) => s.locations);
  const addStock = useAppStore((s) => s.addStock);
  const updateStock = useAppStore((s) => s.updateStock);
  const itemMap = useItemMap();
  const [values, setValues] = useState<Values>(() => ({
    sapCode: record?.sapCode ?? "",
    locationNumber: record?.locationNumber ?? "",
    availableQty: record ? String(record.availableQty) : "",
    issuedQty: record ? String(record.issuedQty) : "0",
    lastUpdate: record?.lastUpdate ?? todayISO(),
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.sapCode) next.sapCode = "Select an item.";
    if (!values.locationNumber) next.locationNumber = "Select a location.";
    if (values.availableQty === "" || !Number.isInteger(toNumber(values.availableQty)) || toNumber(values.availableQty) < 0)
      next.availableQty = "Enter a whole number (0 or more).";
    if (!Number.isInteger(toNumber(values.issuedQty)) || toNumber(values.issuedQty) < 0)
      next.issuedQty = "Enter a whole number (0 or more).";
    if (!values.lastUpdate) next.lastUpdate = "Select a date.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = {
      sapCode: values.sapCode,
      locationNumber: values.locationNumber,
      availableQty: toNumber(values.availableQty),
      issuedQty: toNumber(values.issuedQty),
      lastUpdate: values.lastUpdate,
    };
    const result = await (record ? updateStock(record.id, input) : addStock(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(record ? "Stock record updated" : "Stock record added");
    onDone();
  }

  const selectedItem = itemMap.get(values.sapCode);

  return (
    <form id="stock-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="Item (SAP Code)" htmlFor="sapCode" required error={errors.sapCode} className="sm:col-span-2">
        <SearchSelect
          id="sapCode"
          value={values.sapCode}
          onChange={(sapCode) => setValues((v) => ({ ...v, sapCode }))}
          options={items.map((i) => ({ value: i.sapCode, label: i.sapCode, description: i.description, hint: i.packageDetails }))}
          placeholder="Select an item…"
          showDescription
          aria-invalid={!!errors.sapCode}
          autoFocus
        />
      </Field>
      <Field label="Package Type">
        <ReadOnlyValue>{selectedItem?.packageDetails || "—"}</ReadOnlyValue>
      </Field>
      <Field label="Store Location" htmlFor="location" required error={errors.locationNumber}>
        <Select id="location" value={values.locationNumber} onChange={set("locationNumber")} aria-invalid={!!errors.locationNumber}>
          <option value="">Select a location…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.locationNumber}>
              {l.locationNumber} · {l.itemGroup}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Available QTY" htmlFor="available" required error={errors.availableQty}>
        <Input id="available" type="number" min={0} step={1} inputMode="numeric" value={values.availableQty} onChange={set("availableQty")} aria-invalid={!!errors.availableQty} />
      </Field>
      <Field label="Issued" htmlFor="issued" error={errors.issuedQty}>
        <Input id="issued" type="number" min={0} step={1} inputMode="numeric" value={values.issuedQty} onChange={set("issuedQty")} aria-invalid={!!errors.issuedQty} />
      </Field>
      <Field label="Last Update" htmlFor="lastUpdate" required error={errors.lastUpdate}>
        <Input id="lastUpdate" type="date" value={values.lastUpdate} onChange={set("lastUpdate")} aria-invalid={!!errors.lastUpdate} />
      </Field>
    </form>
  );
}

export function StockFormDialog({ record, open, onClose }: { record: StockRecord | null; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={record ? "Edit stock record" : "Add stock record"}
      description={record ? `${record.sapCode} at ${record.locationNumber}` : "Opening stock for an item at a store location."}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="stock-form">
            {record ? "Save changes" : "Add stock"}
          </Button>
        </>
      }
    >
      <StockForm key={record?.id ?? "new"} record={record} onDone={onClose} />
    </Modal>
  );
}

function IssueForm({ record, onDone }: { record: StockRecord; onDone: () => void }) {
  const issueStock = useAppStore((s) => s.issueStock);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayISO);
  const [error, setError] = useState<string>();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const n = toNumber(qty);
    if (!Number.isInteger(n) || n <= 0) return setError("Enter a whole number above 0.");
    if (n > record.availableQty) return setError(`Only ${record.availableQty} available.`);
    const result = await issueStock(record.id, n, date);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Issued ${n} × ${record.sapCode}`);
    onDone();
  }

  const remaining = record.availableQty - (toNumber(qty) || 0);

  return (
    <form id="issue-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="Available now">
        <ReadOnlyValue className="tabular-nums">{formatQty(record.availableQty)}</ReadOnlyValue>
      </Field>
      <Field label="After issue">
        <ReadOnlyValue className={remaining < 0 ? "text-red-600 tabular-nums" : "tabular-nums"}>{formatQty(remaining)}</ReadOnlyValue>
      </Field>
      <Field label="Quantity to issue" htmlFor="issueQty" required error={error}>
        <Input
          id="issueQty"
          type="number"
          min={1}
          max={record.availableQty}
          step={1}
          inputMode="numeric"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setError(undefined);
          }}
          aria-invalid={!!error}
          autoFocus
        />
      </Field>
      <Field label="Issue date" htmlFor="issueDate" required>
        <Input id="issueDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </form>
  );
}

export function IssueStockDialog({ record, open, onClose }: { record: StockRecord | null; open: boolean; onClose: () => void }) {
  const itemMap = useItemMap();
  if (!record) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Issue stock"
      description={`${record.sapCode} · ${itemMap.get(record.sapCode)?.description ?? ""} · ${record.locationNumber}. For damages, samples or transfers. To sell to a store, use Sales.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="issue-form" disabled={record.availableQty === 0}>
            Issue stock
          </Button>
        </>
      }
    >
      <IssueForm key={record.id} record={record} onDone={onClose} />
    </Modal>
  );
}
