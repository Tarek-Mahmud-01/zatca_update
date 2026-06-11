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
 * Input — thin wrapper over <input> carrying the shared `.input` styling.
 * Fully controlled from the parent: every native attribute (value, onChange,
 * type, required, maxLength, autoComplete, …) is passed through as a prop, so
 * nothing is hardcoded here. Extra classes (e.g. "font-mono") merge with the
 * base class instead of replacing it.
 * -------------------------------------------------------------------------- */
export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />;
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

/* ---------------------------------------------------------------------------
 * Button — controlled button with variants, sizes and optional loading state.
 * -------------------------------------------------------------------------- */
type ButtonVariant = "primary" | "default" | "ghost" | "danger";
type ButtonSize    = "sm" | "md" | "lg";

export function Button({
  variant = "default", size = "md", loading = false, icon, children, className = "", disabled, ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantCls: Record<ButtonVariant, string> = {
    primary: "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] border-transparent",
    default: "bg-white text-[var(--color-fg)] border-[var(--color-border)] hover:bg-[var(--color-bg-soft)]",
    ghost:   "bg-transparent text-[var(--color-fg-2)] border-transparent hover:bg-[var(--color-bg-soft)]",
    danger:  "bg-[var(--color-danger)] text-white hover:opacity-90 border-transparent",
  };
  const sizeCls: Record<ButtonSize, string> = {
    sm: "px-2.5 py-1 text-xs gap-1",
    md: "px-3.5 py-1.5 text-sm gap-1.5",
    lg: "px-5 py-2 text-base gap-2",
  };
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-md border transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantCls[variant]} ${sizeCls[size]} ${className}`}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Select — controlled <select> matching Input styling.
 * -------------------------------------------------------------------------- */
export function Select({ className = "", children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`input pr-8 appearance-none bg-no-repeat bg-[right_0.5rem_center] cursor-pointer ${className}`} {...props}>
      {children}
    </select>
  );
}

/* ---------------------------------------------------------------------------
 * Textarea — controlled <textarea> matching Input styling.
 * -------------------------------------------------------------------------- */
export function Textarea({ className = "", rows = 3, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={`input resize-y ${className}`} {...props} />;
}

/* ---------------------------------------------------------------------------
 * Checkbox — controlled checkbox with inline label.
 * -------------------------------------------------------------------------- */
export function Checkbox({
  label, hint, error, className = "", ...props
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={`flex items-start gap-2 cursor-pointer ${className}`}>
      <input
        type="checkbox"
        className="mt-0.5 w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
        {...props}
      />
      {(label || hint || error) && (
        <span className="flex flex-col gap-0.5">
          {label && <span className="text-sm text-[var(--color-fg)]">{label}</span>}
          {hint  && !error && <span className="text-xs text-[var(--color-fg-muted)]">{hint}</span>}
          {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
        </span>
      )}
    </label>
  );
}

/* ---------------------------------------------------------------------------
 * Switch — toggle control (controlled: pass checked + onChange).
 * -------------------------------------------------------------------------- */
export function Switch({
  checked, onChange, label, disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex w-9 h-5 rounded-full transition-colors
          ${checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
          ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </span>
      {label && <span className="text-sm text-[var(--color-fg)]">{label}</span>}
    </label>
  );
}

/* ---------------------------------------------------------------------------
 * Table system — Table > Thead > Tbody > Tr > Th / Td
 * -------------------------------------------------------------------------- */
export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={`w-full text-sm border-collapse ${className}`}>{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-[var(--color-border)] text-xs text-[var(--color-fg-muted)] uppercase tracking-wide">
      {children}
    </thead>
  );
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-[var(--color-border)]">{children}</tbody>;
}

export function Tr({
  children, onClick, selected, className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors
        ${onClick ? "cursor-pointer hover:bg-[var(--color-bg-soft)]" : ""}
        ${selected ? "bg-[var(--color-accent)]/5" : ""}
        ${className}`}
    >
      {children}
    </tr>
  );
}

export function Th({
  children, align = "left", className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const alignCls = { left: "text-left", right: "text-right", center: "text-center" }[align];
  return <th className={`px-3 py-2 font-medium ${alignCls} ${className}`}>{children}</th>;
}

export function Td({
  children, align = "left", muted = false, className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  muted?: boolean;
  className?: string;
}) {
  const alignCls = { left: "text-left", right: "text-right", center: "text-center" }[align];
  return (
    <td className={`px-3 py-2.5 ${alignCls} ${muted ? "text-[var(--color-fg-muted)]" : ""} ${className}`}>
      {children}
    </td>
  );
}

/* ---------------------------------------------------------------------------
 * Nav + NavItem — sidebar / top navigation.
 * -------------------------------------------------------------------------- */
export function Nav({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <nav className={`flex flex-col gap-0.5 ${className}`}>{children}</nav>;
}

export function NavItem({
  children, active = false, icon, onClick, href, className = "",
}: {
  children: React.ReactNode;
  active?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const base = `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors
    ${active
      ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
      : "text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-fg)]"}
    ${className}`;
  if (href) return <a href={href} className={base}>{icon}{children}</a>;
  return <button onClick={onClick} className={base}>{icon}{children}</button>;
}

/* ---------------------------------------------------------------------------
 * Badge — pill for statuses, counts, labels.
 * -------------------------------------------------------------------------- */
type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";

export function Badge({
  tone = "neutral", children, className = "",
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  const cls: Record<BadgeTone, string> = {
    neutral: "bg-[var(--color-bg-soft)] text-[var(--color-fg-2)]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    danger:  "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    accent:  "bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls[tone]} ${className}`}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Spinner — animated loading indicator.
 * -------------------------------------------------------------------------- */
export function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "w-3.5 h-3.5 border-[1.5px]", md: "w-5 h-5 border-2", lg: "w-7 h-7 border-2" }[size];
  return (
    <span
      className={`inline-block rounded-full border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin ${sz}`}
      aria-label="Loading"
    />
  );
}

/* ---------------------------------------------------------------------------
 * Modal — overlay dialog. Controlled: pass open + onClose.
 * -------------------------------------------------------------------------- */
export function Modal({
  open, onClose, title, children, footer, width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative z-10 w-full ${width} bg-white rounded-xl shadow-xl flex flex-col max-h-[90vh]`}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <div className="text-base font-semibold text-[var(--color-fg)]">{title}</div>
            <button onClick={onClose} className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        )}
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-[var(--color-border)] flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Dropdown — popover menu. Controlled: pass open + onClose + trigger.
 * -------------------------------------------------------------------------- */
export function Dropdown({
  open, onClose, trigger, children, align = "left",
}: {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className="relative inline-block">
      {trigger}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} />
          <div className={`absolute z-40 mt-1 min-w-[10rem] bg-white border border-[var(--color-border)] rounded-lg shadow-lg py-1
            ${align === "right" ? "right-0" : "left-0"}`}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

export function DropdownItem({
  children, onClick, destructive = false, disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed
        ${destructive
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
          : "text-[var(--color-fg)] hover:bg-[var(--color-bg-soft)]"}`}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Divider — horizontal rule.
 * -------------------------------------------------------------------------- */
export function Divider({ className = "" }: { className?: string }) {
  return <hr className={`border-t border-[var(--color-border)] my-4 ${className}`} />;
}
