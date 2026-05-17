/**
 * UN/EDIFACT and UN/CEFACT enumerations that ZATCA accepts.
 *
 * Sources:
 *   PaymentMeansCode  -> UN/EDIFACT 4461 (subset accepted by ZATCA)
 *   TaxCategoryCode   -> UN/CEFACT 5305  (S/Z/E/O/G)
 *   ExemptionReason   -> ZATCA's KSA-specific VATEX-SA-* codes
 */

export interface PaymentMethod {
  code: string;
  label: string;
  hint: string;
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  { code: "10", label: "Cash",                 hint: "Walk-in, physical currency" },
  { code: "30", label: "Credit transfer",      hint: "Bank wire / SARIE" },
  { code: "42", label: "Payment to bank acct", hint: "Direct deposit to a named bank account" },
  { code: "48", label: "Bank card",            hint: "Mada / Visa / Mastercard at POS" },
  { code: "1",  label: "Instrument not defined", hint: "Generic / unspecified" },
  { code: "31", label: "Debit transfer",       hint: "Pull from buyer's account" },
  { code: "49", label: "Direct debit",         hint: "Standing instruction" },
  { code: "91", label: "Banker's draft",       hint: "Issued cheque drawn on a bank" },
  { code: "97", label: "Account / pay later",  hint: "On invoice terms (Net 30 etc.)" },
];

export const PAYMENT_METHOD_BY_CODE: Record<string, PaymentMethod> =
  Object.fromEntries(PAYMENT_METHODS.map((p) => [p.code, p]));


export interface VatCategory {
  code: "S" | "Z" | "E" | "O" | "G";
  label: string;
  defaultPercent: number;
  requiresExemptionReason: boolean;
  hint: string;
  /** Suggested ZATCA VATEX-SA-* code; empty for S (standard rated). */
  defaultExemptionCode?: string;
  defaultExemptionReason?: string;
}

export const VAT_CATEGORIES: VatCategory[] = [
  {
    code: "S", label: "Standard rated 15%", defaultPercent: 15,
    requiresExemptionReason: false,
    hint: "Default for most goods/services. 15% VAT applies.",
  },
  {
    code: "Z", label: "Zero rated 0%", defaultPercent: 0,
    requiresExemptionReason: true,
    defaultExemptionCode: "VATEX-SA-32",
    defaultExemptionReason: "Export of services",
    hint: "0% but reportable. Common for basic food, medicines, exports of services.",
  },
  {
    code: "E", label: "Exempt", defaultPercent: 0,
    requiresExemptionReason: true,
    defaultExemptionCode: "VATEX-SA-29",
    defaultExemptionReason: "Financial services",
    hint: "Out of the VAT system entirely (e.g. residential rent, financial services).",
  },
  {
    code: "O", label: "Out of scope", defaultPercent: 0,
    requiresExemptionReason: true,
    defaultExemptionCode: "VATEX-SA-OOS",
    defaultExemptionReason: "Out of scope of VAT",
    hint: "Transactions outside the scope of Saudi VAT.",
  },
  {
    code: "G", label: "Export of goods 0%", defaultPercent: 0,
    requiresExemptionReason: true,
    defaultExemptionCode: "VATEX-SA-EXP",
    defaultExemptionReason: "Export of goods outside KSA",
    hint: "Zero-rated export of goods. Use export_invoice doc type for full export semantics.",
  },
];

export const VAT_BY_CODE: Record<string, VatCategory> =
  Object.fromEntries(VAT_CATEGORIES.map((v) => [v.code, v]));
