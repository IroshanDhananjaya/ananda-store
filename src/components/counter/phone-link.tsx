"use client";

import { Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Card } from "@/components/ui/layout";

/** This site's address in the browser ("" on the server) */
const useOrigin = () =>
  useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

/**
 * A QR code for the phone: scanning it opens /count, the live counter, on the phone without signing in.
 * The phone's camera only works on an https:// address, so on http (e.g. localhost) it says so.
 */
export function PhoneLink() {
  const origin = useOrigin();
  const url = origin ? `${origin}/count` : "";
  const [qr, setQr] = useState("");
  const local = /^http:\/\/(localhost|127\.|\[::1\])/.test(origin);
  const secure = origin.startsWith("https://");

  useEffect(() => {
    if (!url) return;
    let alive = true;
    QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: "M" })
      .then((data) => alive && setQr(data))
      .catch(() => alive && setQr(""));
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <Card className="flex flex-col items-center gap-5 px-5 py-5 sm:flex-row sm:items-center">
      <div className="grid size-[240px] shrink-0 place-items-center rounded-lg bg-white p-2 ring-1 ring-slate-200">
        {/* White behind the code in both themes, so phones can read it */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a QR code made in the browser (data: URL), nothing to optimise */}
        {qr ? <img src={qr} alt={`QR code for ${url}`} width={224} height={224} /> : <Smartphone className="size-10 text-slate-300" />}
      </div>
      <div className="min-w-0 text-sm text-slate-600">
        <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Smartphone className="size-5 text-brand-600" /> Count with your phone
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Open the phone&apos;s camera (or a QR scanner) and point it at this code.</li>
          <li>Tap the link that appears. The counter opens on the phone, no sign-in needed.</li>
          <li>Press Start camera and allow the camera once.</li>
        </ol>
        <p className="mt-3 font-mono text-xs break-all text-slate-500">{url}</p>
        {local && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This is the laptop&apos;s own address (localhost), which a phone can&apos;t open. Show this page from the live https:// site to scan it.
          </p>
        )}
        {!local && !secure && origin && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Phones only allow the camera on an https:// address. Open this page from the https:// site so the code points there.
          </p>
        )}
      </div>
    </Card>
  );
}
