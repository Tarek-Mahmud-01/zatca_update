"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api-client";
import { Banner, Card, Field } from "../../components/ui";

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
      const { access_token } = await api.login(email, password);
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
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="text-lg font-semibold text-[var(--color-fg)] tracking-tight">
            ZATCA <span className="text-[var(--color-fg-muted)] font-normal">Phase 2</span>
          </Link>
        </div>
        <Card title="Sign in" description="Welcome back.">
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <Field label="Email" required>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password" required>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            {error && <Banner tone="danger">{error}</Banner>}
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <div className="text-sm text-[var(--color-fg-muted)] text-center">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-[var(--color-accent)] hover:underline">Create tenant</Link>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
