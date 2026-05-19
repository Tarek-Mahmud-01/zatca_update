"use client";

import { useEffect, useState } from "react";
import { api, type Me, type TenantCurrency } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { DatePicker } from "../../../../components/DatePicker";
import { pushNotification } from "../../../../lib/notifications";

const CURRENCY_META: Record<string, { name: string; shortName: string; country: string; symbol: string; decimals: number }> = {
  SAR: { name: "Saudi Riyal",        shortName: "Riyal",   country: "Saudi Arabia",    symbol: "ر.س",   decimals: 2 },
  USD: { name: "US Dollar",          shortName: "Dollar",  country: "United States",   symbol: "$",     decimals: 2 },
  EUR: { name: "Euro",               shortName: "Euro",    country: "European Union",  symbol: "€",     decimals: 2 },
  GBP: { name: "British Pound",      shortName: "Pound",   country: "United Kingdom",  symbol: "£",     decimals: 2 },
  AED: { name: "UAE Dirham",         shortName: "Dirham",  country: "UAE",             symbol: "د.إ",  decimals: 2 },
  KWD: { name: "Kuwaiti Dinar",      shortName: "Dinar",   country: "Kuwait",          symbol: "د.ك",  decimals: 3 },
  BHD: { name: "Bahraini Dinar",     shortName: "Dinar",   country: "Bahrain",         symbol: ".د.ب", decimals: 3 },
  OMR: { name: "Omani Rial",         shortName: "Rial",    country: "Oman",            symbol: "ر.ع.", decimals: 3 },
  QAR: { name: "Qatari Riyal",       shortName: "Riyal",   country: "Qatar",           symbol: "ر.ق",  decimals: 2 },
  EGP: { name: "Egyptian Pound",     shortName: "Pound",   country: "Egypt",           symbol: "£",     decimals: 2 },
  JPY: { name: "Japanese Yen",       shortName: "Yen",     country: "Japan",           symbol: "¥",     decimals: 0 },
  CNY: { name: "Chinese Yuan",       shortName: "Yuan",    country: "China",           symbol: "¥",     decimals: 2 },
  INR: { name: "Indian Rupee",       shortName: "Rupee",   country: "India",           symbol: "₹",     decimals: 2 },
  AUD: { name: "Australian Dollar",  shortName: "Dollar",  country: "Australia",       symbol: "$",     decimals: 2 },
  CAD: { name: "Canadian Dollar",    shortName: "Dollar",  country: "Canada",          symbol: "$",     decimals: 2 },
  CHF: { name: "Swiss Franc",        shortName: "Franc",   country: "Switzerland",     symbol: "Fr",    decimals: 2 },
  SGD: { name: "Singapore Dollar",   shortName: "Dollar",  country: "Singapore",       symbol: "$",     decimals: 2 },
  MYR: { name: "Malaysian Ringgit",  shortName: "Ringgit", country: "Malaysia",        symbol: "RM",    decimals: 2 },
  TRY: { name: "Turkish Lira",       shortName: "Lira",    country: "Turkey",          symbol: "₺",     decimals: 2 },
  PKR: { name: "Pakistani Rupee",    shortName: "Rupee",   country: "Pakistan",        symbol: "₨",     decimals: 2 },
  IDR: { name: "Indonesian Rupiah",  shortName: "Rupiah",  country: "Indonesia",       symbol: "Rp",    decimals: 0 },
  NGN: { name: "Nigerian Naira",     shortName: "Naira",   country: "Nigeria",         symbol: "₦",     decimals: 2 },
  ZAR: { name: "South African Rand", shortName: "Rand",    country: "South Africa",    symbol: "R",     decimals: 2 },
  JOD: { name: "Jordanian Dinar",    shortName: "Dinar",   country: "Jordan",          symbol: "د.أ",  decimals: 3 },
  LBP: { name: "Lebanese Pound",     shortName: "Pound",   country: "Lebanon",         symbol: "ل.ل",  decimals: 2 },
  IQD: { name: "Iraqi Dinar",        shortName: "Dinar",   country: "Iraq",            symbol: "ع.د",  decimals: 3 },
  MAD: { name: "Moroccan Dirham",    shortName: "Dirham",  country: "Morocco",         symbol: "د.م.", decimals: 2 },
  TND: { name: "Tunisian Dinar",     shortName: "Dinar",   country: "Tunisia",         symbol: "د.ت",  decimals: 3 },
};

