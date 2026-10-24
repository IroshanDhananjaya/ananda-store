"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, toNumber } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAppStore } from "@/lib/store";
import type { Item } from "@/lib/types";

const UOMS = ["PKT", "BOX", "BTL", "CTN", "BAG", "KG", "EA"];

type Values = {
  sapCode: string;
  description: string;
  packageDetails: string;
  uom: string;
  costPrice: string;
  wholesalePrice: string;
  retailPrice: string;
  locationNumber: string;
};

function toValues(item: Item | null): Values {
  if (!item) return { sapCode: "", description: "", packageDetails: "", uom: "PKT", costPrice: "", wholesalePrice: "", retailPrice: "", locationNumber: "" };
  return {
    sapCode: item.sapCode,
    description: item.description,
    packageDetails: item.packageDetails,
    uom: item.uom,
    costPrice: String(item.costPrice),
    wholesalePrice: String(item.wholesalePrice),
    retailPrice: String(item.retailPrice),
    locationNumber: item.locationNumber,
  };
}

function ItemForm({ item, focusLocation, onDone }: { item: Item | null; focusLocation?: boolean; onDone: () => void }) {
  const locations = useAppStore((s) => s.locations);
  const addItem = useAppStore((s) => s.addItem);
  const updateItem = useAppStore((s) => s.updateItem);
  const [values, setValues] = useState<Values>(() => toValues(item));
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});

  const set = (key: keyof Values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.sapCode.trim()) next.sapCode = "SAP code is required.";
    if (!values.description.trim()) next.description = "Description is required.";
    if (!values.uom.trim()) next.uom = "UOM is required.";
    if (values.costPrice === "" || toNumber(values.costPrice) < 0) next.costPrice = "Enter what you pay Raigam (0 or more).";
    if (values.wholesalePrice === "" || toNumber(values.wholesalePrice) < 0) next.wholesalePrice = "Enter a price of 0 or more.";
    if (values.retailPrice === "" || toNumber(values.retailPrice) < 0) next.retailPrice = "Enter a price of 0 or more.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = {
      sapCode: values.sapCode,
      description: values.description,
      packageDetails: values.packageDetails.trim(),
      uom: values.uom.trim().toUpperCase(),
      costPrice: toNumber(values.costPrice),
      wholesalePrice: toNumber(values.wholesalePrice),
      retailPrice: toNumber(values.retailPrice),
      locationNumber: values.locationNumber,
    };
    const result = await (item ? updateItem(item.id, input) : addItem(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(item ? "Item updated" : "Item added");
    onDone();
  }

  return (
    <form id="item-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="SAP Code" htmlFor="sapCode" required error={errors.sapCode} hint={item ? "SAP code can't be changed." : "e.g. RM-NOR-CUR-90G"}>
        <Input
          id="sapCode"
          value={values.sapCode}
          onChange={set("sapCode")}
          disabled={!!item}
          className="uppercase"
          aria-invalid={!!errors.sapCode}
          autoFocus={!item}
        />
      </Field>
      <Field label="Item Description" htmlFor="description" required error={errors.description}>
        <Input
          id="description"
          value={values.description}
          onChange={set("description")}
          placeholder="Normal Curry Soya - 90gr"
          aria-invalid={!!errors.description}
          autoFocus={!!item && !focusLocation}
        />
      </Field>
      <Field label="Package Details" htmlFor="packageDetails" hint="e.g. (90g x 50)">
        <Input id="packageDetails" value={values.packageDetails} onChange={set("packageDetails")} />
      </Field>
      <Field label="UOM" htmlFor="uom" required error={errors.uom}>
        <Input id="uom" list="uom-options" value={values.uom} onChange={set("uom")} className="uppercase" aria-invalid={!!errors.uom} />
        <datalist id="uom-options">
          {UOMS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </Field>
      <Field
        label="Cost Price (Rs.)"
        htmlFor="costPrice"
        required
        error={errors.costPrice}
        hint={
          values.costPrice !== "" && values.wholesalePrice !== ""
            ? `Profit per unit at wholesale: Rs. ${(toNumber(values.wholesalePrice) - toNumber(values.costPrice)).toFixed(2)}`
            : "What you pay Raigam per unit. Used for profit."
        }
      >
        <Input
          id="costPrice"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={values.costPrice}
          onChange={set("costPrice")}
          aria-invalid={!!errors.costPrice}
        />
      </Field>
      <Field label="Wholesale Price (Rs.)" htmlFor="wholesale" required error={errors.wholesalePrice} hint="Default selling price to stores">
        <Input
          id="wholesale"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={values.wholesalePrice}
          onChange={set("wholesalePrice")}
          aria-invalid={!!errors.wholesalePrice}
        />
      </Field>
      <Field label="Retail Price (Rs.)" htmlFor="retail" required error={errors.retailPrice}>
        <Input
          id="retail"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={values.retailPrice}
          onChange={set("retailPrice")}
          aria-invalid={!!errors.retailPrice}
        />
      </Field>
      <Field label="Stock Location" htmlFor="itemLocation" hint="New loads of this item go here.">
        <Select id="itemLocation" value={values.locationNumber} onChange={set("locationNumber")} autoFocus={focusLocation}>
          <option value="">Not set</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.locationNumber}>
              {loc.locationNumber} · {loc.itemGroup}
            </option>
          ))}
        </Select>
      </Field>
    </form>
  );
}

export function ItemFormDialog({
  item,
  open,
  onClose,
  focusLocation,
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  /** Start in the Stock Location box (e.g. when opened to set a missing location) */
  focusLocation?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `Edit ${item.sapCode}` : "Add item"}
      description="Product details from the Items master."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="item-form">
            {item ? "Save changes" : "Add item"}
          </Button>
        </>
      }
    >
      <ItemForm key={item?.id ?? "new"} item={item} focusLocation={focusLocation} onDone={onClose} />
    </Modal>
  );
}
