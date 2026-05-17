"use client";

import { useActiveEnv, type Env } from "../../../../lib/active-env";
import { Banner, Card, PageHeader } from "../../../../components/ui";

const OPTIONS: ReadonlyArray<{
  value: Env;
  label: string;
  tone: "neutral" | "warning" | "danger";
  blurb: string;
  bullets: string[];
}> = [
  {
    value: "sandbox",
    label: "Sandbox",
    tone: "neutral",
    blurb: "ZATCA developer portal. For first integration and smoke tests.",
    bullets: [
      "OTPs still required per CSR — generate at fatoora.zatca.gov.sa.",
      "Submitted invoices never count against your tax record.",
      "Best place to verify CSR layout and signing flow.",
    ],
  },
  {
    value: "simulation",
    label: "Simulation",
    tone: "warning",
    blurb: "Pre-prod mirror of production. Used for UAT before going live.",
    bullets: [
      "Mirrors production behavior and validation rules.",
      "Recommended for end-to-end testing with real OTPs.",
      "Submitted invoices stay in the simulation environment.",
    ],
  },
  {
    value: "production",
    label: "Production",
    tone: "danger",
    blurb: "Live submissions. Every invoice posted here is a real tax record.",
    bullets: [
      "Requires a production CSID (PCSID).",
      "Invoices are reported / cleared with ZATCA in real time.",
      "Use only after Simulation testing has passed end-to-end.",
    ],
  },
];

export default function ApiTargetSettingsPage() {
  const [env, setEnv] = useActiveEnv();

  return (
    <div>
      <PageHeader
        title="API target"
        description="Which ZATCA environment every onboarding and invoice action talks to. The selection persists per browser."
      />

      {env === "production" && (
        <div className="mb-4">
          <Banner tone="danger">
            <strong>Production is active.</strong> All API calls hit ZATCA's live endpoints — every invoice you submit is a real tax record.
          </Banner>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {OPTIONS.map((opt) => {
          const active = opt.value === env;
          const ring =
            active
              ? opt.tone === "danger"  ? "border-[var(--color-danger)]/60 bg-[var(--color-danger-soft)]"
              : opt.tone === "warning" ? "border-[var(--color-warning)]/60 bg-[var(--color-warning-soft)]"
              :                          "border-[var(--color-accent)]/60 bg-[var(--color-bg-soft)]"
              : "border-[var(--color-border)] bg-white";

          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEnv(opt.value)}
              className={`text-left p-4 border rounded-lg transition-colors hover:bg-[var(--color-bg-hover)] ${ring}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-[var(--color-fg)]">{opt.label}</div>
                {active && (
                  <span className={`badge ${opt.tone === "danger" ? "badge-danger" : opt.tone === "warning" ? "badge-warning" : "badge-neutral"}`}>
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-fg-muted)] mt-2 leading-relaxed">{opt.blurb}</p>
              <ul className="mt-3 text-xs text-[var(--color-fg-2)] flex flex-col gap-1.5">
                {opt.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[var(--color-fg-faint)] shrink-0">•</span>
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <Card className="mt-6" title="Where this matters" description="Pages that read the active API target.">
        <ul className="text-sm text-[var(--color-fg-2)] flex flex-col gap-1.5">
          <li>• Onboarding wizard — CSR, OTP, Compliance CSID, Production CSID.</li>
          <li>• New invoice — every submission goes to this environment.</li>
          <li>• Batch upload — same.</li>
          <li>• Invoices list — only invoices submitted to this env are routed through the queue.</li>
        </ul>
        <p className="text-xs text-[var(--color-fg-muted)] mt-3">
          Each page also has a per-action override dropdown if you need to send one invoice to a different environment without flipping the global setting.
        </p>
      </Card>
    </div>
  );
}
