import type { Metadata, Viewport } from "next";
import { CounterPage } from "@/components/counter/counter-page";

export const metadata: Metadata = { title: "Item Counter", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1 };

// Opened on a phone from the QR code on the laptop's Item Counter page. Outside the signed-in app (no
// sidebar, no store data loaded), and let through by proxy.ts: it only uses this phone's camera.
export default function Page() {
  return (
    <main className="min-h-dvh px-3 py-3">
      <CounterPage phone />
    </main>
  );
}
