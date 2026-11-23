"use client";

import {
  ArchiveRestore,
  CalendarDays,
  Camera,
  ChevronDown,
  ClipboardList,
  Gift,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Loader2,
  ShieldCheck,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Package,
  PackageX,
  Receipt,
  RotateCcw,
  Route,
  Search,
  Store,
  Sun,
  TrendingUp,
  Trophy,
  Warehouse,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, Suspense, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { Toaster } from "sonner";
import { toast } from "@/lib/toast";
import { LogoMark } from "@/components/logo";
import { CommandMenu, type JumpPage } from "@/components/command-menu";
import { ChequeReminder } from "@/components/orders/cheque-reminder";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions";
import { useAppStore } from "@/lib/store";
import { setTheme, useThemeChoice, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** `also`: pages under this path count as this one (highlighted in the sidebar) */
type NavItem = { href: string; label: string; icon: LucideIcon; also?: string };
/** `open`: shown open until the user folds it (the group of the page you're on always opens) */
type NavGroup = { id: string; title: string | null; open?: boolean; items: NavItem[] };

// Grouped by the day's work: what's used every day first, setup and reports folded away
const nav: NavGroup[] = [
  { id: "home", title: null, items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    id: "daily",
    title: "Daily work",
    open: true,
    items: [
      // Bills (/sales/…) open from here
      { href: "/invoices", label: "Daily Invoices", icon: CalendarDays, also: "/sales" },
      { href: "/payments", label: "Payments", icon: HandCoins },
      { href: "/cheques", label: "Cheques & Credit", icon: Landmark },
      { href: "/expenses", label: "Expenses", icon: Receipt },
      // Store balances and statements are looked up every day
      { href: "/stores", label: "Stores", icon: Store },
    ],
  },
  {
    id: "stock",
    title: "Stock & purchasing",
    open: true,
    items: [
      { href: "/stock", label: "Stock", icon: Warehouse },
      { href: "/orders", label: "Purchase Orders", icon: ClipboardList },
      { href: "/order-items", label: "Order Items", icon: ListChecks },
      { href: "/order-differences", label: "Missing & Not Ordered", icon: PackageX },
      { href: "/counter", label: "Item Counter", icon: Camera },
    ],
  },
  {
    id: "claims",
    title: "Returns & claims",
    open: true,
    items: [
      { href: "/returns", label: "Return Items", icon: ArchiveRestore },
      { href: "/free-issues", label: "Free Issues", icon: Gift },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    items: [
      { href: "/profit", label: "Profit", icon: TrendingUp },
      { href: "/top-items", label: "Top Selling Items", icon: Trophy },
    ],
  },
  {
    id: "setup",
    title: "Setup",
    items: [
      { href: "/routes", label: "Routes", icon: Route },
      { href: "/items", label: "Items", icon: Package },
      { href: "/locations", label: "Stock Locations", icon: MapPin },
      { href: "/checks", label: "Data Checks", icon: ShieldCheck },
    ],
  },
];

/** Every page in the sidebar, for Jump to (Ctrl+K) */
const jumpPages: JumpPage[] = nav.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, icon: i.icon, group: g.title ?? "Home" })));

/** Opens Jump to (Ctrl+K) from anywhere: the sidebar's search box and the keyboard shortcut */
let openJump: () => void = () => {};

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The search box at the top of the sidebar: opens Jump to */
function JumpButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        openJump();
      }}
      className="flex h-9 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-[13px] text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-700 pointer-coarse:h-11"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 truncate">Search or jump to…</span>
      <kbd className="rounded border border-slate-200 bg-white px-1.5 py-px font-sans text-[10.5px] font-medium text-slate-500" suppressHydrationWarning>
        {isMac() ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}

const FOLDED_KEY = "nav-folded";
const defaultFolded = () => Object.fromEntries(nav.filter((g) => g.title).map((g) => [g.id, !g.open]));

/** Folded groups as saved; kept in memory too when the browser can't store it (private window) */
let foldedMemory = "";
const foldedListeners = new Set<() => void>();
function readFolded() {
  try {
    return localStorage.getItem(FOLDED_KEY) ?? foldedMemory;
  } catch {
    return foldedMemory;
  }
}

