"use client";

import { useEffect, useRef, useState } from "react";
import type { ProfitFigures } from "@/lib/profit";
import { formatCompact, formatMoney } from "@/lib/utils";

// Single-series column chart of monthly net profit. Polarity is encoded twice:
// above/below the zero baseline AND blue (profit) / red (loss) - validated pair.
const COLORS = {
  profit: "#2a78d6",
  loss: "#e34948",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  muted: "#898781",
  secondary: "#52514e",
  primary: "#0b0b0b",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEIGHT = 240;
const M = { top: 22, right: 8, bottom: 28, left: 48 };

function niceTicks(min: number, max: number) {
  if (min === max) max = min + 1000;
  const rough = (max - min) / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** Column with a 4px rounded data-end and a square base on the zero line */
function barPath(x: number, w: number, base: number, end: number) {
  const h = Math.abs(end - base);
  const r = Math.min(4, h, w / 2);
  const dir = end < base ? 1 : -1; // 1 = grows up
  const c = end + dir * r;
  return `M${x},${base} L${x},${c} Q${x},${end} ${x + r},${end} L${x + w - r},${end} Q${x + w},${end} ${x + w},${c} L${x + w},${base} Z`;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function NetProfitChart({
  data,
  year,
  selected,
  onSelect,
}: {
  data: ProfitFigures[];
  year: number;
  /** 1-12, or null for the whole year */
  selected: number | null;
  onSelect: (month: number | null) => void;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const values = data.map((d) => d.net);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const y = (v: number) => M.top + ((hi - v) / (hi - lo || 1)) * plotH;
  const band = plotW / 12;
  const barW = Math.min(24, band * 0.56);
  const zero = y(0);

  // Label sparingly: the selected month, else the best month
  const labelled =
    selected !== null ? selected - 1 : values.some((v) => v !== 0) ? values.indexOf(Math.max(...values)) : -1;
  const hovered = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`Net profit by month, ${year}`} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.baseline : COLORS.grid} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={COLORS.muted} className="tabular-nums">
                {formatCompact(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const cx = M.left + band * i + band / 2;
            const has = d.net !== 0;
            const dim = (selected !== null && selected !== i + 1) || (hover !== null && hover !== i);
            return (
              <g key={i}>
                {has && (
                  <path
                    d={barPath(cx - barW / 2, barW, zero, y(d.net))}
                    fill={d.net >= 0 ? COLORS.profit : COLORS.loss}
                    opacity={dim ? 0.35 : 1}
                    style={{ transition: "opacity 120ms" }}
                  />
                )}
                {i === labelled && has && (
                  <text
                    x={cx}
                    y={d.net >= 0 ? y(d.net) - 6 : y(d.net) + 14}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={COLORS.secondary}
                  >
                    {formatCompact(d.net)}
                  </text>
                )}
                <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill={selected === i + 1 ? COLORS.primary : COLORS.muted} fontWeight={selected === i + 1 ? 600 : 400}>
                  {MONTHS[i]}
                </text>
                {/* Hit target: the whole month column, bigger than the bar */}
                <rect
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={plotH + M.bottom}
                  fill="transparent"
                  className="cursor-pointer outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`${MONTHS[i]} ${year}: net ${d.net < 0 ? `loss ${formatMoney(-d.net)}` : `profit ${formatMoney(d.net)}`}. ${selected === i + 1 ? "Selected" : "Select month"}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect(selected === i + 1 ? null : i + 1)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(selected === i + 1 ? null : i + 1);
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}

      {hovered && hover !== null && width > 0 && (
        <div
          className="pointer-events-none absolute z-10 w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(M.left + band * hover + band / 2 - 96, 0), width - 192),
            top: 0,
          }}
        >
          <p className="text-slate-500">
            {MONTHS[hover]} {year}
          </p>
          <p className="mt-0.5 flex items-center gap-2">
            <span className="h-0.5 w-3 rounded" style={{ background: hovered.net >= 0 ? COLORS.profit : COLORS.loss }} aria-hidden />
            <span className="text-sm font-semibold text-slate-900 tabular-nums">
              {hovered.net < 0 ? `− ${formatMoney(-hovered.net)}` : formatMoney(hovered.net)}
            </span>
            <span className="text-slate-500">net {hovered.net >= 0 ? "profit" : "loss"}</span>
          </p>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-500">
            <dt>Sales</dt>
            <dd className="text-right font-medium text-slate-800 tabular-nums">{formatMoney(hovered.sales)}</dd>
            <dt>Gross profit</dt>
            <dd className="text-right font-medium text-slate-800 tabular-nums">{formatMoney(hovered.gross)}</dd>
            <dt>Expenses</dt>
            <dd className="text-right font-medium text-slate-800 tabular-nums">{formatMoney(hovered.expenses)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
