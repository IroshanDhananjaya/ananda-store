import type { Metadata } from "next";
import { RoutesPage } from "@/components/routes/routes-page";

export const metadata: Metadata = { title: "Routes" };

export default function Page() {
  return <RoutesPage />;
}
