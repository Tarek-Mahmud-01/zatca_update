"use client";

import { useEffect, useState } from "react";
import { api, type Me, type TenantCurrency } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { DatePicker } from "../../../../components/DatePicker";
import { pushNotification } from "../../../../lib/notifications";

const CURRENCY_META: Record<string, string> = {
  SAR: "Saudi Riyal", USD: "US Dollar", EUR: "Euro", GBP: "British Pound",
  AED: "UAE Dirham", KWD: "Kuwaiti Dinar", BHD: "Bahraini Dinar", OMR: "Omani Rial",
  QAR: "Qatari Riyal", EGP: "Egyptian Pound", JPY: "Japanese Yen", CNY: "Chinese Yuan",
  INR: "Indian Rupee", AUD: "Australian Dollar", CAD: "Canadian Dollar", CHF: "Swiss Franc",
  SGD: "Singapore Dollar", MYR: "Malaysian Ringgit", TRY: "Turkish Lira", PKR: "Pakistani Rupee",
  IDR: "Indonesian Rupiah", NGN: "Nigerian Naira", ZAR: "South African Rand",
  JOD: "Jordanian Dinar", IQD: "Iraqi Dinar", MAD: "Moroccan Dirham",
};

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function ExchangeRatesPage() {
  const [me, setMe]             = useState<Me | null>(null);
  const [currencies, setCurrencies] = useState<TenantCurrency[]>([]);
  const [busy, setBusy]         = useState(false);

  // Preview selectors (live — no Apply needed)
  const [previewFrom, setPreviewFrom] = useState("");
  const [previewTo,   setPreviewTo]   = useState("");

  // Table filters (pending vs applied)
  const [filterCode,     setFilterCode]     = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate,   setFilterToDate]   = useState("");
  const [appliedCode,     setAppliedCode]     = useState("");
  const [appliedFromDate, setAppliedFromDate] = useState("");
  const [appliedToDate,   setAppliedToDate]   = useState("");

  // Modals
  const [openMenu,  setOpenMenu]  = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  function openMenuFor(id: string, btn: HTMLButtonElement) {
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpenMenu(openMenu === id ? null : id);
  }
  const [editRate,  setEditRate]  = useState<{ currency: TenantCurrency; rate: string; asOf: string } | null>(null);
  const [showNew,   setShowNew]   = useState(false);
  const [newRate,   setNewRate]   = useState({ code: "", rate: "", asOf: todayIso() });

  const defaultCurrency = currencies.find((c) => c.is_default);
  const isAdmin = me?.role === "admin";

  async function refresh() {
    const token = getToken(); if (!token) return;
    try {
      const [m, ccys] = await Promise.all([api.me(token), api.listCurrencies(token)]);
      setMe(m); setCurrencies(ccys);
      const def = ccys.find((c) => c.is_default);
      const nonDef = ccys.find((c) => !c.is_default);
      // Default currency is the base — show it on the From side.
      if (!previewFrom && def) setPreviewFrom(def.code);
      if (!previewTo && nonDef) setPreviewTo(nonDef.code);
    } catch (e) {
      pushNotification({ tone: "danger", title: "Couldn't load rates", body: String(e) });
    }
  }
  useEffect(() => { refresh(); }, []);



  function computeRate(fromCode: string, toCode: string): string | null {
    if (!fromCode || !toCode || fromCode === toCode) return null;
    const from = currencies.find((c) => c.code === fromCode);
    const to   = currencies.find((c) => c.code === toCode);
    if (!from || !to) return null;
    const r = parseFloat(from.exchange_rate) / parseFloat(to.exchange_rate);
    if (!isFinite(r) || isNaN(r)) return null;
    return r.toFixed(4);
  }

  // Table rows: all non-default currencies (default has rate 1, no pair needed)
  const rows = currencies
    .filter((c) => !c.is_default)
    .filter((c) => {
      if (appliedCode && c.code !== appliedCode) return false;
      if (appliedFromDate && c.as_of_date < appliedFromDate) return false;
      if (appliedToDate   && c.as_of_date > appliedToDate)   return false;
      return true;
    });

  async function saveEdit() {
    if (!editRate) return;
    const token = getToken(); if (!token) return;
    setBusy(true);
    try {
      await api.updateCurrency(token, editRate.currency.id, {
        code: editRate.currency.code,
        exchange_rate: editRate.rate,
        as_of_date: editRate.asOf,
        is_default: editRate.currency.is_default,
      });
      setEditRate(null);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Update failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function addOrUpdateRate(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken(); if (!token) return;
    const code = newRate.code.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      pushNotification({ tone: "danger", title: "Invalid code", body: "Enter a 3-letter ISO 4217 code." });
      return;
    }
    setBusy(true);
    try {
      const existing = currencies.find((c) => c.code === code);
      if (existing) {
        await api.updateCurrency(token, existing.id, {
          code: existing.code, exchange_rate: newRate.rate, as_of_date: newRate.asOf, is_default: existing.is_default,
        });
      } else {
        await api.createCurrency(token, {
          code, exchange_rate: newRate.rate, as_of_date: newRate.asOf, is_default: false,
        });
      }
      setShowNew(false);
      setNewRate({ code: "", rate: "", asOf: todayIso() });
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Save failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function deleteRate(c: TenantCurrency) {
    if (!confirm(`Remove exchange rate for ${c.code}?`)) return;
    const token = getToken(); if (!token) return;
    setBusy(true);
    try {
      await api.deleteCurrency(token, c.id);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Delete failed", body: String(e) });
    } finally { setBusy(false); }
  }

  const liveRate = computeRate(previewFrom, previewTo);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">Exchange Rates</h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-0.5">
            Rates are stored as: 1 unit of currency = X units of{" "}
            {defaultCurrency ? <strong>{defaultCurrency.code}</strong> : "the default currency"}.
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "Cancel" : "+ New rate"}
            </button>
          )}
        </div>
      </div>

      {/* Preview + filter panel */}
      <div className="border border-[var(--color-border)] rounded-lg p-4 mb-4 bg-[var(--color-bg-soft)]">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Live preview selectors */}
          <div>
            <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">From</div>
            <select className="input min-w-[90px]" value={previewFrom} onChange={(e) => setPreviewFrom(e.target.value)}>
              <option value="">Select…</option>
              {currencies.map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => { const f = previewFrom; setPreviewFrom(previewTo); setPreviewTo(f); }}
            disabled={!previewFrom && !previewTo}
            title="Swap From and To"
            aria-label="Swap currencies"
            className="self-end mb-1 w-8 h-8 inline-flex items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
          <div>
            <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">To</div>
            <select className="input min-w-[90px]" value={previewTo} onChange={(e) => setPreviewTo(e.target.value)}>
              <option value="">Select…</option>
              {currencies.map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
            </select>
          </div>
          {previewFrom && previewTo && previewFrom !== previewTo && (
            <div className="self-end pb-0.5">
              {liveRate ? (
                <div className="px-3 py-2 rounded-md bg-white border border-[var(--color-border)] text-sm font-mono whitespace-nowrap">
                  1 {previewFrom} = <span className="font-semibold">{liveRate}</span> {previewTo}
                </div>
              ) : (
                <div className="px-3 py-2 rounded-md bg-white border border-[var(--color-border)] text-sm text-[var(--color-fg-muted)]">
                  No rate available
                </div>
              )}
            </div>
          )}

          {/* Separator */}
          <div className="hidden sm:block self-stretch border-l border-[var(--color-border)] mx-1" />

          {/* Table filters */}
          <div>
            <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Currency</div>
            <select className="input" value={filterCode} onChange={(e) => setFilterCode(e.target.value)}>
              <option value="">All currencies</option>
              {currencies.filter((c) => !c.is_default).map((c) => (
                <option key={c.id} value={c.code}>{c.code} — {CURRENCY_META[c.code] ?? c.code}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Effective from</div>
            <DatePicker value={filterFromDate} onChange={(v) => setFilterFromDate(v || "")} />
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Effective to</div>
            <DatePicker value={filterToDate} onChange={(v) => setFilterToDate(v || "")} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary"
              onClick={() => { setAppliedCode(filterCode); setAppliedFromDate(filterFromDate); setAppliedToDate(filterToDate); }}>
              Apply
            </button>
            <button type="button" className="btn btn-ghost"
              onClick={() => { setFilterCode(""); setFilterFromDate(""); setFilterToDate(""); setAppliedCode(""); setAppliedFromDate(""); setAppliedToDate(""); }}>
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* New rate form */}
      {showNew && (
        <div className="mb-4 border border-[var(--color-border)] rounded-lg p-4">
          <div className="text-sm font-semibold text-[var(--color-fg)] mb-3">New / update rate</div>
          <form onSubmit={addOrUpdateRate} className="flex flex-wrap gap-3 items-end">
            <div>
              <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Currency code</div>
              <input className="input uppercase w-24" list="er-ccy-list" maxLength={3}
                placeholder="USD"
                value={newRate.code}
                onChange={(e) => setNewRate({ ...newRate, code: e.target.value.toUpperCase().slice(0, 3) })}
              />
              <datalist id="er-ccy-list">
                {Object.keys(CURRENCY_META).map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">
                Rate (1 {newRate.code || "CODE"} = ? {defaultCurrency?.code ?? "default"})
              </div>
              <input className="input tabular-nums w-36" inputMode="decimal" placeholder="0.0000"
                value={newRate.rate}
                onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Effective date</div>
              <DatePicker value={newRate.asOf} onChange={(v) => setNewRate({ ...newRate, asOf: v || todayIso() })} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit modal */}
      {editRate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm mx-4">
            <div className="text-base font-semibold text-[var(--color-fg)] mb-0.5">Edit rate — {editRate.currency.code}</div>
            <div className="text-xs text-[var(--color-fg-muted)] mb-4">
              {CURRENCY_META[editRate.currency.code] ?? editRate.currency.code} → {defaultCurrency?.code ?? "default"}
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">
                  Rate (1 {editRate.currency.code} = ? {defaultCurrency?.code})
                </div>
                <input className="input tabular-nums" inputMode="decimal"
                  value={editRate.rate}
                  onChange={(e) => setEditRate({ ...editRate, rate: e.target.value })}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Effective date</div>
                <DatePicker value={editRate.asOf}
                  onChange={(v) => setEditRate({ ...editRate, asOf: v || editRate.asOf })} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditRate(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg-soft)] border-b border-[var(--color-border)]">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Pair</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Rate</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Effective date</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide hidden md:table-cell">Source</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--color-fg-muted)]">
                  No exchange rates found.
                </td>
              </tr>
            ) : rows.map((c) => (
              <tr key={c.id} className="hover:bg-[var(--color-bg-hover)]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-medium text-[var(--color-fg)]">{c.code}</span>
                    <span className="text-[var(--color-fg-muted)]">→</span>
                    <span className="font-mono text-[var(--color-fg-2)]">{defaultCurrency?.code ?? "—"}</span>
                  </div>
                  <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">
                    {CURRENCY_META[c.code] ?? c.code}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-[var(--color-fg)]">
                  {parseFloat(c.exchange_rate).toFixed(4)}
                </td>
                <td className="px-4 py-3 text-[var(--color-fg-2)]">{c.as_of_date}</td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-bg-soft)] text-[var(--color-fg-muted)] border border-[var(--color-border)]">
                    Manual
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && (
                    <div className="relative inline-block">
                      <button
                        type="button"
                        className="btn btn-ghost !p-1.5"
                        onClick={(e) => openMenuFor(c.id, e.currentTarget)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                      {openMenu === c.id && (
                        <>
                          <div className="fixed inset-0 z-[9998]" onClick={() => setOpenMenu(null)} />
                          <div className="fixed z-[9999] w-36 bg-white border border-[var(--color-border)] rounded-lg shadow-lg py-1"
                            style={{ top: menuPos.top, right: menuPos.right }}>
                            <button type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-hover)] text-[var(--color-fg-2)]"
                              onClick={() => { setEditRate({ currency: c, rate: c.exchange_rate, asOf: c.as_of_date }); setOpenMenu(null); }}>
                              Edit
                            </button>
                            <button type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-hover)] text-[var(--color-danger)]"
                              onClick={() => { deleteRate(c); setOpenMenu(null); }}>
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
