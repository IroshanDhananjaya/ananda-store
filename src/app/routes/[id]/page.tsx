import type { Metadata } from "next";
import { Suspense } from "react";
import { RouteDetail } from "@/components/routes/route-detail";
import { PageLoading } from "@/components/ui/page-loading";

export const metadata: Metadata = { title: "Route" };

// With cacheComponents, runtime params must be read inside a Suspense boundary.
export default function Page({ params }: PageProps<"/routes/[id]">) {
  return <Suspense fallback={<PageLoading />}>{params.then(({ id }) => <RouteDetail id={id} />)}</Suspense>;
}
