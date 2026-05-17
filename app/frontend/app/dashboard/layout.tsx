"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { EnvBadge } from "../../components/EnvSwitcher";
import { HeaderActions } from "../../components/HeaderActions";
import { NotificationFeed } from "../../components/NotificationFeed";
import { Toaster } from "../../components/Toaster";
import { AutoQueueTick } from "../../components/AutoQueueTick";

const NAV: ReadonlyArray<{ href: string; label: string; group?: string }> = [
  { href: "/dashboard",                       label: "Overview" },
  { href: "/dashboard/customers",             label: "Customers",  group: "Catalog" },
  { href: "/dashboard/categories",            label: "Categories", group: "Catalog" },
  { href: "/dashboard/products",              label: "Products",   group: "Catalog" },
  { href: "/dashboard/invoices",              label: "Invoices",   group: "Billing" },
  { href: "/dashboard/invoices/batch",        label: "Batch upload", group: "Billing" },
  { href: "/dashboard/settings/business",     label: "Business",     group: "Settings" },
  { href: "/dashboard/onboarding",            label: "ZATCA onboarding", group: "Settings" },
  { href: "/dashboard/settings/api-target",   label: "API target",   group: "Settings" },
  { href: "/dashboard/settings/preferences",  label: "Preferences",  group: "Settings" },
  { href: "/dashboard/settings/users",        label: "Team members", group: "Settings" },
  { href: "/dashboard/settings/account",      label: "Account",      group: "Settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

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

      {/* Single SSE connection + bottom-right toast container + queue tick */}
      <NotificationFeed />
      <AutoQueueTick />
      <Toaster />
    </div>
  );
}
