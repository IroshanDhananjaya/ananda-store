import type { Metadata } from "next";
import { OrderItemsPage } from "@/components/order-items/order-items-page";

export const metadata: Metadata = { title: "Order Items" };

export default function Page() {
  return <OrderItemsPage />;
}
