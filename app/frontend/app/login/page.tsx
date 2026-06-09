"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginApi } from "./_api";
import { Banner, Field, Input } from "../../components/ui";
import { AuthLayout, SubmitButton, AuthAltLink } from "../../components/AuthLayout";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@demo.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { access_token } = await loginApi.login(email, password);
      document.cookie = `token=${access_token}; path=/; max-age=43200; SameSite=Lax`;
      router.push("/dashboard");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in" description="Welcome back.">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        {/* Email — controlled by `email` state */}
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        {/* Password — controlled by `password` state */}
        <Field label="Password" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        {/* Error — only shown when a login attempt failed */}
        {error && <Banner tone="danger">{error}</Banner>}
        {/* Submit — disabled + spinner label while the request is in flight */}
        <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
        {/* Footer — route new tenants to signup */}
        <AuthAltLink prompt="Don't have an account?" href="/signup" label="Create tenant" />
      </form>
    </AuthLayout>
  );
}
