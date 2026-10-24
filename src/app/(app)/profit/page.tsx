import type { Metadata } from "next";
import { ProfitPage } from "@/components/profit/profit-page";

export const metadata: Metadata = { title: "Profit" };

export default function Page() {
  return <ProfitPage />;
}
