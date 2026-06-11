"use client";
import React, { useEffect, useState } from "react";
import { Banner, Card, Empty, PageHeader, Tabs } from "@/app/core/components/ui";
import { financeApi } from "../services/finance.api";
import { getToken } from "@/apps/auth/utils/token";
import type { Currency, ExchangeRate } from "../types/finance.types";

export default function FinancePage() {
  const [tab, setTab] = useState<"currencies" | "rates">("currencies");
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    financeApi.listCurrencies(token).then(setCurrencies).catch(() => setError("Failed to load currencies."));
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token || tab !== "rates") return;
    financeApi.listRates(token).then((r) => setRates(r.items)).catch(() => {});
  }, [tab]);

  return (
    <div className="space-y-6">
      <PageHeader title="Finance" description="Global currencies and exchange rates" />
      {error && <Banner tone="danger">{error}</Banner>}
      <Tabs
        items={[
          { id: "currencies", label: "Currencies" },
          { id: "rates", label: "Exchange Rates" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />

      {tab === "currencies" && (
        <Card>
          {currencies.length === 0 ? (
            <Empty title="No currencies yet." />
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[var(--color-fg-muted)] border-b border-[var(--color-border)]"><th className="pb-2">Code</th><th className="pb-2">Name</th><th className="pb-2">Default</th></tr></thead>
              <tbody>
                {currencies.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 font-mono font-semibold">{c.code}</td>
                    <td className="py-2">{c.name || "—"}</td>
                    <td className="py-2">{c.is_default ? <span className="badge badge-success">Default</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "rates" && (
        <Card>
          {rates.length === 0 ? (
            <Empty title="No exchange rates yet." />
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[var(--color-fg-muted)] border-b border-[var(--color-border)]"><th className="pb-2">Currency</th><th className="pb-2">Rate</th><th className="pb-2">Date</th></tr></thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 font-mono">{r.currency.code}</td>
                    <td className="py-2">{r.rate}</td>
                    <td className="py-2">{r.as_of_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
