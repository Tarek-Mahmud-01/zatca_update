"use client";

import { useEffect, useState } from "react";

export type Tone = "info" | "success" | "warning" | "danger";

export interface Notification {
  id: string;
  tone: Tone;
  title: string;
  body?: string;
  /** Where clicking the notification (or toast) should take the user. */
  href?: string;
  timestamp: number;
  read: boolean;
}

const MAX_KEPT = 50;
const _list: Notification[] = [];
const _toastQueue: Notification[] = [];
type Listener = () => void;
const _listeners = new Set<Listener>();
const _toastListeners = new Set<Listener>();

function notify() { _listeners.forEach((fn) => fn()); }
function notifyToast() { _toastListeners.forEach((fn) => fn()); }

function uid(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pushNotification(input: {
  tone: Tone;
  title: string;
  body?: string;
  href?: string;
}): Notification {
  const n: Notification = {
    id: uid(),
    timestamp: Date.now(),
    read: false,
    ...input,
  };
  _list.unshift(n);
  if (_list.length > MAX_KEPT) _list.length = MAX_KEPT;
  _toastQueue.push(n);
  notify();
  notifyToast();
  return n;
}

export function getNotifications(): readonly Notification[] {
  return _list;
}

/* ----- queued-echo suppression --------------------------------------- *
 * When a page shows its own "saved to queue" toast for an invoice, the
 * tenant-wide SSE stream also delivers an `invoice.queued` event for the same
 * row. On the initiating tab that's a duplicate. `suppressQueuedEcho` is called
 * with the invoice id as the local toast is shown; the SSE handler then drops
 * the matching echo. Both arrival orders are covered: a later echo is skipped
 * via `shouldSuppressQueued`, and an echo that already landed (SSE can beat the
 * fetch response) is removed here. Other tabs are unaffected. */
const _suppressQueued = new Map<string, number>();  // invoiceId -> expiry ms
const QUEUED_TITLE = "Invoice queued";

export function suppressQueuedEcho(invoiceId: string, ttlMs = 15_000): void {
  _suppressQueued.set(invoiceId, Date.now() + ttlMs);
  const href = `/dashboard/invoices/${invoiceId}`;
  let removed = false;
  for (let i = _list.length - 1; i >= 0; i--) {
    if (_list[i].href === href && _list[i].title === QUEUED_TITLE) {
      _list.splice(i, 1);
      removed = true;
    }
  }
  for (let i = _toastQueue.length - 1; i >= 0; i--) {
    if (_toastQueue[i].href === href && _toastQueue[i].title === QUEUED_TITLE) {
      _toastQueue.splice(i, 1);
    }
  }
  if (removed) notify();
}

/** True (and consumes the entry) if a just-arrived `invoice.queued` for this
 *  invoice is an echo of a local toast already shown on this tab. */
export function shouldSuppressQueued(invoiceId: string): boolean {
  const exp = _suppressQueued.get(invoiceId);
  if (exp === undefined) return false;
  _suppressQueued.delete(invoiceId);
  return Date.now() <= exp;
}

export function getUnreadCount(): number {
  return _list.filter((n) => !n.read).length;
}

export function markAllRead() {
  for (const n of _list) n.read = true;
  notify();
}

export function clearAll() {
  _list.length = 0;
  notify();
}

export function consumeToastQueue(): Notification[] {
  const out = _toastQueue.splice(0, _toastQueue.length);
  return out;
}

export function subscribe(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function subscribeToToasts(fn: Listener): () => void {
  _toastListeners.add(fn);
  return () => _toastListeners.delete(fn);
}

/* ----- React hooks --------------------------------------------------- */

export function useNotifications(): { items: Notification[]; unread: number } {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((v) => v + 1)), []);
  return { items: [..._list], unread: getUnreadCount() };
}

/** Subscribes to newly-pushed notifications. The hook keeps pulling from the
 *  queue and calling `onNew` for each. */
export function useToastQueueDrain(onNew: (n: Notification) => void) {
  useEffect(() => {
    return subscribeToToasts(() => {
      for (const n of consumeToastQueue()) onNew(n);
    });
  }, [onNew]);
}
