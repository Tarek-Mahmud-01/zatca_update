"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type Me } from "../lib/api-client";
import { getToken } from "../lib/token";
import {
  clearAll, markAllRead, useNotifications, type Notification,
} from "../lib/notifications";

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase())
    .slice(0, 2)
    .join("") || "?";
}

const TONE_DOT: Record<string, string> = {
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger:  "bg-[var(--color-danger)]",
  info:    "bg-[var(--color-fg-muted)]",
};

export function HeaderActions() {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);

  const { items: notifications, unread } = useNotifications();

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.me(token).then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(t)) {
        if (bellOpen) markAllRead();
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [bellOpen]);

  function signOut() {
    document.cookie = "token=; path=/; max-age=0; SameSite=Lax";
    window.location.href = "/login";
  }

  function toggleBell() {
    const next = !bellOpen;
    setBellOpen(next);
    if (!next) markAllRead();
    setMenuOpen(false);
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Notification bell */}
      <div ref={bellRef} className="relative">
        <button
          type="button"
          onClick={toggleBell}
          className="relative inline-flex items-center justify-center w-9 h-9 rounded-md text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)] transition-colors"
          aria-label="Notifications"
        >
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[var(--color-accent)] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        {bellOpen && (
          <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white border border-[var(--color-border)] rounded-lg shadow-lg z-40 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <div>
                <div className="text-sm font-semibold text-[var(--color-fg)]">Notifications</div>
                <div className="text-xs text-[var(--color-fg-muted)]">
                  {notifications.length === 0 ? "No activity yet" : `${notifications.length} recent`}
                </div>
              </div>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => { clearAll(); setBellOpen(false); }}
                  className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-sm text-[var(--color-fg-muted)]">
                  Live invoice events will appear here.
                </div>
              ) : (
                notifications.map((n) => (
                  <NotificationRow key={n.id} n={n} onNavigate={() => setBellOpen(false)} />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* User avatar dropdown */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => { setMenuOpen((v) => !v); setBellOpen(false); }}
          className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--color-fg)] text-white text-[11px] font-semibold">
            {me ? initials(me.email) : "·"}
          </span>
          <span className="hidden sm:flex flex-col items-start leading-tight">
            <span className="text-xs text-[var(--color-fg)] font-medium max-w-[140px] truncate">
              {me?.email ?? "—"}
            </span>
            <span className="text-[10px] text-[var(--color-fg-muted)] capitalize">
              {me?.role ?? ""}
            </span>
          </span>
          <span className="text-[var(--color-fg-muted)] hidden sm:inline-flex"><ChevronDownIcon /></span>
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-2 w-64 bg-white border border-[var(--color-border)] rounded-lg shadow-lg z-40 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <div className="text-sm font-semibold text-[var(--color-fg)] truncate">{me?.email ?? ""}</div>
              <div className="text-xs text-[var(--color-fg-muted)] truncate">{me?.tenant_name ?? ""}</div>
            </div>
            <nav className="p-1.5 flex flex-col gap-0.5 text-sm">
              <MenuLink href="/dashboard/settings/account">Account</MenuLink>
              <MenuLink href="/dashboard/settings/business">Business</MenuLink>
              <MenuLink href="/dashboard/settings/users">Team members</MenuLink>
              <MenuLink href="/dashboard/settings/api-target">API target</MenuLink>
              <MenuLink href="/dashboard/settings/preferences">Preferences</MenuLink>
            </nav>
            <div className="border-t border-[var(--color-border)] p-1.5">
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-1.5 rounded-md text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] focus-visible:bg-[var(--color-danger-soft)] focus-visible:outline-none"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationRow({ n, onNavigate }: { n: Notification; onNavigate: () => void }) {
  const dot = TONE_DOT[n.tone] ?? TONE_DOT.info;
  const inner = (
    <div className={`flex gap-3 px-4 py-3 border-b last:border-b-0 border-[var(--color-border-soft)] ${n.read ? "" : "bg-[var(--color-bg-muted)]"}`}>
      <span className={`inline-block w-2 h-2 rounded-full mt-1.5 shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--color-fg)] truncate">{n.title}</div>
        {n.body && (
          <div className="text-xs text-[var(--color-fg-2)] mt-0.5 break-words line-clamp-2">
            {n.body}
          </div>
        )}
        <div className="text-[10px] text-[var(--color-fg-muted)] mt-1">
          {new Date(n.timestamp).toLocaleString()}
        </div>
      </div>
    </div>
  );
  return n.href ? (
    <Link href={n.href} onClick={onNavigate} className="block hover:bg-[var(--color-bg-hover)]">
      {inner}
    </Link>
  ) : inner;
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block px-3 py-1.5 rounded-md text-[var(--color-fg-2)] hover:bg-[var(--color-accent)] hover:text-white focus-visible:bg-[var(--color-accent)] focus-visible:text-white focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
