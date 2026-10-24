import type { Metadata } from "next";
import { Suspense } from "react";
import { SalesRoute } from "@/components/sales/sales-page";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Store Orders" };

// SalesRoute reads ?filter= / ?load= with useSearchParams, which needs Suspense under cacheComponents.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SalesRoute />
    </Suspense>
  );
}