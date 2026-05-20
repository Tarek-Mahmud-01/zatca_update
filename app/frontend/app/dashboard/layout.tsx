"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { EnvBadge } from "../../components/EnvSwitcher";
import { HeaderActions } from "../../components/HeaderActions";
import { NotificationFeed } from "../../components/NotificationFeed";
import { Toaster } from "../../components/Toaster";
import { handleAuthExpired, isTokenLive, subscribeAuthExpired } from "../../lib/token";

const NAV: ReadonlyArray<{ href: string; label: string; group?: string }> = [
  { href: "/dashboard",                       label: "Overview" },
  { href: "/dashboard/customers",             label: "Customers",  group: "Catalog" },
  { href: "/dashboard/categories",            label: "Categories", group: "Catalog" },
  { href: "/dashboard/products",              label: "Products",   group: "Catalog" },
  { href: "/dashboard/invoices",              label: "Invoices",   group: "Billing" },
  { href: "/dashboard/invoices/batch",        label: "Batch upload", group: "Billing" },
  { href: "/dashboard/settings/business",      label: "Business",         group: "Settings" },
  { href: "/dashboard/settings/currencies",    label: "Currencies",       group: "Settings" },
  { href: "/dashboard/settings/exchange-rates", label: "Exchange rates",   group: "Settings" },
  { href: "/dashboard/settings/organizations", label: "Organizations",    group: "Settings" },
  { href: "/dashboard/settings/branches",      label: "Branches",         group: "Settings" },
  { href: "/dashboard/onboarding",             label: "ZATCA onboarding", group: "Settings" },
  { href: "/dashboard/settings/api-target",    label: "API target",       group: "Settings" },
  { href: "/dashboard/settings/preferences",   label: "Preferences",      group: "Settings" },
  { href: "/dashboard/settings/users",         label: "Team members",     group: "Settings" },
  { href: "/dashboard/settings/account",       label: "Account",          group: "Settings" },
];

/**
 * Route-level auth gate — fast, no network round-trip.
 *
 * We trust the cookie's JWT for the upfront check by decoding its `exp`
 * claim locally. If the token is missing or already expired we bounce to
 * /login immediately, before any child page mounts. Otherwise we render
 * straight away — no "Verifying session…" flash on every refresh / HMR
 * rebuild.
 *
 * Server-side revocations and runtime expiry are caught by:
 *   - the SSE stream in <NotificationFeed/> (continuous canary)
 *   - the centralised 401 handler in `request<T>()`
 *
 * SSR returns `false` from isTokenLive() because document.cookie isn't
 * available — we render the loading shell on the server, then re-check on
 * the client. This is unavoidable when auth lives in a cookie read by JS.
 */
function useAuthGate(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (isTokenLive()) {
      setReady(true);
    } else {
      handleAuthExpired();   // no token or `exp` already in the past
    }
    // Cross-tab logout: when ANY other tab signs out (or has its session
    // killed), drop this one too. BroadcastChannel ⇒ instant, no polling.
    return subscribeAuthExpired();
  }, []);
  return ready;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const authed = useAuthGate();

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-sm text-[var(--color-fg-muted)]">Loading…</div>
      </div>
    );
  }

  function NavLinks({ onClick }: { onClick?: () => void }) {
    const groups = new Map<string, typeof NAV[number][]>();
    for (const n of NAV) {
      const k = n.group ?? "_";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(n);
    }
    return (
      <nav className="flex flex-col gap-5 text-sm">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group} className="flex flex-col gap-0.5">
            {group !== "_" && (
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-faint)]">
                {group}
              </div>
            )}
            {items.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onClick}
                  className={`relative px-3 py-2 rounded-md transition-colors
                    ${active
                      ? "bg-[var(--color-accent)] text-white font-semibold"
                      : "text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"}`}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0 h-0
                        border-y-[6px] border-y-transparent
                        border-l-[7px] border-l-[var(--color-warning)]"
                    />
                  )}
                  {n.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between px-4 sm:px-6 h-14">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              className="md:hidden btn btn-ghost !p-2"
              aria-label="Toggle navigation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <Link href="/dashboard" className="font-semibold text-[var(--color-fg)] tracking-tight">
              ZATCA <span className="text-[var(--color-fg-muted)] font-normal">Phase 2</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/settings/api-target" className="no-underline">
              <EnvBadge />
            </Link>
            <HeaderActions />
          </div>
        </div>
      </header>

      <div className="md:grid md:grid-cols-[240px_1fr]">
        <aside
          className={`
            ${navOpen ? "block" : "hidden"} md:block
            md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:overflow-y-auto
            bg-white border-r border-[var(--color-border)] px-3 py-5
          `}
        >
          <NavLinks onClick={() => setNavOpen(false)} />
        </aside>

        {/* Main — full width with comfortable padding */}
        <main className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 bg-white min-h-[calc(100vh-3.5rem)]">
          <div className="w-full">{children}</div>
        </main>
      </div>

      {/* Single SSE connection (drives notifications + auth health-check)
          and the bottom-right toast container. The queue tick lives on the
          backend arq worker — the frontend just listens for the
          invoice.cleared/reported/etc events that fire when it runs. */}
      <NotificationFeed />
      <Toaster />
    </div>
  );
}
