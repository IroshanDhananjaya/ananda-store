import type { Metadata } from "next";
import { ShopsPage } from "@/components/shops/shops-page";

export const metadata: Metadata = { title: "Stores" };

export default function Page() {
  return <ShopsPage />;
}
