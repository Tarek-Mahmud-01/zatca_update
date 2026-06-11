export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  unit_price: string;
  unit_code: string;
  tax_category: "S" | "Z" | "E" | "O" | "G";
  tax_percent: string;
}
