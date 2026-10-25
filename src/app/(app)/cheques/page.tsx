import type { Metadata } from "next";
import { ChequesPage } from "@/components/cheques/cheques-page";

export const metadata: Metadata = { title: "Cheques & Credit" };

export default function Page() {
  return <ChequesPage />;
}
