"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { buttonClass } from "@/components/ui/button";
import { BackLink, NotFoundState, PageHeader } from "@/components/ui/layout";
import { useAppStore } from "@/lib/store";
import { useResetKey } from "@/lib/use-dialog";
import { OrderForm } from "./order-form";
import { ReceiveLoadForm } from "./receive-load-form";

export function OrderNotFound() {
  return <NotFoundState title="Order not found" href="/orders" linkLabel="Back to orders" />;
}

/** /orders/new — ?items=SAP1,SAP2 starts the order with those items (e.g. picked from Low stock) */
export function NewOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const items = useAppStore((s) => s.items);
  const itemsParam = params.get("items") ?? "";
  const prefill = [...new Set(itemsParam.split(","))].filter((code) => items.some((i) => i.sapCode === code));
  // Keep a half-filled draft when navigating away; start fresh after saving (or when items are picked again).
  const { key, reset } = useResetKey({ onHide: false });

  return (
    <>
      <BackLink href="/orders">Purchase Orders</BackLink>
      <PageHeader title="New purchase order" description="Record an order placed with Raigam and the items on it." />
      <OrderForm
        key={`${key}-${itemsParam}`}
        order={null}
        lines={[]}
        prefill={prefill}
        cancelHref="/orders"
        onSaved={(id) => {
          reset();
          router.push(`/orders/${id}`);
        }}
      />
    </>
  );
}

export function ReceiveLoad() {
  const router = useRouter();
  // Keep a half-filled invoice when navigating away; start fresh after saving.
  const { key, reset } = useResetKey({ onHide: false });

  return (
    <>
      <BackLink href="/orders">Purchase Orders</BackLink>
      <PageHeader
        title="Receive new load"
        description="A load arrived from Raigam: enter its invoice and items. It is saved as a received purchase order and the items go into stock."
      />
      <ReceiveLoadForm
        key={key}
        cancelHref="/orders"
        onSaved={(id) => {
          reset();
          router.push(`/orders/${id}`);
        }}
      />
    </>
  );
}

export function EditOrder({ id }: { id: string }) {
  const router = useRouter();
  const order = useAppStore((s) => s.orders.find((o) => o.id === id));
  const orderItems = useAppStore((s) => s.orderItems);
  const lines = useMemo(() => orderItems.filter((l) => l.orderId === order?.orderId), [orderItems, order?.orderId]);
  // Remount with fresh store data each time this page is shown again
  const { key } = useResetKey();

  if (!order) return <OrderNotFound />;

  if (order.postedToStock) {
    return (
      <>
        <BackLink href={`/orders/${id}`}>{order.orderId}</BackLink>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-10 text-center">
          <Lock className="mx-auto size-6 text-amber-600" />
          <p className="mt-3 font-semibold text-amber-900">{order.orderId} is posted to stock</p>
          <p className="mt-1 text-sm text-amber-800">Reverse the stock posting from the order page before editing it.</p>
          <Link href={`/orders/${id}`} className={buttonClass("outline", "md", "mt-5")}>
            Go to order
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <BackLink href={`/orders/${id}`}>{order.orderId}</BackLink>
      <PageHeader title={`Edit ${order.orderId}`} description="Update order details, delivery and item quantities." />
      <OrderForm key={key} order={order} lines={lines} cancelHref={`/orders/${id}`} onSaved={() => router.push(`/orders/${id}`)} />
    </>
  );
}
