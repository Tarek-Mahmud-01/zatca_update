import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-bg-muted)] px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[var(--color-border)] text-xs text-[var(--color-fg-muted)] mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
          KSA · ZATCA Phase 2
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-fg)]">
          Multi-tenant e-invoicing
        </h1>
        <p className="mt-3 text-[var(--color-fg-muted)] leading-relaxed">
          Java-free implementation. Sign, hash, QR, and submit invoices to ZATCA's
          clearance and reporting endpoints from a single dashboard.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
          <Link href="/login"  className="btn btn-primary w-full sm:w-auto">Sign in</Link>
          <Link href="/signup" className="btn btn-default w-full sm:w-auto">Create tenant</Link>
        </div>
      </div>
    </main>
  );
}
