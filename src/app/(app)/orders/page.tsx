import type { Metadata } from "next";
import { OrdersPage } from "@/components/orders/orders-page";

export const metadata: Metadata = { title: "Purchase Orders" };

export default function Page() {
  return <OrdersPage />;
}
