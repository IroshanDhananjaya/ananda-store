import type { Metadata } from "next";
import { Suspense } from "react";
import { EditSale } from "@/components/sales/sale-pages";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Edit sale" };

// With cacheComponents, runtime params must be read inside a Suspense boundary.
export default function Page({ params }: PageProps<"/sales/[id]/edit">) {
  return <Suspense fallback={<PageLoading />}>{params.then(({ id }) => <EditSale id={id} />)}</Suspense>;
}
