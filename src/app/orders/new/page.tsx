import type { Metadata } from "next";
import { Suspense } from "react";
import { NewOrder } from "@/components/orders/order-pages";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "New order" };

// NewOrder reads ?items= with useSearchParams, which needs Suspense under cacheComponents.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewOrder />
    </Suspense>
  );
}
