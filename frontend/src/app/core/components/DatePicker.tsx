"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Custom date picker that ships its own popup (no browser-native dialog).
 *  - Display format: dd-mm-yyyy
 *  - External value: ISO yyyy-mm-dd (what the API expects)
 *  - Visuals match the slate primary accent
 */
export function DatePicker({
  value, onChange, placeholder = "dd-mm-yyyy", className = "",
}: {
  value: string;                       // ISO yyyy-mm-dd
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const today = new Date();

  // Parsed Date for the currently-shown month, falls back to today.
  const selected = useMemo(() => fromIso(value), [value]);
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const d = selected ?? today;
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Keep the calendar centered on whatever the user just picked.
  useEffect(() => {
    if (selected) setView({ year: selected.getFullYear(), month: selected.getMonth() });
  }, [selected]);

  // Click outside closes.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(d: Date) {
    onChange(toIso(d));
    setOpen(false);
  }
  function shift(months: number) {
    setView((v) => {
      let m = v.month + months;
      let y = v.year;
      while (m < 0) { m += 12; y--; }
      while (m > 11) { m -= 12; y++; }
      return { year: y, month: m };
    });
  }

  // Allow typing dd-mm-yyyy or dd/mm/yyyy directly.
  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.trim();
    if (raw === "") { onChange(""); return; }
    const m = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (!m) return;
    const dd = Number(m[1]); const mm = Number(m[2]);
    let yyyy = Number(m[3]); if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, mm - 1, dd);
    if (!Number.isNaN(d.getTime()) && d.getDate() === dd) onChange(toIso(d));
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          value={displayDDMMYYYY(value)}
          onChange={onInput}
          onFocus={() => setOpen(true)}
          className="input pr-9 text-sm tabular-nums"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          tabIndex={-1}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)]"
          aria-label="Open calendar"
        >
          <CalendarIcon />
        </button>
      </div>

      {open && (
        <Popover
          year={view.year}
          month={view.month}
          selected={selected}
          today={today}
          onShift={shift}
          onJumpMonth={(m) => setView((v) => ({ ...v, month: m }))}
          onJumpYear={(y) => setView((v) => ({ ...v, year: y }))}
          onPick={pick}
          onClear={() => { onChange(""); setOpen(false); }}
          onToday={() => pick(today)}
        />
      )}
    </div>
  );
}

/* ---------------------- popover (calendar) ----------------------------- */

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW    = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function Popover({
  year, month, selected, today, onShift, onJumpMonth, onJumpYear, onPick, onClear, onToday,
}: {
  year: number;
  month: number;
  selected: Date | null;
  today: Date;
  onShift: (n: number) => void;
  onJumpMonth: (m: number) => void;
  onJumpYear:  (y: number) => void;
  onPick: (d: Date) => void;
  onClear: () => void;
  onToday: () => void;
}) {
  // Build the 6×7 day grid — leading days from previous month, trailing from next.
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startWeekday = first.getDay();        // 0 Sun .. 6 Sat
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leading: { d: Date; dim: boolean }[] = [];
    for (let i = startWeekday; i > 0; i--) {
      const d = new Date(year, month, 1 - i);
      leading.push({ d, dim: true });
    }
    const current: { d: Date; dim: boolean }[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      current.push({ d: new Date(year, month, i), dim: false });
    }
    const total = leading.length + current.length;
    const trailing: { d: Date; dim: boolean }[] = [];
    for (let i = 1; i <= 42 - total; i++) {
      trailing.push({ d: new Date(year, month + 1, i), dim: true });
    }
    return [...leading, ...current, ...trailing];
  }, [year, month]);

  return (
    <div className="absolute z-30 mt-1 w-64 bg-white border border-[var(--color-border)] rounded-lg shadow-lg p-2.5 text-sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1">
          <select
            value={month}
            onChange={(e) => onJumpMonth(Number(e.target.value))}
            className="bg-transparent text-xs font-semibold text-[var(--color-fg)] py-0.5 pr-1 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 rounded cursor-pointer"
          >
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={(e) => onJumpYear(Number(e.target.value))}
            className="bg-transparent text-xs font-semibold text-[var(--color-fg)] py-0.5 px-1 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 rounded cursor-pointer"
          >
            {Array.from({ length: 16 }, (_, k) => year - 10 + k).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-0.5">
          <NavBtn label="Previous month" onClick={() => onShift(-1)}>‹</NavBtn>
          <NavBtn label="Next month"     onClick={() => onShift(1)}>›</NavBtn>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {DOW.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-muted)] py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map(({ d, dim }, idx) => {
          const isSelected = selected && sameDay(d, selected);
          const isToday    = sameDay(d, today);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onPick(d)}
              className={`
                h-7 text-xs rounded-md transition-colors tabular-nums
                ${isSelected
                  ? "bg-[var(--color-accent)] text-white font-semibold"
                  : dim
                    ? "text-[var(--color-fg-faint)] hover:bg-[var(--color-bg-hover)]"
                    : "text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"}
                ${isToday && !isSelected ? "ring-1 ring-[var(--color-accent)]/40 font-medium" : ""}
              `}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-[var(--color-border)]">
        <button type="button" onClick={onClear}
          className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] px-1.5 py-0.5">
          Clear
        </button>
        <button type="button" onClick={onToday}
          className="text-[11px] text-[var(--color-accent)] hover:underline px-1.5 py-0.5">
          Today
        </button>
      </div>
    </div>
  );
}

function NavBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)] text-base leading-none"
    >
      {children}
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8"  y1="2" x2="8"  y2="6" />
      <line x1="3"  y1="10" x2="21" y2="10" />
    </svg>
  );
}

/* ---------------------- helpers ---------------------------------------- */

function pad2(n: number): string { return n.toString().padStart(2, "0"); }

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fromIso(iso: string): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function displayDDMMYYYY(iso: string): string {
  const d = fromIso(iso);
  if (!d) return "";
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}
