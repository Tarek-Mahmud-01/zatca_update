"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api-client";
import { Banner, Card, Field, FieldGrid } from "../../components/ui";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    tenant_name: "",
    vat_number: "",
    organization_identifier: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function upd<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { access_token } = await api.signup(form);
      document.cookie = `token=${access_token}; path=/; max-age=43200; SameSite=Lax`;
      router.push("/dashboard");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg-muted)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <Link href="/" className="text-lg font-semibold text-[var(--color-fg)] tracking-tight">
            ZATCA <span className="text-[var(--color-fg-muted)] font-normal">Phase 2</span>
          </Link>
        </div>
        <Card title="Create tenant" description="A tenant is one company that issues invoices. Each tenant has its own CSIDs, customers, and product catalog.">
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <Field label="Company name" required>
              <input className="input" value={form.tenant_name} onChange={(e) => upd("tenant_name", e.target.value)} required />
            </Field>
            <FieldGrid cols={2}>
              <Field label="VAT number" required hint="15 digits">
                <input className="input font-mono" value={form.vat_number} onChange={(e) => upd("vat_number", e.target.value)} required maxLength={15} />
              </Field>
              <Field label="Organization identifier" required hint="15 digits">
                <input className="input font-mono" value={form.organization_identifier} onChange={(e) => upd("organization_identifier", e.target.value)} required maxLength={15} />
              </Field>
            </FieldGrid>
            <FieldGrid cols={2}>
              <Field label="Admin email" required>
                <input className="input" type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} required autoComplete="email" />
              </Field>
              <Field label="Password" required hint="At least 8 characters">
                <input className="input" type="password" value={form.password} onChange={(e) => upd("password", e.target.value)} required minLength={8} autoComplete="new-password" />
              </Field>
            </FieldGrid>
            {error && <Banner tone="danger">{error}</Banner>}
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? "Creating…" : "Create tenant"}
            </button>
            <div className="text-sm text-[var(--color-fg-muted)] text-center">
              Already have one?{" "}
              <Link href="/login" className="text-[var(--color-accent)] hover:underline">Sign in</Link>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
