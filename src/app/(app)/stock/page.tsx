import type { Metadata } from "next";
import { StockPage } from "@/components/stock/stock-page";

export const metadata: Metadata = { title: "Stock" };

export default function Page() {
  return <StockPage />;
}
