"use client";
import React, { useEffect, useState } from "react";
import { Banner, Card, Field, FieldGrid, PageHeader } from "@/app/core/components/ui";
import { accountApi } from "../services/account.api";
import type { UserProfile } from "../types/account.types";

export default function AccountPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    accountApi.me().then((p) => { setProfile(p); setPageSize(p.page_size); }).catch(() => {});
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    try {
      const updated = await accountApi.updateProfile({ page_size: pageSize });
      setProfile(updated);
      setSuccess("Preferences saved.");
    } catch { setError("Failed to save preferences."); }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    try {
      await accountApi.changePassword({ current_password: currentPw, new_password: newPw });
      setSuccess("Password changed.");
      setCurrentPw(""); setNewPw("");
    } catch { setError("Password change failed."); }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Account" description="Profile and security settings" />
      {error && <Banner tone="danger">{error}</Banner>}
      {success && <Banner tone="success">{success}</Banner>}

      <Card>
        <h2 className="font-semibold mb-4">Profile</h2>
        {profile && (
          <FieldGrid>
            <Field label="Email"><span className="text-sm">{profile.email}</span></Field>
            <Field label="Role"><span className="text-sm capitalize">{profile.role}</span></Field>
          </FieldGrid>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold mb-4">Preferences</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <Field label="Page size">
            <input
              type="number" min={10} max={200} value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="input w-32"
            />
          </Field>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </Card>

      <Card>
        <h2 className="font-semibold mb-4">Change Password</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Current password">
            <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} className="input" required />
          </Field>
          <Field label="New password">
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="input" minLength={8} required />
          </Field>
          <button type="submit" className="btn btn-primary">Change Password</button>
        </form>
      </Card>
    </div>
  );
}
