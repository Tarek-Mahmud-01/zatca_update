export interface UserProfile {
  id: string;
  email: string;
  role: string;
  page_size: number;
  tenant_id: string;
  created_at: string;
}

export interface ProfileUpdate {
  page_size: number;
}

export interface ChangePassword {
  current_password: string;
  new_password: string;
}
