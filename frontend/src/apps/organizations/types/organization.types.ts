export interface TenantOrganization {
  id: string;
  name: string;
  trade_name: string | null;
  vat_number: string | null;
  registration_number: string | null;
  street: string | null;
  building_number: string | null;
  city_subdivision: string | null;
  city: string | null;
  postal_zone: string | null;
  country_code: string;
  is_default: boolean;
}
