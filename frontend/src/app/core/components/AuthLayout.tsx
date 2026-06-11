"use client";

import React from "react";
import Link from "next/link";
import { Card } from "./ui";

/* ---------------------------------------------------------------------------
 * AuthLayout — shared shell for the login / signup pages: muted full-height
 * background, a width-capped centered column, the ZATCA brand mark, and the
 * titled Card that wraps the form. Pages supply only their form as children.
 * -------------------------------------------------------------------------- */
export function AuthLayout({
  title, description, width = "md", children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  width?: "md" | "xl";
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[var(--color-bg-muted)] flex items-center justify-center px-4 py-12">
      <div className={`w-full ${width === "xl" ? "max-w-xl" : "max-w-md"}`}>
        <BrandMark />
        <Card title={title} description={description}>{children}</Card>
      </div>
    </main>
  );
}

/* Brand mark above the card; links back to the marketing home. */
function BrandMark() {
  return (
    <div className="mb-6 text-center">
      <Link href="/" className="text-lg font-semibold text-[var(--color-fg)] tracking-tight">
        ZATCA <span className="text-[var(--color-fg-muted)] font-normal">Phase 2</span>
      </Link>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * SubmitButton — primary form button that disables itself and swaps its label
 * for `busyLabel` while a request is in flight.
 * -------------------------------------------------------------------------- */
export function SubmitButton({
  busy, busyLabel, children,
}: {
  busy: boolean;
  busyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button className="btn btn-primary" disabled={busy} type="submit">
      {busy ? busyLabel : children}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * AuthAltLink — footer prompt pointing to the other auth page
 * (e.g. "Don't have an account? Create tenant").
 * -------------------------------------------------------------------------- */
export function AuthAltLink({
  prompt, href, label,
}: {
  prompt: React.ReactNode;
  href: string;
  label: React.ReactNode;
}) {
  return (
    <div className="text-sm text-[var(--color-fg-muted)] text-center">
      {prompt}{" "}
      <Link href={href} className="text-[var(--color-accent)] hover:underline">{label}</Link>
    </div>
  );
}