/** Which groups are folded: remembered in this browser (a convenience; it starts from the defaults without it) */
function useFolded() {
  const raw = useSyncExternalStore(
    (onChange) => {
      foldedListeners.add(onChange);
      return () => foldedListeners.delete(onChange);
    },
    readFolded,
    () => "",
  );
  const folded = useMemo<Record<string, boolean>>(() => {
    try {
      return { ...defaultFolded(), ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return defaultFolded();
    }
  }, [raw]);
  const toggle = (id: string) => {
    foldedMemory = JSON.stringify({ ...folded, [id]: !folded[id] });
    try {
      localStorage.setItem(FOLDED_KEY, foldedMemory);
    } catch {
      // Not remembered after a reload; still works for now
    }
    foldedListeners.forEach((l) => l());
  };
  return { folded, toggle };
}

/**
 * The sidebar link just clicked, until its page opens (`from` = the page it was clicked on).
 * The page can take a moment to open, so the click shows at once: the item lights up with a
 * spinner, and a bar runs along the top of the page.
 */
type PendingNav = { href: string; from: string | null } | null;
let pendingNav: PendingNav = null;
const pendingListeners = new Set<() => void>();
function setPendingNav(next: PendingNav) {
  pendingNav = next;
  pendingListeners.forEach((l) => l());
}
function usePendingNav() {
  return useSyncExternalStore(
    (onChange) => {
      pendingListeners.add(onChange);
      return () => pendingListeners.delete(onChange);
    },
    () => pendingNav,
    () => null,
  );
}

/** The link clicked, while its page is still opening (null once it has, or if nothing is opening) */
function useOpening(pathname: string | null) {
  const pending = usePendingNav();
  return pending && pending.from === pathname ? pending.href : null;
}

/** Jump to (Ctrl+K): opening a result shows the same "opening" feedback as a sidebar click */
function JumpTo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <CommandMenu
      pages={jumpPages}
      open={open}
      onClose={onClose}
      onGo={(href) => {
        if (href !== pathname) setPendingNav({ href, from: pathname });
      }}
    />
  );
}

/** A thin bar running along the top of the page while a page opens */
function NavProgress() {
  const opening = useOpening(usePathname());
  if (!opening) return null;
  return (
    <div role="status" aria-label="Opening the page" className="fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden bg-accent-100 print:hidden">
      <div className="h-full w-1/3 animate-[nav-progress_1s_ease-in-out_infinite] bg-linear-to-r from-accent-400 to-accent-600" />
    </div>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  const { folded, toggle } = useFolded();
  const opening = useOpening(pathname);
  const under = (path: string) => pathname === path || pathname?.startsWith(path + "/");
  const isOn = ({ href, also }: NavItem) => pathname !== null && (href === "/" ? pathname === "/" : under(href) || (!!also && under(also)));
  // The clicked item shows as the current one straight away
  const isActive = (item: NavItem) => (opening ? item.href === opening : isOn(item));

  function go(e: MouseEvent<HTMLAnchorElement>, item: NavItem) {
    // A new tab / window opens elsewhere: nothing to show here
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (pathname !== item.href) setPendingNav({ href: item.href, from: pathname });
    onNavigate?.();
  }

  return (
    <nav className="flex flex-col gap-3">
      {nav.map((group) => {
        const hasActive = group.items.some(isActive);
        // The group of the page you're on stays open
        const open = !group.title || hasActive || !folded[group.id];
        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.title && (
              <button
                type="button"
                onClick={() => toggle(group.id)}
                disabled={hasActive}
                aria-expanded={open}
                className="group/head flex items-center justify-between rounded-md px-3 pt-1 pb-1 text-xs font-medium text-slate-400 transition-colors hover:text-slate-700 disabled:cursor-default disabled:hover:text-slate-400"
              >
                <span>{group.title}</span>
                <span className="flex items-center gap-1.5">
                  {!open && <span className="rounded-md bg-slate-100 px-1.5 font-medium text-slate-500 tabular-nums">{group.items.length}</span>}
                  {!hasActive && <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />}
                </span>
              </button>
            )}
            {open &&
              group.items.map((item) => {
                const { href, label, icon: Icon } = item;
                const active = isActive(item);
                const loading = opening === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={(e) => go(e, item)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98] pointer-coarse:h-11",
                      active
                        ? "bg-linear-to-r from-brand-600 to-brand-500 text-white shadow-[0_8px_18px_-8px_rgb(36_73_216/0.7)]"
                        : "text-slate-600 hover:bg-brand-50/70 hover:text-brand-800",
                    )}
                  >
                    <Icon className={cn("size-[18px] shrink-0 transition-colors", active ? "text-white" : "text-slate-400 group-hover:text-brand-600")} strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {loading && <Loader2 className={cn("size-4 shrink-0 animate-spin", active ? "text-white" : "text-brand-600")} aria-label="Opening" />}
                  </Link>
                );
              })}
          </div>
        );
      })}
    </nav>
  );
}

