import type { Metadata } from "next";
import { FreeIssuesPage } from "@/components/free-issues/free-issues-page";

export const metadata: Metadata = { title: "Free Issues" };

export default function Page() {
  return <FreeIssuesPage />;
}
