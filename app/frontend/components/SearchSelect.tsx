"use client";

import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;   // optional sub-line shown in the list
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  disabled = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  // Keyboard: close on Escape
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }

  const filtered = options.filter((o) =>
    !query.trim() ||
    o.label.toLowerCase().includes(query.toLowerCase()) ||
    (o.hint ?? "").toLowerCase().includes(query.toLowerCase())
  );

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((p) => !p); }}
        className={`input w-full text-left flex items-center justify-between gap-2 ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className={selected ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)]"}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-[var(--color-fg-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md shadow-lg flex flex-col overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-[var(--color-border-soft)]">
            <input
              ref={searchRef}
              type="text"
              className="input !py-1.5 text-sm w-full"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Options list */}
          <div className="overflow-y-auto" style={{ maxHeight: "min(55vh, 320px)" }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-[var(--color-fg-muted)]">No results</div>
            ) : (
              filtered.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
                    className={[
                      "w-full text-left px-3 py-2 text-sm transition-colors",
                      isSelected
                        ? "bg-[var(--color-accent)] text-white"
                        : "text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)]",
                    ].join(" ")}
                  >
                    <div className="font-medium">{o.label}</div>
                    {o.hint && (
                      <div className={`text-xs mt-0.5 ${isSelected ? "text-white/70" : "text-[var(--color-fg-muted)]"}`}>
                        {o.hint}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
