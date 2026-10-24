import type { Metadata } from "next";
import { ReturnsPage } from "@/components/returns/returns-page";

export const metadata: Metadata = { title: "Return Items" };

export default function Page() {
  return <ReturnsPage />;
}