// usePathname suspends on dynamic routes (e.g. /orders/[id]) under cacheComponents,
// so the active-state version is wrapped in Suspense with a plain fallback.
function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavLinks pathname={pathname} onNavigate={onNavigate} />;
}

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Light, System (the computer's setting) or Dark */
function ThemeSwitch() {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-0.5 rounded-lg bg-slate-100 p-1">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          onClick={() => setTheme(value)}
          title={value === "system" ? "Follow the computer's light / dark setting" : `${label} theme`}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
            choice === value ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(16_18_27/0.1)]" : "text-slate-500 hover:text-slate-900",
          )}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

/** Who is signed in, and Sign out. A full page load of /login, so no data is left in the browser. */
function UserBox() {
  const userEmail = useAppStore((s) => s.userEmail);
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    const result = await signOut().catch(() => null);
    if (result?.ok) return window.location.replace("/login");
    setSigningOut(false);
    toast.error(result?.error ?? "Couldn't reach the server. Check the internet connection and try again.");
  };
  return (
    <div className="flex items-center gap-2.5 border-t border-slate-100 px-1 pt-3">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-500 bg-linear-to-br from-accent-400 to-accent-600 text-xs font-semibold text-white uppercase shadow-[0_4px_10px_-4px_rgb(253_106_4/0.7)]"
        aria-hidden
      >
        {userEmail?.[0] ?? "?"}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={userEmail}>
        {userEmail}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
        title="Sign out"
      >
        <LogOut className="size-3.5" /> {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function SidebarContent({ onNavigate, onReset }: { onNavigate?: () => void; onReset: () => void }) {
  const canResetDemo = useAppStore((s) => s.canResetDemo);
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4 [scrollbar-width:thin]">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-slate-50">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 ring-1 ring-brand-100">
          <LogoMark size={26} />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-[15px] font-bold tracking-tight text-brand-900">Ananda Stores</span>
          <span className="block text-[10.5px] font-semibold tracking-[0.14em] text-accent-600 uppercase">Raigam distributor</span>
        </span>
      </Link>

      <JumpButton onNavigate={onNavigate} />

      <Suspense fallback={<NavLinks pathname={null} />}>
        <ActiveNavLinks onNavigate={onNavigate} />
      </Suspense>

      <div className="mt-auto flex flex-col gap-3">
        {canResetDemo && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-900">Demo mode</p>
            <p className="mt-1 text-slate-500">Sample data, shared by everyone using the app.</p>
            <button type="button" onClick={onReset} className="mt-2 inline-flex items-center gap-1.5 font-medium text-slate-900 underline-offset-2 hover:underline">
              <RotateCcw className="size-3.5" /> Reset demo data
            </button>
          </div>
        )}
        <ThemeSwitch />
        <UserBox />
      </div>
    </div>
  );
}

/** The browser's online / offline state */
function useOnline() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * A strip at the top of every page when the figures may be old: no internet, or the
 * last refresh failed. Without it people quote balances and stock from old data.
 */
