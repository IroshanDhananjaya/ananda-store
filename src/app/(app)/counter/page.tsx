import type { Metadata } from "next";
import { CounterPage } from "@/components/counter/counter-page";

export const metadata: Metadata = { title: "Item Counter" };

export default function Page() {
  return <CounterPage />;
}
