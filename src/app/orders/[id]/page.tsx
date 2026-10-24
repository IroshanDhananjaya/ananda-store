import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderDetail } from "@/components/orders/order-detail";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Order" };

// With cacheComponents, runtime params must be read inside a Suspense boundary.
export default function Page({ params }: PageProps<"/orders/[id]">) {
  return <Suspense fallback={<PageLoading />}>{params.then(({ id }) => <OrderDetail id={id} />)}</Suspense>;
}
