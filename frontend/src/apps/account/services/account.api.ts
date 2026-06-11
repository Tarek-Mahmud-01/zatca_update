import { request } from "@/apps/http/client";
import type { UserProfile, ProfileUpdate, ChangePassword } from "../types/account.types";

export const accountApi = {
  me: () => request<UserProfile>("/api/v1/account/me"),
  updateProfile: (data: ProfileUpdate) =>
    request<UserProfile>("/api/v1/account/profile", { method: "PATCH", body: JSON.stringify(data) }),
  changePassword: (data: ChangePassword) =>
    request<{ message: string }>("/api/v1/account/change-password", { method: "POST", body: JSON.stringify(data) }),
};
