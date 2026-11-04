"use client";

import { Camera, CameraOff, Crosshair, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, FilterTabs } from "@/components/ui/layout";
import { countItems, type CountBlob, type Polarity } from "@/lib/item-counter";
import { PhoneLink } from "./phone-link";
import { cn, formatQty } from "@/lib/utils";

/** Frames are counted at this size (long side): enough detail, and quick on a phone */
const WORK_SIZE = 480;
/** Time between counts */
const EVERY_MS = 200;
/** Counts the shown total is smoothed over (the middle one), so it doesn't flicker */
const SMOOTH = 7;

type Status = "off" | "starting" | "live" | "error";

const median = (values: number[]) => {
  const v = values.toSorted((a, b) => a - b);
  return v[v.length >> 1] ?? 0;
};

/**
 * Live item counter: the phone's camera on items laid out on the floor, counted several times a second
 * with plain image processing (src/lib/item-counter.ts, no AI). Nothing is saved or sent anywhere.
 */
export function CounterPage({ phone = false }: { phone?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recent = useRef<number[]>([]);
  const lastBlobs = useRef<CountBlob[]>([]);

  const [status, setStatus] = useState<Status>("off");
  const [error, setError] = useState<string>();
  const [count, setCount] = useState(0);
  const [held, setHeld] = useState(false);
  const [sensitivity, setSensitivity] = useState(0);
  const [unitArea, setUnitArea] = useState<number>();
  const [picking, setPicking] = useState(false);
  const [polarity, setPolarity] = useState<Polarity>("auto");

  // The loop reads these without restarting
  const settings = useRef({ sensitivity, unitArea, held, polarity });
  useEffect(() => {
    settings.current = { sensitivity, unitArea, held, polarity };
  }, [sensitivity, unitArea, held, polarity]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("off");
  }, []);

  async function start() {
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("This browser can't open the camera here. Open the app from its https:// address (not http) in Chrome or Safari.");
      return;
    }
    setStatus("starting");
    try {
      // The back camera on a phone
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      recent.current = [];
      setHeld(false);
      setStatus("live");
    } catch (e) {
      setStatus("error");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera permission was refused. Allow the camera for this site in the browser's settings, then try again."
          : "Couldn't open the camera. Close other apps using it and try again.",
      );
    }
  }

  // Stop the camera when leaving the page
  useEffect(() => stop, [stop]);

  // Count the current frame every EVERY_MS while live
  useEffect(() => {
    if (status !== "live") return;
    let timer = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (video && overlay && video.videoWidth && !settings.current.held) {
        const scale = Math.min(1, WORK_SIZE / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.round(video.videoWidth * scale);
        const height = Math.round(video.videoHeight * scale);
        const work = (workRef.current ??= document.createElement("canvas"));
        work.width = width;
        work.height = height;
        const wctx = work.getContext("2d", { willReadFrequently: true })!;
        wctx.drawImage(video, 0, 0, width, height);
        const { data } = wctx.getImageData(0, 0, width, height);
        const result = countItems({ data, width, height }, settings.current);
        lastBlobs.current = result.blobs;
        const total = result.blobs.reduce((n, b) => n + b.count, 0);
        recent.current = [...recent.current, total].slice(-SMOOTH);
        setCount(median(recent.current));
        drawOverlay(overlay, width, height, result.blobs);
      }
      timer = window.setTimeout(tick, EVERY_MS);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [status]);

  // Tap one single item: everything is measured against its size (touching items split right)
  function onTap(e: MouseEvent<HTMLCanvasElement>) {
    if (!picking) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const blob = lastBlobs.current.toSorted((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (blob) {
      setUnitArea(blob.area / blob.count);
      recent.current = [];
    }
    setPicking(false);
  }

  const live = status === "live";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Item Counter</h1>
          <p className="text-sm text-slate-500">Point the camera straight down at items on the floor. It counts live. Nothing is saved.</p>
        </div>
        {live ? (
          <Button variant="outline" onClick={stop}>
            <CameraOff /> Stop camera
          </Button>
        ) : (
          <Button onClick={start} disabled={status === "starting"}>
            <Camera /> {status === "starting" ? "Opening camera…" : "Start camera"}
          </Button>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* On the laptop: a QR code to open this counter on a phone, no sign-in */}
      {!phone && !live && <PhoneLink />}

      <Card className="relative bg-black">
        {/* The live picture, with the numbers drawn over it at the same size */}
        <div className={cn("relative", !live && "hidden")}>
          <video ref={videoRef} playsInline muted className="block max-h-[72dvh] w-full object-contain" />
          <canvas
            ref={overlayRef}
            onClick={onTap}
            className={cn("absolute inset-0 h-full w-full object-contain", picking && "cursor-crosshair")}
            aria-label="Counted items, numbered"
          />
          {/* The count, big, over the picture */}
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-2xl bg-black/70 px-6 py-2 text-center text-white shadow-lg">
            <p className="text-[11px] font-medium tracking-wide uppercase opacity-80">{held ? "Held" : "Items"}</p>
            <p className="text-5xl leading-none font-bold tabular-nums">{formatQty(count)}</p>
          </div>
          {picking && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-amber-500 px-4 py-1.5 text-sm font-medium text-white">
              Tap one single item
            </p>
          )}
        </div>

        {!live && (
          <div className="px-6 py-12 text-center text-slate-300">
            <Camera className="mx-auto size-10 text-brand-400" />
            <p className="mt-3 text-lg font-semibold text-white">Live item count</p>
            <ul className="mx-auto mt-4 max-w-md space-y-1.5 text-left text-sm">
              <li>• Items on a plain floor or sheet in a different colour from them.</li>
              <li>• One layer, not stacked; a small gap between them counts best.</li>
              <li>• Hold the phone straight above, with the floor showing all round the edges.</li>
            </ul>
            <Button className="mt-6" onClick={start} disabled={status === "starting"}>
              <Camera /> {status === "starting" ? "Opening camera…" : "Start camera"}
            </Button>
          </div>
        )}
      </Card>

      {live && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={held ? "primary" : "outline"} onClick={() => setHeld((h) => !h)}>
            {held ? <Play /> : <Pause />} {held ? "Count again" : "Hold count"}
          </Button>
          <Button variant={picking ? "secondary" : "outline"} onClick={() => setPicking((p) => !p)} title="Tap one single item so touching items are split by its size">
            <Crosshair /> {unitArea ? "Set item size again" : "Set one item's size"}
          </Button>
          {unitArea && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setUnitArea(undefined);
                recent.current = [];
              }}
            >
              <RotateCcw /> Auto size
            </Button>
          )}
          <div className="flex items-center gap-2 text-sm text-slate-700">
            Items are
            <FilterTabs<Polarity>
              value={polarity}
              onChange={(v) => {
                setPolarity(v);
                recent.current = [];
              }}
              options={[
                { value: "auto", label: "Auto" },
                { value: "light", label: "Lighter" },
                { value: "dark", label: "Darker" },
              ]}
            />
            <span className="text-xs text-slate-500">than the floor</span>
          </div>
          <label className="flex min-w-56 flex-1 items-center gap-3 text-sm text-slate-700">
            Sensitivity
            <input
              type="range"
              min={-50}
              max={50}
              step={5}
              value={sensitivity}
              onChange={(e) => {
                setSensitivity(Number(e.target.value));
                recent.current = [];
              }}
              className="flex-1 accent-brand-600"
              aria-label="Sensitivity: left finds fewer (ignores floor marks), right finds more (faint items)"
            />
            <span className="w-8 text-right text-slate-500 tabular-nums">{sensitivity > 0 ? `+${sensitivity}` : sensitivity}</span>
          </label>
          <p className="w-full text-xs text-slate-500">
            Blue = one item · orange ×2 = touching items counted by size. Keep every item fully inside the picture: anything touching its edge
            isn&apos;t counted. Stacked items or items the colour of the floor can&apos;t be counted by the camera.
          </p>
        </div>
      )}
    </div>
  );
}

/** Numbers on each item found, drawn on the clear layer over the video */
function drawOverlay(canvas: HTMLCanvasElement, width: number, height: number, blobs: CountBlob[]) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  const radius = Math.max(9, Math.round(Math.max(width, height) / 45));
  let n = 0;
  for (const b of blobs) {
    n += b.count;
    const text = b.count > 1 ? `×${b.count}` : String(n);
    ctx.beginPath();
    ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = b.count > 1 ? "rgba(217,119,6,0.9)" : "rgba(10,99,201,0.9)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "white";
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.round(radius * (text.length > 2 ? 0.8 : 1))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, b.x, b.y + 1);
  }
}
