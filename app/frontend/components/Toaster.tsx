"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useToastQueueDrain, type Notification } from "../lib/notifications";

const AUTO_DISMISS_MS = 5500;

const TONE_BG: Record<string, string> = {
  success: "bg-[var(--color-success-soft)] border-[var(--color-success)]/30",
  warning: "bg-[var(--color-warning-soft)] border-[var(--color-warning)]/30",
  danger:  "bg-[var(--color-danger-soft)]  border-[var(--color-danger)]/30",
  info:    "bg-white border-[var(--color-border)]",
};

const TONE_DOT: Record<string, string> = {
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger:  "bg-[var(--color-danger)]",
  info:    "bg-[var(--color-fg-muted)]",
};

interface Toast extends Notification {
  /** Time the toast was *shown* on screen, used for the dismiss animation. */
  shownAt: number;
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const handle = useCallback((n: Notification) => {
    setToasts((t) => [...t, { ...n, shownAt: Date.now() }]);
  }, []);
  useToastQueueDrain(handle);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(
        () => setToasts((cur) => cur.filter((x) => x.id !== t.id)),
        AUTO_DISMISS_MS,
      ),
    );
    return () => { for (const id of timers) clearTimeout(id); };
  }, [toasts]);

  function dismiss(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex justify-end items-end p-4 sm:p-6">
      <div className="flex flex-col gap-2 w-full sm:w-auto sm:max-w-sm">
        {toasts.slice(-5).map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const cls = TONE_BG[toast.tone] ?? TONE_BG.info;
  const dot = TONE_DOT[toast.tone] ?? TONE_DOT.info;

  const inner = (
    <div className={`pointer-events-auto rounded-lg border px-3.5 py-3 shadow-sm ${cls}`}>
      <div className="flex gap-3 items-start">
        <span className={`inline-block w-2 h-2 rounded-full mt-1.5 ${dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--color-fg)] truncate">
            {toast.title}
          </div>
          {toast.body && (
            <div className="text-xs text-[var(--color-fg-2)] mt-0.5 break-words">
              {toast.body}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
          className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] text-sm leading-none -mr-1 -mt-0.5"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );

  // Make the body clickable when there's a target href.
  return toast.href ? (
    <Link href={toast.href} className="no-underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}
