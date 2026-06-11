export interface Customer {
  id: string;
  external_id: string | null;
  name: string;
  vat_number: string | null;
  crn: string | null;
  email: string | null;
  phone: string | null;
  street: string;
  building_number: string;
  city_subdivision: string;
  city: string;
  postal_zone: string;
  country_code: string;
}
