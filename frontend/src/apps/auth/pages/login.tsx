"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginApi } from "@/apps/auth/services/auth.api";
import { Banner, Field, Input } from "@/app/core/components/ui";
import { AuthLayout, SubmitButton, AuthAltLink } from "@/app/core/components/AuthLayout";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("admin@demo.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { access_token, expires_in } = await loginApi.login(email, password, rememberMe);
      // Cookie lifetime matches the JWT: persistent if remember_me, session-only if not.
      const maxAge = rememberMe ? expires_in : "";
      document.cookie = `token=${access_token}; path=/; ${maxAge ? `max-age=${maxAge};` : ""} SameSite=Lax`;
      const next = searchParams.get("next") ?? "/dashboard";
      router.push(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in" description="Welcome back.">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="Password" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-[var(--color-fg-2)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          Keep me signed in
        </label>
        {error && <Banner tone="danger">{error}</Banner>}
        <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
        <AuthAltLink prompt="Don't have an account?" href="/signup" label="Create tenant" />
      </form>
    </AuthLayout>
  );
}
