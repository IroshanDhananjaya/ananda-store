"use client";

import { ClipboardList, CornerDownLeft, FileText, Route as RouteIcon, Search, Store, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAppStore } from "@/lib/store";
import { cn, formatDate } from "@/lib/utils";

/** A page from the sidebar */
export type JumpPage = { href: string; label: string; icon: LucideIcon; group: string };

type Hit = { key: string; href: string; label: string; detail?: string; icon: LucideIcon; group: string };

/** Results per group while typing */
const PER_GROUP = 6;

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text: string, ws: string[]) => {
  const t = text.toLowerCase();
  const squashed = t.replace(/[^a-z0-9]/g, "");
  return ws.every((w) => t.includes(w) || squashed.includes(w.replace(/[^a-z0-9]/g, "")));
};

/**
 * Jump to anything: Ctrl+K (⌘K on a Mac) or the search box in the sidebar. Type part of a page,
 * store, bill number, Raigam invoice number, purchase order or route; ↑ ↓ to choose, Enter to open.
 */
export function CommandMenu({ pages, open, onClose, onGo }: { pages: JumpPage[]; open: boolean; onClose: () => void; onGo: (href: string) => void }) {
  if (!open) return null;
  return <CommandPanel pages={pages} onClose={onClose} onGo={onGo} />;
}

function CommandPanel({ pages, onClose, onGo }: { pages: JumpPage[]; onClose: () => void; onGo: (href: string) => void }) {
  const router = useRouter();
  const shops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const orders = useAppStore((s) => s.orders);
  const routes = useAppStore((s) => s.routes);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const hits = useMemo<Hit[]>(() => {
    const ws = words(query);
    const pageHits: Hit[] = pages
      .filter((p) => matches(`${p.label} ${p.group}`, ws))
      .map((p) => ({ key: `p:${p.href}`, href: p.href, label: p.label, detail: p.group, icon: p.icon, group: "Pages" }));
    if (ws.length === 0) return pageHits;
    const shopName = new Map(shops.map((s) => [s.id, s.shopName]));
    const take = <T,>(list: T[], text: (x: T) => string, hit: (x: T) => Hit) => {
      const out: Hit[] = [];
      for (const x of list) {
        if (out.length >= PER_GROUP) break;
        if (matches(text(x), ws)) out.push(hit(x));
      }
      return out;
    };
    return [
      ...pageHits,
      ...take(
        shops,
        (s) => `${s.shopName} ${s.shopCode} ${s.town} ${s.ownerName} ${s.phone}`,
        (s) => ({ key: `s:${s.id}`, href: `/stores/${s.id}`, label: s.shopName, detail: [s.shopCode, s.town].filter(Boolean).join(" · "), icon: Store, group: "Stores" }),
      ),
      // Newest bills first
      ...take(
        [...sales].sort((a, b) => b.date.localeCompare(a.date)),
        (b) => `${b.saleNo} ${b.invoiceNo} ${shopName.get(b.shopId) ?? ""}`,
        (b) => ({
          key: `b:${b.id}`,
          href: `/sales/${b.id}`,
          label: [b.saleNo, b.invoiceNo].filter(Boolean).join(" · "),
          detail: `${shopName.get(b.shopId) ?? "Unknown store"} · ${formatDate(b.date)}`,
          icon: FileText,
          group: "Bills",
        }),
      ),
      ...take(
        [...orders].sort((a, b) => b.orderId.localeCompare(a.orderId)),
        (o) => o.orderId,
        (o) => ({ key: `o:${o.id}`, href: `/orders/${o.id}`, label: o.orderId, detail: `Ordered ${formatDate(o.orderDate)}`, icon: ClipboardList, group: "Purchase orders" }),
      ),
      ...take(
        routes,
        (r) => `${r.routeName} ${r.routeCode} ${r.area}`,
        (r) => ({ key: `r:${r.id}`, href: `/routes/${r.id}`, label: r.routeName, detail: [r.routeCode, r.area].filter(Boolean).join(" · "), icon: RouteIcon, group: "Routes" }),
      ),
    ];
  }, [query, pages, shops, sales, orders, routes]);

  const current = Math.min(active, Math.max(0, hits.length - 1));

  // Keep the chosen row in view
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function go(hit: Hit | undefined) {
    if (!hit) return;
    onGo(hit.href);
    router.push(hit.href);
    onClose();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[current]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 pt-[12vh] print:hidden">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Jump to" className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-float">
        <div className="flex items-center gap-3 border-b border-slate-200/80 px-4">
          <Search className="size-5 shrink-0 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, store, bill no., invoice no., order…"
            className="h-14 w-full bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={hits[current] ? `${listId}-${current}` : undefined}
          />
          <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 sm:block">Esc</kbd>
        </div>
        <ul ref={listRef} id={listId} role="listbox" className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
          {hits.length === 0 && <li className="px-3 py-10 text-center text-sm text-slate-500">Nothing found for “{query}”</li>}
          {hits.map((h, i) => {
            const Icon = h.icon;
            const first = i === 0 || hits[i - 1].group !== h.group;
            return (
              <li key={h.key} role="presentation">
                {first && <p className="px-3 pt-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-slate-400 uppercase">{h.group}</p>}
                <div
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === current}
                  onMouseMove={() => i !== current && setActive(i)}
                  onClick={() => go(h)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
                    i === current ? "bg-brand-50 text-brand-900" : "text-slate-700",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg border",
                      i === current ? "border-brand-200 bg-white text-brand-600" : "border-slate-200 bg-slate-50 text-slate-500",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.label}</span>
                    {h.detail && <span className="block truncate text-xs text-slate-500">{h.detail}</span>}
                  </span>
                  {i === current && <CornerDownLeft className="size-4 shrink-0 text-brand-500" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-slate-200/80 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500">
          <span>
            <kbd className="font-sans font-semibold">↑ ↓</kbd> choose
          </span>
          <span>
            <kbd className="font-sans font-semibold">Enter</kbd> open
          </span>
          <span className="ml-auto">
            <kbd className="font-sans font-semibold">Ctrl K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
