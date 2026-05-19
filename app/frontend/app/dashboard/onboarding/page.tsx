"use client";

import { useEffect, useState } from "react";
import { api, type ComplianceCheckResponse, type CompliancePreviewItem } from "../../../lib/api-client";
import { getToken } from "../../../lib/token";
import { useActiveEnv } from "../../../lib/active-env";
import { EnvBadge } from "../../../components/EnvSwitcher";
import { Banner, Card, Field, FieldGrid, PageHeader, Tabs } from "../../../components/ui";

const INVOICE_TYPE_PRESETS = [
  { value: "1100", label: "1100 — Standard + Simplified", explain: "Most common — B2B (clearance) AND B2C (reporting). Six demo invoices each." },
  { value: "1000", label: "1000 — Standard only",          explain: "B2B only (clearance). Six demo invoices." },
  { value: "0100", label: "0100 — Simplified only",        explain: "B2C only (reporting). Six demo invoices." },
];

type Step = "1" | "2" | "3" | "4" | "5";
const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: "1", label: "CSR" },
  { id: "2", label: "Compliance CSID" },
  { id: "3", label: "Demo invoices" },
  { id: "4", label: "Production CSID" },
  { id: "5", label: "Done" },
];

export default function OnboardingPage() {
  const [env] = useActiveEnv();

  const [step, setStep] = useState<Step>("1");
  const [csidId, setCsidId] = useState<string | null>(null);
  const [csrPem, setCsrPem] = useState("");
  // Sandbox uses a fixed test OTP — pre-fill so users can't fat-finger it.
  const [otp, setOtp] = useState(env === "sandbox" ? "123456" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<ComplianceCheckResponse | null>(null);
  const [previewItems, setPreviewItems] = useState<CompliancePreviewItem[]>([]);

  // Re-fill the test OTP when the user switches to sandbox; clear it when
  // switching to a non-sandbox env so they don't accidentally submit the
  // sandbox value to simulation/production.
  useEffect(() => {
    setOtp(env === "sandbox" ? "123456" : "");
  }, [env]);

  const [config, setConfig] = useState({
    common_name:                "GuruERP-ARAH",
    serial_number:              "1-DTG|2-GuruERP|3-V320252",
    organization_identifier:    "300025187600003",
    organization_unit_name:     "Al-Rukn Al-Hasan Trading Establishment",
    organization_name:          "Al-Rukn Al-Hasan Trading Establishment",
    country_name:               "SA",
    invoice_type:               "1100",
    location_address:           "Riyadh, Al-Naseem Al-Sharqi, Abdullah bin Suleim, 11689",
    industry_business_category: "Trading for Cooling Spare Parts",
  });

  useEffect(() => {
    const token = getToken();
    if (!token || !csidId || step !== "3") return;
    api.previewComplianceCheck(token, csidId).then(setPreviewItems).catch(() => setPreviewItems([]));
  }, [csidId, step]);

  function upd(k: keyof typeof config, v: string) { setConfig((c) => ({ ...c, [k]: v })); }

  async function generate() {
    const token = getToken();
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const res = await api.generateCsr(token, env, config);
      setCsidId(res.csid_id);
      setCsrPem(res.csr_pem);
      setStep("2");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function issueCcsid() {
    const token = getToken();
    if (!token || !csidId) return;
    setBusy(true); setError(null);
    try { await api.issueCompliance(token, csidId, otp); setStep("3"); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function runChecks() {
    const token = getToken();
    if (!token || !csidId) return;
    setBusy(true); setError(null);
    try {
      const res = await api.runComplianceCheck(token, csidId);
      setCheckResult(res);
      if (res.all_passed) setStep("4");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function promote() {
    const token = getToken();
    if (!token || !csidId) return;
    setBusy(true); setError(null);
    try { await api.issueProduction(token, csidId); setStep("5"); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Onboarding"
        description={<>All requests below target <strong>{env}</strong>. Switch in the sidebar if needed.</>}
        actions={<EnvBadge />}
      />

      <Tabs<Step>
        value={step}
        onChange={(s) => { /* purely informational — driven by progress */ }}
        items={STEPS.map((s) => ({ id: s.id, label: `${s.id}. ${s.label}`, disabled: s.id !== step }))}
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {step === "1" && (
        <Card title="CSR config">
          <div className="flex flex-col gap-5">
            <Field label="Invoice-type bitmask" required hint={INVOICE_TYPE_PRESETS.find((p) => p.value === config.invoice_type)?.explain}>
              <select className="input" value={config.invoice_type} onChange={(e) => upd("invoice_type", e.target.value)}>
                {INVOICE_TYPE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>

            <FieldGrid cols={2}>
              <Field label="Common name" required>
                <input className="input" value={config.common_name} onChange={(e) => upd("common_name", e.target.value)} />
              </Field>
              <Field label="Serial number" required hint="Format: 1-{solution}|2-{model}|3-{uuid}">
                <input className="input" value={config.serial_number} onChange={(e) => upd("serial_number", e.target.value)} />
              </Field>
              <Field label="Organization identifier" required hint="15 digits">
                <input className="input font-mono" value={config.organization_identifier} onChange={(e) => upd("organization_identifier", e.target.value)} maxLength={15} />
              </Field>
              <Field label="Organization unit name" required>
                <input className="input" value={config.organization_unit_name} onChange={(e) => upd("organization_unit_name", e.target.value)} />
              </Field>
              <Field label="Organization name" required>
                <input className="input" value={config.organization_name} onChange={(e) => upd("organization_name", e.target.value)} />
              </Field>
              <Field label="Country code">
                <input className="input" value={config.country_name} onChange={(e) => upd("country_name", e.target.value.toUpperCase())} maxLength={2} />
              </Field>
            </FieldGrid>

            <Field label="Location address" required>
              <input className="input" value={config.location_address} onChange={(e) => upd("location_address", e.target.value)} />
            </Field>
            <Field label="Industry / business category" required>
              <input className="input" value={config.industry_business_category} onChange={(e) => upd("industry_business_category", e.target.value)} />
            </Field>

            <div>
              <button className="btn btn-primary" onClick={generate} disabled={busy}>
                {busy ? "Generating CSR…" : "Generate CSR"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === "2" && (
        <Card
          title="Compliance CSID"
          description={
            env === "sandbox" ? (
              <>Sandbox accepts the fixed test OTP <code className="font-mono px-1.5 py-0.5 bg-[var(--color-bg-muted)] rounded">123456</code>. No portal visit needed.</>
            ) : (
              <>Generate a fresh OTP at <a className="text-[var(--color-accent)] hover:underline" target="_blank" rel="noreferrer" href="https://fatoora.zatca.gov.sa">fatoora.zatca.gov.sa</a> for org id <code className="font-mono">{config.organization_identifier}</code> and paste it below.</>
            )
          }
        >
          <details className="mb-3">
            <summary className="text-sm text-[var(--color-fg-muted)] cursor-pointer">CSR (for diagnostic)</summary>
            <pre className="mt-2 p-3 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all">{csrPem}</pre>
          </details>
          <FieldGrid cols={1}>
            <Field label="OTP" required hint={env === "sandbox" ? "Sandbox test OTP: 123456" : "From fatoora.zatca.gov.sa"}>
              <div className="flex gap-2">
                <input
                  className="input font-mono flex-1"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  autoComplete="one-time-code"
                  placeholder={env === "sandbox" ? "123456" : "Enter OTP"}
                />
                {env === "sandbox" && (
                  <button
                    type="button"
                    className="btn btn-default whitespace-nowrap"
                    onClick={() => setOtp("123456")}
                  >
                    Use test OTP
                  </button>
                )}
              </div>
            </Field>
          </FieldGrid>
          <div className="mt-4">
            <button className="btn btn-primary" onClick={issueCcsid} disabled={busy || !otp}>
              {busy ? "Requesting…" : "Request compliance CSID"}
            </button>
          </div>
        </Card>
      )}

      {step === "3" && (
        <Card
          title="Run compliance demo invoices"
          description="ZATCA requires demo invoices matching your CSR's bitmask to clear before production promotion."
        >
          {previewItems.length > 0 && !checkResult && (
            <div className="mb-4">
              <div className="label mb-2">Plan ({previewItems.length} invoices)</div>
              <ol className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {previewItems.map((p, i) => (
                  <li key={i} className="p-3 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-md">
                    <div className="font-medium text-[var(--color-fg)]">{p.scenario}</div>
                    <div className="text-xs text-[var(--color-fg-muted)] font-mono">{p.doc_type}</div>
                    <div className="text-xs text-[var(--color-fg-muted)] mt-1 leading-relaxed">{p.description}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <button className="btn btn-primary" onClick={runChecks} disabled={busy}>
            {busy ? "Running checks…" : `Run compliance demo set (${previewItems.length || "…"} invoices)`}
          </button>

          {checkResult && (
            <div className="mt-5">
              <Banner tone={checkResult.all_passed ? "success" : "danger"}>
                <strong>{checkResult.passed} / {checkResult.total}</strong> passed
                {" — "}invoice_type <code>{checkResult.invoice_type}</code>
              </Banner>
              <table className="responsive-table mt-4">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Doc type</th>
                    <th>Invoice #</th>
                    <th>HTTP</th>
                    <th>ZATCA</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {checkResult.items.map((it) => (
                    <tr key={it.invoice_number}>
                      <td data-label="Scenario"><code>{it.scenario}</code></td>
                      <td data-label="Doc type">{it.doc_type}</td>
                      <td data-label="Invoice #" className="font-mono text-xs">{it.invoice_number}</td>
                      <td data-label="HTTP">{it.http_status}</td>
                      <td data-label="ZATCA">{it.zatca_status ?? "—"}</td>
                      <td data-label="Result">
                        <span className={`badge ${it.passed ? "badge-success" : "badge-danger"}`}>
                          {it.passed ? "PASS" : "FAIL"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {step === "4" && (
        <Card title="Production CSID" description="Compliance checks passed. Promote to production now.">
          <button className="btn btn-primary" onClick={promote} disabled={busy}>
            {busy ? "Requesting PCSID…" : "Issue production CSID"}
          </button>
        </Card>
      )}

      {step === "5" && (
        <Card>
          <Banner tone="success">
            <strong>Onboarding complete for {env}.</strong> You can now send live invoices through the API on this environment.
          </Banner>
        </Card>
      )}
    </div>
  );
}
