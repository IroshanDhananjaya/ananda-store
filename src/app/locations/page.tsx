import type { Metadata } from "next";
import { LocationsPage } from "@/components/locations/locations-page";

export const metadata: Metadata = { title: "Stock Locations" };

export default function Page() {
  return <LocationsPage />;
}
