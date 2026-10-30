import type { Metadata } from "next";
import { TopItemsPage } from "@/components/top-items/top-items-page";

export const metadata: Metadata = { title: "Top Selling Items" };

export default function Page() {
  return <TopItemsPage />;
}
