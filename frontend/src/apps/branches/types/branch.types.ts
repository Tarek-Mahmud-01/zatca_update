export interface TenantBranch {
  id: string;
  organization_id: string;       // FK → TenantOrganization.id
  name: string;
  code: string | null;
  street: string | null;
  building_number: string | null;
  city_subdivision: string | null;
  city: string | null;
  postal_zone: string | null;
  country_code: string;
  is_default: boolean;
}

export type BranchBody = Partial<TenantBranch> & { organization_id: string };
