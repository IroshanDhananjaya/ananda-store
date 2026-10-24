import type { Metadata } from "next";
import { Suspense } from "react";
import { EditOrder } from "@/components/orders/order-pages";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Edit order" };

// With cacheComponents, runtime params must be read inside a Suspense boundary.
export default function Page({ params }: PageProps<"/orders/[id]/edit">) {
  return <Suspense fallback={<PageLoading />}>{params.then(({ id }) => <EditOrder id={id} />)}</Suspense>;
}
