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
