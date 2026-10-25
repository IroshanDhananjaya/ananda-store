"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BackLink, NotFoundState, PageHeader } from "@/components/ui/layout";
import { useAppStore } from "@/lib/store";
import { useResetKey } from "@/lib/use-dialog";
import { SaleForm } from "./sale-form";

export function SaleNotFound() {
  return <NotFoundState title="Order not found" href="/invoices" linkLabel="Back to Daily Invoices" />;
}

/** /sales/new — optional ?store=<id> preselects the store */
export function NewSale() {
  const router = useRouter();
  const storeId = useSearchParams().get("store") ?? "";
  // Keep a draft when navigating away; start fresh after saving
  const { key, reset } = useResetKey({ onHide: false });

  return (
    <>
      <BackLink href={storeId ? `/stores/${storeId}` : "/invoices"}>{storeId ? "Store" : "Daily Invoices"}</BackLink>
      <PageHeader title="New store order" description="The bill the rep writes. Items are delivered and cash collected later." />
      <SaleForm
        key={`${key}-${storeId}`}
        sale={null}
        defaultShopId={storeId}
        cancelHref={storeId ? `/stores/${storeId}` : "/invoices"}
        onSaved={(id) => {
          reset();
          router.push(`/sales/${id}`);
        }}
      />
    </>
  );
}

export function EditSale({ id }: { id: string }) {
  const router = useRouter();
  const sale = useAppStore((s) => s.sales.find((x) => x.id === id));
  // Remount with fresh store data each time this page is shown again
  const { key } = useResetKey();

  if (!sale) return <SaleNotFound />;

  return (
    <>
      <BackLink href={`/sales/${id}`}>{sale.saleNo}</BackLink>
      <PageHeader title={`Edit ${sale.saleNo}`} description="For a delivered order, stock and the cash balance are adjusted to match." />
      <SaleForm key={key} sale={sale} cancelHref={`/sales/${id}`} onSaved={() => router.push(`/sales/${id}`)} />
    </>
  );
}
