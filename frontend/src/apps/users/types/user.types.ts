export interface TenantUser {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  created_at: string;
  is_me: boolean;
  default_branch_id: string | null;
}

export type InviteBody = {
  email: string;
  password: string;
  role: string;
  default_branch_id?: string | null;
};
