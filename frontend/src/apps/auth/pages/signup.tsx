"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signupApi } from "@/apps/auth/services/auth.api";
import { Banner, Field, FieldGrid, Input } from "@/app/core/components/ui";
import { AuthLayout, SubmitButton, AuthAltLink } from "@/app/core/components/AuthLayout";

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
      const { access_token } = await signupApi.signup(form);
      document.cookie = `token=${access_token}; path=/; max-age=43200; SameSite=Lax`;
      router.push("/dashboard");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create tenant"
      description="A tenant is one company that issues invoices. Each tenant has its own CSIDs, customers, and product catalog."
      width="xl"
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        {/* Company name — controlled by form.tenant_name */}
        <Field label="Company name" required>
          <Input value={form.tenant_name} onChange={(e) => upd("tenant_name", e.target.value)} required />
        </Field>
        {/* Tax identifiers — two columns on desktop */}
        <FieldGrid cols={2}>
          {/* VAT number — 15-digit, monospace */}
          <Field label="VAT number" required hint="15 digits">
            <Input className="font-mono" value={form.vat_number} onChange={(e) => upd("vat_number", e.target.value)} required maxLength={15} />
          </Field>
          {/* Organization identifier — 15-digit, monospace */}
          <Field label="Organization identifier" required hint="15 digits">
            <Input className="font-mono" value={form.organization_identifier} onChange={(e) => upd("organization_identifier", e.target.value)} required maxLength={15} />
          </Field>
        </FieldGrid>
        {/* Admin credentials — two columns on desktop */}
        <FieldGrid cols={2}>
          {/* Admin email — controlled by form.email */}
          <Field label="Admin email" required>
            <Input type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} required autoComplete="email" />
          </Field>
          {/* Password — controlled by form.password, min 8 chars */}
          <Field label="Password" required hint="At least 8 characters">
            <Input type="password" value={form.password} onChange={(e) => upd("password", e.target.value)} required minLength={8} autoComplete="new-password" />
          </Field>
        </FieldGrid>
        {/* Error — only shown when signup failed */}
        {error && <Banner tone="danger">{error}</Banner>}
        {/* Submit — disabled + spinner label while the request is in flight */}
        <SubmitButton busy={busy} busyLabel="Creating…">Create tenant</SubmitButton>
        {/* Footer — route existing tenants to sign in */}
        <AuthAltLink prompt="Already have one?" href="/login" label="Sign in" />
      </form>
    </AuthLayout>
  );
}