const COMMON_CODES = Object.keys(CURRENCY_META);

function getMeta(code: string) {
  return CURRENCY_META[code] ?? { name: code, shortName: code, country: "—", symbol: code, decimals: 2 };
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function CurrenciesSettingsPage() {
  const [me, setMe]             = useState<Me | null>(null);
  const [currencies, setCurrencies] = useState<TenantCurrency[]>([]);
  const [busy, setBusy]         = useState(false);

  // Filters (pending vs applied)
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [appliedSearch, setAppliedSearch]   = useState("");

  // Add form
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft]     = useState({ code: "USD", exchange_rate: "3.75", as_of_date: todayIso() });

  // Edit modal
  const [editing, setEditing] = useState<{ currency: TenantCurrency; rate: string; asOf: string } | null>(null);

  // Row action menu
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  function openMenuFor(id: string, btn: HTMLButtonElement) {
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpenMenu(openMenu === id ? null : id);
  }

  const isAdmin = me?.role === "admin";

  async function refresh() {
    const token = getToken(); if (!token) return;
    try {
      const [m, ccys] = await Promise.all([api.me(token), api.listCurrencies(token)]);
      setMe(m); setCurrencies(ccys);
    } catch (e) {
      pushNotification({ tone: "danger", title: "Couldn't load currencies", body: String(e) });
    }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = currencies.filter((c) => {
    if (!appliedSearch) return true;
    const q = appliedSearch.toLowerCase();
    const m = getMeta(c.code);
    return c.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.country.toLowerCase().includes(q);
  });

  async function addCurrency(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken(); if (!token) return;
    if (!/^[A-Za-z]{3}$/.test(draft.code)) {
      pushNotification({ tone: "danger", title: "Invalid code", body: "Use a 3-letter ISO 4217 code." });
      return;
    }
    setBusy(true);
    try {
      await api.createCurrency(token, {
        code: draft.code.toUpperCase(),
        exchange_rate: draft.exchange_rate || "1",
        as_of_date: draft.as_of_date || todayIso(),
        is_default: false,
      });
      setShowNew(false);
      setDraft({ code: "USD", exchange_rate: "3.75", as_of_date: todayIso() });
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Add currency failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    const token = getToken(); if (!token) return;
    setBusy(true);
    try {
      await api.updateCurrency(token, editing.currency.id, {
        code: editing.currency.code,
        exchange_rate: editing.rate,
        as_of_date: editing.asOf,
        is_default: editing.currency.is_default,
      });
      setEditing(null);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Update failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function makeDefault(c: TenantCurrency) {
    const token = getToken(); if (!token) return;
    setBusy(true);
    try {
      await api.updateCurrency(token, c.id, {
        code: c.code, exchange_rate: c.exchange_rate, as_of_date: c.as_of_date, is_default: true,
      });
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Set default failed", body: String(e) });
    } finally { setBusy(false); }
  }

  async function deactivate(c: TenantCurrency) {
    if (!confirm(`Remove ${c.code} — ${getMeta(c.code).name}?`)) return;
    const token = getToken(); if (!token) return;
    setBusy(true);
    try {
      await api.deleteCurrency(token, c.id);
      await refresh();
    } catch (e) {
      pushNotification({ tone: "danger", title: "Remove failed", body: String(e) });
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">Currencies</h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-0.5">
            Default currency has a fixed rate of 1. All others hold same-day exchange rates against the default.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
            {showNew ? "Cancel" : "+ New currency"}
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="flex-1 min-w-[180px]">
          <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Search</div>
          <input
            className="input"
            placeholder="Code, name or country…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setAppliedSearch(search); }}
          />
        </div>
        <div className="min-w-[140px]">
          <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Status</div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setAppliedSearch(search)}>Apply</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setSearch(""); setStatusFilter("all"); setAppliedSearch(""); }}>Reset</button>
        </div>
      </div>

      {/* New currency form */}
      {showNew && (
        <div className="mb-4 border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-bg-soft)]">
          <div className="text-sm font-semibold text-[var(--color-fg)] mb-3">New currency</div>
          <form onSubmit={addCurrency} className="flex flex-wrap gap-3 items-end">
            <div>
              <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Code</div>
              <input className="input uppercase w-24" list="ccy-presets" maxLength={3}
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().slice(0, 3) })}
              />
              <datalist id="ccy-presets">{COMMON_CODES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Exchange rate</div>
              <input className="input tabular-nums w-36" inputMode="decimal" placeholder="1.0"
                value={draft.exchange_rate}
                onChange={(e) => setDraft({ ...draft, exchange_rate: e.target.value })}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">As of date</div>
              <DatePicker value={draft.as_of_date} onChange={(v) => setDraft({ ...draft, as_of_date: v || todayIso() })} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm mx-4">
            <div className="text-base font-semibold text-[var(--color-fg)] mb-0.5">Edit {editing.currency.code}</div>
            <div className="text-xs text-[var(--color-fg-muted)] mb-4">{getMeta(editing.currency.code).name}</div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">Exchange rate</div>
                <input className="input tabular-nums" inputMode="decimal"
                  value={editing.rate}
                  disabled={editing.currency.is_default}
                  onChange={(e) => setEditing({ ...editing, rate: e.target.value })}
                />
                {editing.currency.is_default && (
                  <div className="text-xs text-[var(--color-fg-muted)] mt-1">Default currency rate is always 1</div>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--color-fg-2)] mb-1">As of date</div>
                <DatePicker value={editing.asOf}
                  onChange={(v) => setEditing({ ...editing, asOf: v || editing.asOf })} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg-soft)] border-b border-[var(--color-border)]">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Code</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Name</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide hidden md:table-cell">Short name</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide hidden lg:table-cell">Country</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide hidden md:table-cell">Symbol</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide hidden lg:table-cell">Decimal places</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Status</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[var(--color-fg-muted)] uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-[var(--color-fg-muted)]">No currencies found.</td>
              </tr>
            ) : filtered.map((c) => {
              const m = getMeta(c.code);
              return (
                <tr key={c.id} className="hover:bg-[var(--color-bg-hover)]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {c.is_default && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--color-warning)" xmlns="http://www.w3.org/2000/svg" aria-label="Default currency">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                        </svg>
                      )}
                      <span className="font-mono font-medium text-[var(--color-fg)]">{c.code}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-fg-2)]">{m.name}</td>
                  <td className="px-4 py-3 text-[var(--color-fg-2)] hidden md:table-cell">{m.shortName}</td>
                  <td className="px-4 py-3 text-[var(--color-fg-2)] hidden lg:table-cell">{m.country}</td>
                  <td className="px-4 py-3 font-mono text-[var(--color-fg-2)] hidden md:table-cell">{m.symbol}</td>
                  <td className="px-4 py-3 text-center text-[var(--color-fg-2)] hidden lg:table-cell">{m.decimals}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-success-soft)] text-[var(--color-success)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] inline-block" />
                      Active
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
                            <div className="fixed z-[9999] w-44 bg-white border border-[var(--color-border)] rounded-lg shadow-lg py-1"
                              style={{ top: menuPos.top, right: menuPos.right }}>
                              <button type="button"
                                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-hover)] text-[var(--color-fg-2)]"
                                onClick={() => { setEditing({ currency: c, rate: c.exchange_rate, asOf: c.as_of_date }); setOpenMenu(null); }}>
                                Edit
                              </button>
                              {!c.is_default && (
                                <button type="button"
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-hover)] text-[var(--color-fg-2)]"
                                  onClick={() => { makeDefault(c); setOpenMenu(null); }}>
                                  Set as default
                                </button>
                              )}
                              {!c.is_default && (
                                <button type="button"
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-hover)] text-[var(--color-danger)]"
                                  onClick={() => { deactivate(c); setOpenMenu(null); }}>
                                  Deactivate
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
