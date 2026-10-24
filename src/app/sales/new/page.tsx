import type { Metadata } from "next";
import { Suspense } from "react";
import { NewSale } from "@/components/sales/sale-pages";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "New sale" };

// NewSale reads ?store= with useSearchParams, which needs a Suspense boundary under cacheComponents.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewSale />
    </Suspense>
  );
}
