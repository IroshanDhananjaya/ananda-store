"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { BackLink, NotFoundState } from "@/components/ui/layout";
import { StickyHeader } from "@/components/ui/sticky-header";
import { useAppStore } from "@/lib/store";
import { useResetKey } from "@/lib/use-dialog";
import { SALE_FORM_ID, SaleForm } from "./sale-form";

/** Cancel and Save for the bill form, in the top bar so they're always in reach (Save submits the form below) */
function FormButtons({ cancelHref, saveLabel }: { cancelHref: string; saveLabel: string }) {
  return (
    <>
      <Link href={cancelHref} className={buttonClass("outline", "md", "flex-1 sm:flex-none")}>
        Cancel
      </Link>
      <Button type="submit" form={SALE_FORM_ID} className="flex-1 sm:flex-none">
        {saveLabel}
      </Button>
    </>
  );
}

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
      <StickyHeader
        title="New store order"
        description="The bill the rep writes. Items are delivered and cash collected later."
        actions={<FormButtons cancelHref={storeId ? `/stores/${storeId}` : "/invoices"} saveLabel="Create bill" />}
      />
      <SaleForm
        key={`${key}-${storeId}`}
        sale={null}
        defaultShopId={storeId}
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
      <StickyHeader
        title={`Edit ${sale.saleNo}`}
        description="For a delivered order, stock and the cash balance are adjusted to match."
        actions={<FormButtons cancelHref={`/sales/${id}`} saveLabel="Save changes" />}
      />
      <SaleForm key={key} sale={sale} onSaved={() => router.push(`/sales/${id}`)} />
    </>
  );
}