function StaleBanner({ online, refreshFailed, onRetry }: { online: boolean; refreshFailed: boolean; onRetry: () => void }) {
  if (online && !refreshFailed) return null;
  return (
    <div role="alert" className="-mx-4 -mt-4 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 sm:-mx-5 sm:px-5 lg:mx-0 lg:mt-0 lg:mb-5 lg:rounded-2xl lg:border lg:px-5 print:hidden">
      <WifiOff className="size-4 shrink-0" />
      <span className="flex-1">
        {online
          ? "Couldn't refresh the data. Balances and stock on screen may be out of date."
          : "No internet. Balances and stock on screen may be out of date, and changes can't be saved."}
      </span>
      {online && (
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-sm text-slate-500">
      <div className="flex items-center gap-3">
        <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
        Loading store data…
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-sm shadow-raised">
        <p className="font-semibold text-slate-900">{message}</p>
        <p className="mt-2 text-slate-600">
          Check the internet connection. On Supabase&apos;s free plan the database pauses after 7 days without use: open the
          Supabase dashboard and restore the project, then try again.
        </p>
        <Button className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useThemeChoice();
  const loaded = useAppStore((s) => s.loaded);
  const loadError = useAppStore((s) => s.loadError);
  const saving = useAppStore((s) => s.saving);
  const reload = useAppStore((s) => s.reload);
  const resetDemoData = useAppStore((s) => s.resetDemoData);
  const online = useOnline();

  // Load on start, and again when the user comes back to the app since others may have made
  // changes: from another tab (visibilitychange) or another window, e.g. the editor (focus)
  useEffect(() => {
    let lastLoad = 0;
    const load = () => {
      // Coming back can fire both events; one reload is enough
      if (Date.now() - lastLoad < 2000) return;
      lastLoad = Date.now();
      startTransition(() => reload());
    };
    load();
    const onBack = () => {
      if (document.visibilityState === "visible" && !useAppStore.getState().saving) load();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    // Internet back: fetch fresh figures straight away
    window.addEventListener("online", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("online", onBack);
    };
  }, [reload]);

  // Every number box: the mouse wheel scrolls the page instead of quietly changing the number
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === "number" && document.activeElement === el) el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  // Ctrl+K / ⌘K opens Jump to on any page (and closes it again)
  useEffect(() => {
    openJump = () => setJumpOpen(true);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJumpOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openJump = () => {};
    };
  }, []);
  // Lives here, not in the sidebar: a dialog inside the fixed sidebar would be trapped
  // under the page content.
  const [confirmReset, setConfirmReset] = useState(false);
  const openReset = () => {
    setMobileOpen(false);
    setConfirmReset(true);
  };

  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
      {/* Desktop sidebar */}
      {/* Linear-style: a light sidebar on the app's grey, the page on a white panel beside it */}
      <aside className="fixed inset-y-3 left-3 hidden w-60 overflow-hidden rounded-2xl bg-white shadow-card lg:block print:hidden">
        <SidebarContent onReset={openReset} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 rounded-r-2xl bg-white shadow-float">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 z-10 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} onReset={openReset} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[16.5rem] print:pl-0">
        <header className="sticky top-0 z-30 flex h-[57px] items-center gap-3 border-b border-slate-200/70 bg-white px-4 text-slate-900 lg:hidden print:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <span className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white">
              <LogoMark size={20} />
            </span>
            Ananda Stores
          </span>
        </header>

        <main className="relative isolate mx-auto w-full max-w-[1680px] min-w-0 flex-1 px-4 py-4 sm:px-5 lg:px-8 lg:py-5 print:m-0 print:max-w-none print:p-0">
          {loaded ? (
            <>
              <StaleBanner online={online} refreshFailed={!!loadError} onRetry={() => startTransition(() => reload())} />
              {/* Raigam cheques about to be deposited, on every page */}
              <ChequeReminder />
              {children}
            </>
          ) : loadError ? (
            <LoadError message={loadError} onRetry={() => startTransition(() => reload())} />
          ) : (
            <LoadingScreen />
          )}
        </main>
      </div>

      {loaded && (
        <Suspense fallback={null}>
          <JumpTo open={jumpOpen} onClose={() => setJumpOpen(false)} />
        </Suspense>
      )}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          const result = await resetDemoData();
          setConfirmReset(false);
          if (result.ok) toast.success("Demo data restored");
          else toast.error(result.error);
        }}
        title="Reset demo data?"
        message="All routes, stores, store orders, payments, purchase orders, stock, items and locations in the database will be replaced with the original sample data, for everyone using the app. Your changes will be lost."
        confirmLabel="Reset data"
      />
      {saving && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full lg:ml-30 bg-slate-900 px-3.5 py-2 text-xs font-medium text-white shadow-float print:hidden"
        >
          <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Saving…
        </div>
      )}
      {/* Top right, under the pinned page header: clear of the page buttons and the bottom Save bars */}
      <Toaster theme={theme} position="top-right" offset={{ top: 72, right: 16 }} richColors closeButton visibleToasts={3} duration={4500} />
    </div>
  );
}
