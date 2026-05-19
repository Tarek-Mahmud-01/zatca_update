"use client";

import React from "react";

/* ---------------------------------------------------------------------------
 * PageHeader — title + optional description + actions on the right
 * -------------------------------------------------------------------------- */
export function PageHeader({
  title, description, actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-[var(--color-fg)] leading-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Tabs — horizontal pills under the page header.
 * -------------------------------------------------------------------------- */
export function Tabs<T extends string>({
  value, onChange, items,
}: {
  value: T;
  onChange: (next: T) => void;
  items: ReadonlyArray<{ id: T; label: React.ReactNode; count?: number; disabled?: boolean }>;
}) {
  return (
    <div className="border-b border-[var(--color-border)] mb-4 overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {items.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              onClick={() => !t.disabled && onChange(t.id)}
              disabled={t.disabled}
              className={`px-3 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${active
                  ? "border-[var(--color-accent)] text-[var(--color-fg)]"
                  : "border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg-2)]"}
                disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-[var(--color-bg-soft)] text-[var(--color-fg-muted)]">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Card — neutral container with subtle border, no shadow
 * -------------------------------------------------------------------------- */
export function Card({
  title, description, actions, children, className = "",
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-[var(--color-border)] rounded-lg ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <div>
            {title && <div className="text-sm font-semibold text-[var(--color-fg)]">{title}</div>}
            {description && (
              <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">{description}</div>
            )}
          </div>
          {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Field — label + input wrapper. Responsive 1-col on mobile, grid on desktop.
 * -------------------------------------------------------------------------- */
export function FieldGrid({ cols = 2, children }: { cols?: 1 | 2 | 3 | 4; children: React.ReactNode }) {
  const colClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
  }[cols];
  return <div className={`grid ${colClass} gap-4`}>{children}</div>;
}

export function Field({
  label, hint, error, required, children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-fg-2)]">
        {label}{required && <span className="text-[var(--color-danger)] ml-0.5">*</span>}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-[var(--color-fg-muted)]">{hint}</span>}
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
    </label>
  );
}

/* ---------------------------------------------------------------------------
 * Empty state for empty lists
 * -------------------------------------------------------------------------- */
export function Empty({
  title, description, action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-12 px-4 bg-[var(--color-bg-muted)] border border-dashed border-[var(--color-border)] rounded-lg">
      <div className="text-base font-medium text-[var(--color-fg-2)]">{title}</div>
      {description && (
        <div className="text-sm text-[var(--color-fg-muted)] mt-1 max-w-md mx-auto">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Inline error / success banners
 * -------------------------------------------------------------------------- */
export function Banner({
  tone = "neutral", children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const cls = {
    neutral: "bg-[var(--color-bg-soft)] text-[var(--color-fg-2)] border-[var(--color-border)]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success)]/30",
    warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning)]/30",
    danger:  "bg-[var(--color-danger-soft)]  text-[var(--color-danger)]  border-[var(--color-danger)]/30",
  }[tone];
  return (
    <div className={`text-sm px-3 py-2 rounded-md border ${cls}`}>{children}</div>
  );
}

/* ---------------------------------------------------------------------------
 * StatusDot — colored circle for invoice statuses etc.
 * -------------------------------------------------------------------------- */
export function StatusDot({ status }: { status: string }) {
  const color =
    status === "cleared"  ? "bg-[var(--color-success)]" :
    status === "reported" ? "bg-[var(--color-success)]" :
    status === "local_only" ? "bg-[var(--color-fg-muted)]" :
    status === "draft"    ? "bg-[var(--color-fg-faint)]" :
    status === "queued" || status === "retrying" ? "bg-[var(--color-warning)]" :
    status === "rejected" || status.startsWith("failed") ? "bg-[var(--color-danger)]" :
    "bg-[var(--color-fg-faint)]";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}
