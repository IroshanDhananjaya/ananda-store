import type { Metadata } from "next";
import { Suspense } from "react";
import { SaleDetail } from "@/components/sales/sale-detail";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Sale" };

// With cacheComponents, runtime params must be read inside a Suspense boundary.
export default function Page({ params }: PageProps<"/sales/[id]">) {
  return <Suspense fallback={<PageLoading />}>{params.then(({ id }) => <SaleDetail id={id} />)}</Suspense>;
}
