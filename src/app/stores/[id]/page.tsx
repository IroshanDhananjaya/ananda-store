import type { Metadata } from "next";
import { Suspense } from "react";
import { ShopDetail } from "@/components/shops/shop-detail";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Store" };

// With cacheComponents, runtime params must be read inside a Suspense boundary.
export default function Page({ params }: PageProps<"/stores/[id]">) {
  return <Suspense fallback={<PageLoading />}>{params.then(({ id }) => <ShopDetail id={id} />)}</Suspense>;
}
