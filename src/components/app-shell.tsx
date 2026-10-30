"use client";

import {
  ArchiveRestore,
  CalendarDays,
  ClipboardList,
  Gift,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  Menu,
  Package,
  PackageX,
  Receipt,
  RotateCcw,
  Route,
  Store,
  TrendingUp,
  Trophy,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, Suspense, useEffect, useState, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { LogoMark } from "@/components/logo";
import { ChequeReminder } from "@/components/orders/cheque-reminder";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** `also`: pages under this path count as this one (highlighted in the sidebar) */
type NavItem = { href: string; label: string; icon: LucideIcon; also?: string };

const nav: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Sales",
    items: [
      { href: "/routes", label: "Routes", icon: Route },
      { href: "/stores", label: "Stores", icon: Store },
      // Bills (/sales/…) open from here
      { href: "/invoices", label: "Daily Invoices", icon: CalendarDays, also: "/sales" },
      { href: "/free-issues", label: "Free Issues", icon: Gift },
      { href: "/top-items", label: "Top Selling Items", icon: Trophy },
      { href: "/payments", label: "Payments", icon: HandCoins },
      { href: "/cheques", label: "Cheques & Credit", icon: Landmark },
    ],
  },
  {
    title: "Accounts",
    items: [
      { href: "/profit", label: "Profit", icon: TrendingUp },
      { href: "/expenses", label: "Expenses", icon: Receipt },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { href: "/orders", label: "Purchase Orders", icon: ClipboardList },
      { href: "/order-items", label: "Order Items", icon: ListChecks },
      { href: "/order-differences", label: "Missing & Not Ordered", icon: PackageX },
    ],
  },
  {
    title: "Warehouse",
    items: [
      { href: "/stock", label: "Stock", icon: Warehouse },
      { href: "/returns", label: "Return Items", icon: ArchiveRestore },
      { href: "/items", label: "Items", icon: Package },
      { href: "/locations", label: "Stock Locations", icon: MapPin },
    ],
  },
];

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      {nav.map((section) => (
        <div key={section.title ?? "main"} className="flex flex-col gap-1">
          {section.title && (
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-brand-300 uppercase">{section.title}</p>
          )}
          {section.items.map(({ href, label, icon: Icon, also }) => {
            const under = (path: string) => pathname === path || pathname?.startsWith(path + "/");
            const active = pathname !== null && (href === "/" ? pathname === "/" : under(href) || (!!also && under(also)));
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  // Orange bar on the current page, like the logo's swoosh
                  active
                    ? "bg-white/15 text-white shadow-[inset_3px_0_0_var(--color-accent-500)]"
                    : "text-brand-100 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="size-4.5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// usePathname suspends on dynamic routes (e.g. /orders/[id]) under cacheComponents,
// so the active-state version is wrapped in Suspense with a plain fallback.
function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavLinks pathname={pathname} onNavigate={onNavigate} />;
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
    <div className="flex items-center gap-2 border-t border-white/10 px-2 pt-4">
      <span className="min-w-0 flex-1 truncate text-xs text-brand-200" title={userEmail}>
        {userEmail}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
      >
        <LogOut className="size-3.5" /> {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function SidebarContent({ onNavigate, onReset }: { onNavigate?: () => void; onReset: () => void }) {
  const canResetDemo = useAppStore((s) => s.canResetDemo);
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-5">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-3 px-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white">
          <LogoMark size={32} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-white">Ananda Stores</span>
          <span className="block text-xs text-brand-200">Store Management</span>
        </span>
      </Link>

      <Suspense fallback={<NavLinks pathname={null} />}>
        <ActiveNavLinks onNavigate={onNavigate} />
      </Suspense>

      <div className="mt-auto flex flex-col gap-4">
        {canResetDemo && (
          <div className="rounded-lg bg-white/5 p-3 text-xs text-brand-100">
            <p className="font-medium text-white">Demo mode</p>
            <p className="mt-1 text-brand-200">Sample data, shared by everyone using the app.</p>
            <button type="button" onClick={onReset} className="mt-2 inline-flex items-center gap-1.5 font-medium text-white hover:underline">
              <RotateCcw className="size-3.5" /> Reset demo data
            </button>
          </div>
        )}
        <UserBox />
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-sm text-slate-500">
      <div className="flex items-center gap-3">
        <span className="size-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        Loading store data…
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-sm shadow-sm">
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
  const loaded = useAppStore((s) => s.loaded);
  const loadError = useAppStore((s) => s.loadError);
  const saving = useAppStore((s) => s.saving);
  const reload = useAppStore((s) => s.reload);
  const resetDemoData = useAppStore((s) => s.resetDemoData);

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
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [reload]);

  const [mobileOpen, setMobileOpen] = useState(false);
  // Lives here, not in the sidebar: a dialog inside the fixed sidebar would be trapped
  // under the page content.
  const [confirmReset, setConfirmReset] = useState(false);
  const openReset = () => {
    setMobileOpen(false);
    setConfirmReset(true);
  };

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-brand-800 lg:block print:hidden">
        <SidebarContent onReset={openReset} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 bg-brand-800 shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-5 right-3 rounded-md p-1 text-brand-100 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} onReset={openReset} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden print:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <LogoMark size={24} /> Ananda Stores
          </span>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {loaded ? (
            <>
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
          className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg print:hidden"
        >
          <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Saving…
        </div>
      )}
      {/* Bottom: the pages' buttons are in the bar at the top, and a message mustn't cover them */}
      <Toaster position="bottom-center" richColors closeButton />
    </div>
  );
}
