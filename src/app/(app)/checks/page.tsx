import type { Metadata } from "next";
import { ChecksPage } from "@/components/checks/checks-page";

export const metadata: Metadata = { title: "Data Checks" };

export default function Page() {
  return <ChecksPage />;
}
