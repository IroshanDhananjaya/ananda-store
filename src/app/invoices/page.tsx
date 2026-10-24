import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoicesRoute } from "@/components/invoices/invoices-page";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Daily Invoices" };

// InvoicesRoute reads ?route= / ?store= with useSearchParams, which needs Suspense under cacheComponents.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <InvoicesRoute />
    </Suspense>
  );
}
