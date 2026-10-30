import type { Metadata } from "next";
import { OrderDifferencesPage } from "@/components/order-differences/order-differences-page";

export const metadata: Metadata = { title: "Missing & Not Ordered" };

export default function Page() {
  return <OrderDifferencesPage />;
}
