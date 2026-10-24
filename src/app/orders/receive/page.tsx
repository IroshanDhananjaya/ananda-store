import type { Metadata } from "next";
import { ReceiveLoad } from "@/components/orders/order-pages";

export const metadata: Metadata = { title: "Receive new load" };

export default function Page() {
  return <ReceiveLoad />;
}
