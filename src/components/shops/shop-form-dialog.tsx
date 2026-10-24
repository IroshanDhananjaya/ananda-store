"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea, toNumber } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAppStore } from "@/lib/store";
import type { Shop } from "@/lib/types";
import { nextCode } from "@/lib/utils";

type Values = {
  shopCode: string;
  shopName: string;
  ownerName: string;
  phone: string;
  address: string;
  town: string;
  mapLink: string;
  routeId: string;
  creditLimit: string;
  creditDays: string;
  openingBalance: string;
  active: boolean;
  notes: string;
};

function ShopForm({
  shop,
  defaultRouteId,
  defaultName = "",
  onDone,
}: {
  shop: Shop | null;
  defaultRouteId?: string;
  defaultName?: string;
  onDone: (id: string) => void;
}) {
  const shops = useAppStore((s) => s.shops);
  const routes = useAppStore((s) => s.routes);
  const addShop = useAppStore((s) => s.addShop);
  const updateShop = useAppStore((s) => s.updateShop);
  const [values, setValues] = useState<Values>(() => ({
    shopCode: shop?.shopCode ?? nextCode(shops.map((s) => s.shopCode), "ST", 4),
    shopName: shop?.shopName ?? defaultName,
    ownerName: shop?.ownerName ?? "",
    phone: shop?.phone ?? "",
    address: shop?.address ?? "",
    town: shop?.town ?? "",
    mapLink: shop?.mapLink ?? "",
    routeId: shop?.routeId ?? defaultRouteId ?? "",
    creditLimit: shop ? String(shop.creditLimit) : "0",
    creditDays: shop ? String(shop.creditDays) : "21",
    openingBalance: shop ? String(shop.openingBalance) : "0",
    active: shop?.active ?? true,
    notes: shop?.notes ?? "",
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.shopCode.trim()) next.shopCode = "Store number is required.";
    if (!values.shopName.trim()) next.shopName = "Store name is required.";
    if (!values.routeId) next.routeId = "Select a route.";
    if (values.creditLimit === "" || toNumber(values.creditLimit) < 0) next.creditLimit = "Enter 0 or more.";
    if (values.creditDays === "" || !Number.isInteger(Number(values.creditDays)) || Number(values.creditDays) < 0)
      next.creditDays = "Enter whole days (0 = pay on delivery).";
    if (values.openingBalance === "" || !Number.isFinite(Number(values.openingBalance))) next.openingBalance = "Enter an amount.";
    if (values.mapLink && !/^https?:\/\//i.test(values.mapLink.trim())) next.mapLink = "Paste a full link starting with https://";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = {
      ...values,
      creditLimit: toNumber(values.creditLimit),
      creditDays: Number(values.creditDays),
      openingBalance: toNumber(values.openingBalance),
    };
    const result = await (shop ? updateShop(shop.id, input) : addShop(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(shop ? "Store updated" : "Store added");
    onDone(result.id!);
  }

  return (
    <form id="shop-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Store Number" htmlFor="shopCode" required error={errors.shopCode}>
        <Input id="shopCode" value={values.shopCode} onChange={set("shopCode")} className="uppercase" aria-invalid={!!errors.shopCode} />
      </Field>
      <Field label="Store Name" htmlFor="shopName" required error={errors.shopName}>
        <Input id="shopName" value={values.shopName} onChange={set("shopName")} aria-invalid={!!errors.shopName} autoFocus={!defaultName} />
      </Field>
      <Field label="Owner Name" htmlFor="ownerName">
        <Input id="ownerName" value={values.ownerName} onChange={set("ownerName")} />
      </Field>
      <Field label="Phone" htmlFor="phone">
        <Input id="phone" type="tel" value={values.phone} onChange={set("phone")} placeholder="07X XXX XXXX" />
      </Field>
      <Field label="Address" htmlFor="address">
        <Input id="address" value={values.address} onChange={set("address")} />
      </Field>
      <Field label="Town" htmlFor="town">
        <Input id="town" value={values.town} onChange={set("town")} />
      </Field>
      <Field label="Map link" htmlFor="mapLink" error={errors.mapLink} hint="Optional Google Maps link to the store" className="sm:col-span-2">
        <Input id="mapLink" type="url" value={values.mapLink} onChange={set("mapLink")} placeholder="https://maps.app.goo.gl/…" aria-invalid={!!errors.mapLink} />
      </Field>
      <Field label="Route" htmlFor="routeId" required error={errors.routeId} className="sm:col-span-2">
        {/* Name already typed (adding a store from a bill): the route is what's left to choose */}
        <Select id="routeId" value={values.routeId} onChange={set("routeId")} aria-invalid={!!errors.routeId} autoFocus={!!defaultName}>
          <option value="">Select a route…</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.routeCode} · {r.routeName}
              {r.active ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Credit Limit (Rs.)" htmlFor="creditLimit" error={errors.creditLimit} hint="Most this store may owe at once">
        <Input id="creditLimit" type="number" min={0} step="0.01" inputMode="decimal" value={values.creditLimit} onChange={set("creditLimit")} aria-invalid={!!errors.creditLimit} />
      </Field>
      <Field
        label="Credit Days"
        htmlFor="creditDays"
        error={errors.creditDays}
        hint="Days to pay a bill, counted from delivery: a bill's end date is its delivery date + these days. 0 = pay on delivery."
      >
        <Input id="creditDays" type="number" min={0} step={1} inputMode="numeric" value={values.creditDays} onChange={set("creditDays")} aria-invalid={!!errors.creditDays} />
      </Field>
      <Field
        label="Opening Balance (Rs.)"
        htmlFor="openingBalance"
        error={errors.openingBalance}
        hint="Amount owed before using this app. Orders and payments update the balance."
      >
        <Input id="openingBalance" type="number" step="0.01" inputMode="decimal" value={values.openingBalance} onChange={set("openingBalance")} aria-invalid={!!errors.openingBalance} />
      </Field>
      <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" value={values.notes} onChange={set("notes")} rows={2} className="min-h-16" />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox
          label="Active"
          description="Inactive stores are kept for history but can't receive new sales."
          checked={values.active}
          onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
        />
      </div>
    </form>
  );
}

export function ShopFormDialog({
  shop,
  defaultRouteId,
  defaultName,
  open,
  onClose,
  onSaved,
}: {
  shop: Shop | null;
  defaultRouteId?: string;
  /** Store name to start with (typed in a bill's Store box) */
  defaultName?: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={shop ? `Edit ${shop.shopName}` : "Add store"}
      description="A store (shop) you sell to."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="shop-form">
            {shop ? "Save changes" : "Add store"}
          </Button>
        </>
      }
    >
      <ShopForm
        key={shop?.id ?? "new"}
        shop={shop}
        defaultRouteId={defaultRouteId}
        defaultName={defaultName}
        onDone={(id) => {
          onClose();
          onSaved?.(id);
        }}
      />
    </Modal>
  );
}
