"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  type BusinessSettings,
  type Customer,
  type Product,
  type TenantBranch,
  type TenantCurrency,
  type TenantOrganization,
} from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { useActiveEnv } from "../../../../lib/active-env";
import { EnvBadge } from "../../../../components/EnvSwitcher";
import { Banner, Card, Field, FieldGrid, PageHeader, Tabs } from "../../../../components/ui";
import { DatePicker } from "../../../../components/DatePicker";
import { SearchSelect } from "../../../../components/SearchSelect";
import { pushNotification, suppressQueuedEcho } from "../../../../lib/notifications";
import { PAYMENT_METHODS, VAT_BY_CODE, VAT_CATEGORIES } from "../../../../lib/catalog";

const DOC_TYPES = [
  { value: "simplified_invoice",       label: "Simplified Invoice (B2C)" },
  { value: "simplified_credit_note",   label: "Simplified Credit Note" },
  { value: "simplified_debit_note",    label: "Simplified Debit Note" },
  { value: "standard_invoice",         label: "Standard Invoice (B2B)" },
  { value: "standard_credit_note",     label: "Standard Credit Note" },
  { value: "standard_debit_note",      label: "Standard Debit Note" },
  { value: "export_invoice",           label: "Export Invoice" },
  { value: "summary_invoice",          label: "Summary Invoice" },
  { value: "self_billing_invoice",     label: "Self-billing Invoice" },
  { value: "advance_payment_invoice",  label: "Advance Payment Invoice" },
  { value: "nominal_supply_invoice",   label: "Nominal Supply Invoice" },
] as const;

type DocType = (typeof DOC_TYPES)[number]["value"];
type TabId = "details" | "lines" | "review";

interface LineForm {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  quantity: string;
  unit_code: string;
  unit_price: string;
  vat_code: "S" | "Z" | "E" | "O" | "G";
  vat_percent: string;
  discount_value: string;                 // raw entered value (percent or amount)
  discount_mode: "amount" | "percent";    // how discount_value is interpreted
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** The absolute discount amount for a line, resolving percent vs amount mode. */
function lineDiscountAmount(l: LineForm): number {
  const gross = Number(l.quantity || 0) * Number(l.unit_price || 0);
  const v = Math.max(0, Number(l.discount_value || 0));
  if (l.discount_mode === "percent") return round2(Math.min(100, v) / 100 * gross);
  return round2(Math.min(v, gross));
}

function computeLine(l: LineForm) {
  const qty = Number(l.quantity || 0);
  const price = Number(l.unit_price || 0);
  const disc = lineDiscountAmount(l);
  const percent = Number(l.vat_percent || 0);
  const lineExt = round2(qty * price - disc);
  const tax = round2((lineExt * percent) / 100);
  return { lineExt, tax, rounding: round2(lineExt + tax), percent, discount: disc };
}

function newLine(n: number): LineForm {
  return {
    id: String(n), product_id: "", sku: "", name: "",
    quantity: "1", unit_code: "PCE", unit_price: "0.00",
    vat_code: "S", vat_percent: "15", discount_value: "0", discount_mode: "amount",
  };
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [env, setEnv] = useActiveEnv();
  const [tab, setTab] = useState<TabId>("details");

  const [docType, setDocType] = useState<DocType>("simplified_invoice");
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${new Date().getTime().toString().slice(-6)}`);
  const [issueDate, setIssueDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("10");
  const [billingRefId, setBillingRefId] = useState("");
  const [instructionCode, setInstructionCode] = useState("");
  const [instructionNote, setInstructionNote] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<LineForm[]>([newLine(1)]);
  const [activeNameLine, setActiveNameLine] = useState<number | null>(null);
  // Refs + floating-dropdown position so the autocomplete escapes the
  // scrollable items list. We compute `position: fixed` coordinates from
  // the focused input's bounding rect and update on scroll/resize.
  const nameInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const linesScrollRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number; width: number } | null>(null);
  // Invoice-level (document-level) allowance: reduces the taxable base
  // proportionally across every line, so VAT is recomputed on the discounted
  // total. Sent as `allowance_total` in monetary_totals.
  const [invoiceDiscountMode, setInvoiceDiscountMode] = useState<"percent" | "amount">("percent");
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState<string>("0");
  // Reference-invoice picker (only for credit/debit notes).
  const [refSearch, setRefSearch] = useState("");
  const [refResults, setRefResults] = useState<Array<{ id: string; invoice_number: string | null; icv: number; doc_type: string; customer_name: string | null; payable_amount: string | null }>>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drives which submit buttons we show. Null → still loading.
  const [tenantStrategy, setTenantStrategy] = useState<"immediate" | "queued" | null>(null);
  // What happens when the user hits the single submit button on the Review tab.
  // Initialised from the tenant's default once we know it; user can override on
  // the Details tab.
  const [submitChoice, setSubmitChoice] = useState<"draft" | "queued" | "immediate" | null>(null);
  // Tenant business profile (currency, trade name, branch) — applied to every
  // signed invoice this page produces.
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  // Multi-currency / multi-org / multi-branch profile from /api/v1/settings/*.
  // The picked currency drives `currency` + the exchange-rate label; the
  // picked organization+branch drive the supplier block.
  const [tenantCurrencies, setTenantCurrencies] = useState<TenantCurrency[]>([]);
  const [organizations, setOrganizations] = useState<TenantOrganization[]>([]);
  const [branchList, setBranchList] = useState<TenantBranch[]>([]);
  const [selectedCurrencyId, setSelectedCurrencyId] = useState<string>("");
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  // Logged-in user's preferred branch (from /me.default_branch_id). Beats
  // the tenant-wide default branch when picking the initial selection.
  const [userDefaultBranchId, setUserDefaultBranchId] = useState<string | null>(null);

  // Editor mode, driven by the URL:
  //   ?edit=<id>  → in-place edit of a NOT-yet-issued invoice (replace same row)
  //   ?amend=<id> → issued invoice → compose a credit/debit note referencing it
  //   ?from=<id>  → legacy: prefill from a rejected invoice, create a NEW one
  //   (none)      → blank new invoice
  const [pageMode, setPageMode] = useState<"new" | "edit" | "amend">("new");
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(null);
  const [amendSourcePayable, setAmendSourcePayable] = useState<number | null>(null);

  // ------ load catalog + tenant queue config ------
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    Promise.all([api.listCustomers(token), api.listProducts(token)]).then(([cs, ps]) => {
      setCustomers(cs);
      setProducts(ps);
    }).catch((e) => setError(String(e)));
    api.getTenantSettings(token)
      .then((s) => {
        const strategy = s.queue_strategy === "queued" ? "queued" : "immediate";
        setTenantStrategy(strategy);
        setSubmitChoice((prev) => prev ?? strategy);
      })
      .catch(() => {
        setTenantStrategy("immediate");
        setSubmitChoice((prev) => prev ?? "immediate");
      });
    api.getBusinessSettings(token)
      .then(setBusiness)
      .catch(() => { /* fall back to defaults below */ });
    // /me first so we know the user's default branch before pre-selecting.
    api.me(token)
      .then((m) => setUserDefaultBranchId(m.default_branch_id ?? null))
      .catch(() => setUserDefaultBranchId(null));
    Promise.all([
      api.listCurrencies(token),
      api.listOrganizations(token),
      api.listBranches(token),
    ]).then(([ccys, orgs, brs]) => {
      setTenantCurrencies(ccys);
      setOrganizations(orgs);
      setBranchList(brs);
      setSelectedCurrencyId((prev) => prev || (ccys.find((c) => c.is_default)?.id ?? ccys[0]?.id ?? ""));
      setSelectedOrgId((prev) => prev || (orgs.find((o) => o.is_default)?.id ?? orgs[0]?.id ?? ""));
      // Branch pre-selection priority:
      //   1) the user's per-user default (if it still exists)
      //   2) the tenant-wide default branch
      //   3) the first branch on the list
      // The next effect re-checks ownership against the picked organization.
      setSelectedBranchId((prev) => {
        if (prev) return prev;
        return "";  // resolved by the user-default effect once /me + branches both land
      });
    }).catch(() => { /* leave selectors empty — UI shows "loading…" */ });
  }, []);

  // ------ "Edit & resubmit" from a rejected invoice ------
  // The list page's row-action menu links here with ?from=<id>. We fetch the
  // source invoice and pre-fill the form so the user can correct whatever
  // got it rejected and submit fresh (new ICV, new UUID). Original stays
  // rejected for audit; this creates a new invoice document.
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const amendId = searchParams.get("amend");
  const fromId = searchParams.get("from");
  const sourceId = editId || amendId || fromId;
  const mode: "edit" | "amend" | "from" | null =
    editId ? "edit" : amendId ? "amend" : fromId ? "from" : null;

  useEffect(() => {
    if (!sourceId || !mode) return;
    const token = getToken();
    if (!token) return;
    api.getInvoice(token, sourceId).then((src) => {
      const p = (src.payload_json ?? {}) as Record<string, unknown>;
      const family = String(p.doc_type ?? "simplified_invoice").startsWith("standard")
        ? "standard" : "simplified";

      // doc_type + invoice number depend on the mode.
      if (mode === "amend") {
        // Issued invoice → start from a credit note (reduction is the common
        // case). The user can flip to a debit note; we also auto-pick on submit
        // based on whether the new total is below/above the original.
        setDocType(`${family}_credit_note` as DocType);
        setInvoiceNumber(`${String(p.invoice_number ?? src.icv)}-N`);
        setBillingRefId(String(p.invoice_number ?? src.icv));
        // ZATCA BR-KSA-17 requires a reason on credit/debit notes — seed one.
        setInstructionNote(`Amendment to ${String(p.invoice_number ?? src.icv)}`);
        const prevPayable = Number((p.monetary_totals as Record<string, unknown> | undefined)?.payable_amount ?? 0);
        setAmendSourcePayable(prevPayable || null);
      } else if (mode === "edit") {
        if (typeof p.doc_type === "string") setDocType(p.doc_type as DocType);
        if (typeof p.invoice_number === "string") setInvoiceNumber(p.invoice_number);
        setEditInvoiceId(src.id);
      } else { // "from" — create a new invoice from a rejected one
        if (typeof p.doc_type === "string") setDocType(p.doc_type as DocType);
        if (typeof p.invoice_number === "string") setInvoiceNumber(`${p.invoice_number}-FIX`);
      }
      setPageMode(mode === "from" ? "new" : mode);

      if (typeof p.issue_date === "string") setIssueDate(p.issue_date);
      if (typeof p.payment_means_code === "string") setPaymentMethod(p.payment_means_code);
      // Carry over an existing note's reason (code + description) and reference
      // when editing/fixing it, so the user doesn't have to retype them.
      if (mode !== "amend") {
        if (typeof p.billing_reference_id === "string") setBillingRefId(p.billing_reference_id);
        if (typeof p.instruction_code === "string") setInstructionCode(p.instruction_code);
        if (typeof p.instruction_note === "string") setInstructionNote(p.instruction_note);
      }
      const lns = Array.isArray(p.lines) ? (p.lines as Array<Record<string, unknown>>) : [];
      if (lns.length > 0) {
        setLines(lns.map((l, i) => ({
          id: String(l.id ?? i + 1),
          product_id: "",
          sku: "",
          name: String(l.name ?? `Item ${i + 1}`),
          quantity: String(l.quantity ?? "1"),
          unit_code: String(l.unit_code ?? "PCE"),
          unit_price: String(l.unit_price ?? "0.00"),
          vat_code: ((l.tax_category as LineForm["vat_code"]) ?? "S"),
          vat_percent: String(l.tax_percent ?? "15"),
          discount_value: String(l.discount_amount ?? "0"),
          discount_mode: "amount" as const,
        })));
      }
      // No toast here — the page title ("Edit invoice" / "Amend") already makes
      // the mode obvious, and the effect can run twice in dev (React strict mode).
    }).catch(() => {/* silent — user can still create from scratch */});
  }, [sourceId, mode]);

  // Apply user's default branch as soon as both /me and the branch list are loaded.
  useEffect(() => {
    if (selectedBranchId) return;
    if (branchList.length === 0) return;
    const userBranch = userDefaultBranchId
      ? branchList.find((b) => b.id === userDefaultBranchId)
      : null;
    const fallback = branchList.find((b) => b.is_default) ?? branchList[0];
    const pick = userBranch ?? fallback;
    if (pick) {
      setSelectedBranchId(pick.id);
      // Make sure the organization matches the picked branch.
      setSelectedOrgId((prev) => prev || pick.organization_id);
    }
  }, [userDefaultBranchId, branchList, selectedBranchId]);

  // Drop the selected branch if it doesn't belong to the picked organization.
  useEffect(() => {
    if (!selectedBranchId) return;
    const br = branchList.find((b) => b.id === selectedBranchId);
    if (br && br.organization_id !== selectedOrgId) setSelectedBranchId("");
  }, [selectedOrgId, selectedBranchId, branchList]);

  // Derived: selected currency / org / branch (with safe fallbacks).
  const selectedCurrency = useMemo(
    () => tenantCurrencies.find((c) => c.id === selectedCurrencyId) ?? null,
    [tenantCurrencies, selectedCurrencyId],
  );
  const defaultCurrency = useMemo(
    () => tenantCurrencies.find((c) => c.is_default) ?? null,
    [tenantCurrencies],
  );
  const selectedOrg = useMemo(
    () => organizations.find((o) => o.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId],
  );
  const selectedBranch = useMemo(
    () => branchList.find((b) => b.id === selectedBranchId) ?? null,
    [branchList, selectedBranchId],
  );
  const branchesForOrg = useMemo(
    () => branchList.filter((b) => b.organization_id === selectedOrgId),
    [branchList, selectedOrgId],
  );

  // ------ keep the autocomplete dropdown anchored to the active input ------
  useEffect(() => {
    if (activeNameLine === null) { setDropdownPos(null); return; }
    const recompute = () => {
      const el = nameInputRefs.current.get(activeNameLine);
      if (!el) { setDropdownPos(null); return; }
      const r = el.getBoundingClientRect();
      setDropdownPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    recompute();
    const wrapper = linesScrollRef.current;
    wrapper?.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      wrapper?.removeEventListener("scroll", recompute);
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [activeNameLine]);

  // ------ load recent invoices for the reference picker (CN/DN only) ------
  const isNote = docType.endsWith("credit_note") || docType.endsWith("debit_note");
  useEffect(() => {
    const token = getToken();
    if (!token || !isNote) return;
    const handle = setTimeout(async () => {
      try {
        const page = await api.listInvoices(token, {
          page: 1, page_size: 25,
          statuses: ["cleared", "reported"],
        });
        const lower = refSearch.toLowerCase();
        const filtered = !lower
          ? page.items
          : page.items.filter((i) =>
              (i.invoice_number || "").toLowerCase().includes(lower) ||
              (i.customer_name  || "").toLowerCase().includes(lower) ||
              String(i.icv).includes(lower),
            );
        setRefResults(filtered.slice(0, 10));
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refSearch, isNote]);

  // Auto-link the reference invoice for a note from its own number: a note
  // numbered "INV-142797-CN" (or -DN) almost always references "INV-142797".
  // Only fills when the reference is still empty so it never fights the user or
  // a value loaded via the search picker / amend flow.
  useEffect(() => {
    if (!isNote || billingRefId.trim()) return;
    const m = invoiceNumber.match(/^(.+?)[-_\s]*(CN|DN)$/i);
    if (m && m[1].trim()) setBillingRefId(m[1].trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNote, invoiceNumber]);

  async function pickReferenceInvoice(id: string) {
    const token = getToken();
    if (!token) return;
    try {
      const inv = await api.getInvoice(token, id);
      const p = inv.payload_json as unknown as {
        invoice_number?: string;
        supplier?: unknown;
        customer?: { registration_name?: string; vat_number?: string | null };
        lines?: Array<{
          id?: string; name?: string;
          quantity?: string; unit_code?: string; unit_price?: string;
          tax_category?: LineForm["vat_code"]; tax_percent?: string;
          discount_amount?: string;
        }>;
      };
      // Fill the billing reference + copy customer + lines from the original.
      setBillingRefId(p.invoice_number || String(inv.icv));
      if (p.customer?.vat_number) {
        const match = customers.find((c) => c.vat_number === p.customer?.vat_number);
        if (match) setCustomerId(match.id);
      }
      if (p.lines && p.lines.length > 0) {
        setLines(p.lines.map((l, i) => ({
          id: String(l.id ?? i + 1),
          product_id: "", sku: "", name: l.name ?? "",
          quantity: l.quantity ?? "1",
          unit_code: l.unit_code ?? "PCE",
          unit_price: l.unit_price ?? "0.00",
          vat_code: l.tax_category ?? "S",
          vat_percent: l.tax_percent ?? "15",
          discount_value: l.discount_amount ?? "0",
          discount_mode: "amount" as const,
        })));
      }
      setRefSearch("");
      setRefResults([]);
      pushNotification({
        tone: "info",
        title: `Loaded reference invoice ${p.invoice_number ?? `ICV ${inv.icv}`}`,
        body: "Lines and customer copied. Edit as needed before submitting.",
      });
    } catch (e) {
      pushNotification({ tone: "danger", title: "Couldn't load reference invoice", body: String(e) });
    }
  }

  // ------ derived ------
  const needsBillingRef = docType.endsWith("credit_note") || docType.endsWith("debit_note");
  const isB2C = docType.startsWith("simplified") || docType === "nominal_supply_invoice" || docType === "advance_payment_invoice";
  const customer = useMemo(() => customers.find((c) => c.id === customerId) ?? null, [customers, customerId]);

  function matchProducts(query: string): Product[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return products
      .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }

  function applyProductToLine(idx: number, p: Product) {
    updateLine(idx, {
      product_id: p.id, sku: p.sku, name: p.name,
      unit_code: p.unit_code, unit_price: String(p.unit_price),
      vat_code: p.tax_category, vat_percent: String(p.tax_percent),
    });
    setActiveNameLine(null);
  }

  const lineExtTotal = round2(lines.reduce((s, l) => s + computeLine(l).lineExt, 0));
  const rawTaxTotal  = round2(lines.reduce((s, l) => s + computeLine(l).tax,     0));

  // Invoice-level discount → reduces taxable; VAT proportionally rescales.
  const invoiceDiscount = (() => {
    const v = Math.max(0, Number(invoiceDiscountValue || 0));
    if (invoiceDiscountMode === "percent") return round2(Math.min(100, v) / 100 * lineExtTotal);
    return round2(Math.min(v, lineExtTotal));
  })();
  const taxableTotal = round2(lineExtTotal - invoiceDiscount);
  const vatScale     = lineExtTotal > 0 ? taxableTotal / lineExtTotal : 1;
  const taxTotal     = round2(rawTaxTotal * vatScale);
  const payable      = round2(taxableTotal + taxTotal);

  // ------ line operations ------
  function updateLine(idx: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function addBlankLine() { setLines((p) => [...p, newLine(p.length + 1)]); }
  function removeLine(idx: number) { setLines((p) => p.filter((_, i) => i !== idx)); }

  // ------ required-field validation ------
  // Single source of truth for "what must be filled before we can advance /
  // submit", keyed to the tab + DOM id of the offending control so we can jump
  // there and focus it.
  type MissingField = { tab: TabId; fieldId: string; label: string };
  function collectMissing(): MissingField[] {
    const m: MissingField[] = [];
    if (!invoiceNumber.trim())
      m.push({ tab: "details", fieldId: "f-invoice-number", label: "Invoice number" });
    if (branchList.length > 0 && !selectedBranchId)
      m.push({ tab: "details", fieldId: "f-branch", label: "Branch" });
    if (needsBillingRef && !billingRefId.trim())
      m.push({ tab: "details", fieldId: "f-ref", label: "Reference invoice" });
    if (needsBillingRef && !instructionCode.trim() && !instructionNote.trim())
      m.push({ tab: "details", fieldId: "f-reason", label: "Reason (code or description)" });
    if (!isB2C && !customerId)
      m.push({ tab: "details", fieldId: "f-customer", label: "Customer" });
    const validLines = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
    if (validLines.length === 0)
      m.push({ tab: "lines", fieldId: "f-lines", label: "At least one line item (name + quantity)" });
    return m;
  }

  function focusMissing(fieldId: string) {
    // Wait a tick for the target tab to render before focusing/scrolling.
    setTimeout(() => {
      const el = document.getElementById(fieldId);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLElement).focus?.();
    }, 60);
  }

  // Forward navigation guard: block "Next" until the CURRENT tab's required
  // fields are filled, and focus the first offender.
  function goNext(target: TabId) {
    const here = collectMissing().filter((x) => x.tab === tab);
    if (here.length > 0) {
      setError(`Please complete: ${here.map((x) => x.label).join(", ")}`);
      focusMissing(here[0].fieldId);
      return;
    }
    setError(null);
    setTab(target);
  }

  // ------ submit ------
  async function submit(submitMode: "immediate" | "queued" | "draft") {
    const token = getToken();
    if (!token) return;
    // Final check: every required field across all tabs. Jump to the first
    // missing one and focus it instead of letting the request fail.
    const missing = collectMissing();
    if (missing.length > 0) {
      setError(`Missing required: ${missing.map((x) => x.label).join(", ")}`);
      setTab(missing[0].tab);
      focusMissing(missing[0].fieldId);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const subtotals = new Map<string, { code: string; percent: number; taxable: number; tax: number; exemptionCode?: string; exemptionReason?: string }>();
      for (const l of lines) {
        const c = computeLine(l);
        const key = `${l.vat_code}|${c.percent}`;
        const cur = subtotals.get(key) ?? { code: l.vat_code, percent: c.percent, taxable: 0, tax: 0 };
        // Apply the invoice-level discount proportionally so the per-category
        // taxable/tax stays internally consistent.
        cur.taxable = round2(cur.taxable + c.lineExt * vatScale);
        cur.tax     = round2(cur.tax     + c.tax     * vatScale);
        const vat = VAT_BY_CODE[l.vat_code];
        if (vat?.requiresExemptionReason) {
          cur.exemptionCode = vat.defaultExemptionCode;
          cur.exemptionReason = vat.defaultExemptionReason;
        }
        subtotals.set(key, cur);
      }

      // Supplier identity: prefer the picked organization+branch, fall back to
      // the legacy single-field business profile, then to the tenant defaults.
      const supplierName =
        selectedOrg?.trade_name || selectedOrg?.name ||
        business?.trade_name || business?.name || "Tenant supplier";
      const supplierVat = selectedOrg?.vat_number || business?.vat_number || "300000000000003";
      // Currency: pick the selected row; if it's not the base, attach an exchange-rate note.
      const documentCurrency = (selectedCurrency?.code || business?.currency || "SAR").toUpperCase();
      const supplierNotes: Array<[string, string]> = [];
      if (selectedBranch) {
        supplierNotes.push(["en", `Branch: ${selectedBranch.name}${selectedBranch.code ? ` (${selectedBranch.code})` : ""}`]);
      } else if (business?.branch_name) {
        supplierNotes.push(["en", `Branch: ${business.branch_name}`]);
      }
      if (
        selectedCurrency && defaultCurrency &&
        selectedCurrency.id !== defaultCurrency.id
      ) {
        supplierNotes.push([
          "en",
          `Currency: 1 ${selectedCurrency.code} = ${selectedCurrency.exchange_rate} ${defaultCurrency.code} (as of ${selectedCurrency.as_of_date})`,
        ]);
      }

      // Branch address takes precedence over org address (more specific).
      const addr = selectedBranch ?? selectedOrg ?? null;
      const supplierAddress = {
        street: (addr && addr.street) || "Street",
        building_number: (addr && addr.building_number) || "0001",
        city_subdivision:
          (selectedBranch && selectedBranch.city_subdivision) ||
          selectedBranch?.name ||
          (selectedOrg && selectedOrg.city_subdivision) ||
          business?.branch_name || "District",
        city: (addr && addr.city) || "Riyadh",
        postal_zone: (addr && addr.postal_zone) || "00000",
        country_code: (addr && addr.country_code) || "SA",
      };

      // In amend mode the note kind is auto-picked from the new total vs the
      // original: lower → credit note (reduction), higher → debit note (charge).
      let effectiveDocType: DocType = docType;
      if (pageMode === "amend" && amendSourcePayable != null) {
        const family = docType.startsWith("standard") ? "standard" : "simplified";
        effectiveDocType = (payable < amendSourcePayable
          ? `${family}_credit_note`
          : `${family}_debit_note`) as DocType;
      }
      const effNeedsRef = effectiveDocType.endsWith("credit_note") || effectiveDocType.endsWith("debit_note");

      const payload = {
        doc_type: effectiveDocType,
        invoice_number: invoiceNumber,
        uuid: "00000000-0000-0000-0000-000000000000",
        issue_date: issueDate,
        issue_time: now.toISOString().slice(11, 19),
        icv: 0,
        pih_b64: "",
        currency: documentCurrency,
        tax_currency: documentCurrency,
        supplier: {
          registration_name: supplierName,
          vat_number: supplierVat,
          ...supplierAddress,
        },
        customer: customer ? {
          registration_name: customer.name,
          vat_number: customer.vat_number,
          crn: customer.crn,
          street: customer.street, building_number: customer.building_number,
          city_subdivision: customer.city_subdivision, city: customer.city,
          postal_zone: customer.postal_zone, country_code: customer.country_code,
        } : (isB2C ? {
          registration_name: "Walk-in customer",
          street: "Walk-in", building_number: "0",
          city_subdivision: "N/A", city: "Riyadh",
          postal_zone: "00000", country_code: "SA",
        } : null),
        lines: lines.map((l) => {
          const c = computeLine(l);
          return {
            id: l.id, name: l.name || l.sku || `Item ${l.id}`,
            quantity: l.quantity, unit_code: l.unit_code, unit_price: l.unit_price,
            line_extension: c.lineExt.toFixed(2),
            tax_amount: c.tax.toFixed(2),
            rounding_amount: c.rounding.toFixed(2),
            tax_category: l.vat_code, tax_percent: l.vat_percent,
            // Always send the resolved absolute discount amount (percent mode
            // is a UI convenience; the wire format is the SAR amount).
            discount_amount: c.discount.toFixed(2),
            discount_reason: c.discount > 0 ? "discount" : null,
          };
        }),
        tax_subtotals: [...subtotals.values()].map((s) => ({
          taxable_amount: s.taxable.toFixed(2),
          tax_amount: s.tax.toFixed(2),
          tax_category: s.code, tax_percent: String(s.percent),
          exemption_reason_code: s.exemptionCode ?? null,
          exemption_reason: s.exemptionReason ?? null,
        })),
        monetary_totals: {
          line_extension: lineExtTotal.toFixed(2),
          tax_exclusive:  taxableTotal.toFixed(2),
          tax_inclusive:  payable.toFixed(2),
          allowance_total: invoiceDiscount.toFixed(2),
          prepaid_amount: "0",
          payable_amount: payable.toFixed(2),
        },
        document_charges: (() => {
          if (invoiceDiscount <= 0) return [];
          const cats = [...subtotals.values()];
          let remaining = invoiceDiscount;
          return cats.flatMap((s, i) => {
            const dc = i === cats.length - 1
              ? round2(remaining)
              : round2(invoiceDiscount * (taxableTotal > 0 ? s.taxable / taxableTotal : 1 / cats.length));
            remaining = round2(remaining - dc);
            if (dc <= 0) return [];
            return [{
              is_charge: false,
              reason: "Invoice discount",
              reason_code: "95",
              amount: dc.toFixed(2),
              tax_category: s.code,
              tax_percent: String(s.percent),
            }];
          });
        })(),
        payment_means_code: paymentMethod,
        instruction_code:    effNeedsRef ? (instructionCode || null) : null,
        instruction_note:    effNeedsRef ? (instructionNote || null) : null,
        billing_reference_id: effNeedsRef ? (billingRefId   || null) : null,
        notes: supplierNotes,
      };
      if (!payload.customer) throw new Error("Pick a customer (or use a simplified doc type for walk-in).");
      // Edit mode replaces the SAME not-yet-issued invoice in place; everything
      // else (new / amend / from-rejected) creates a fresh document.
      const res = pageMode === "edit" && editInvoiceId
        ? await api.replaceInvoice(token, editInvoiceId, payload, submitMode)
        : await api.submitInvoice(token, { env, payload, submit_mode: submitMode });
      const appliedMode = res.submit_mode ?? submitMode;
      const verb = pageMode === "edit" ? "Invoice updated" : pageMode === "amend" ? "Note issued" : "Invoice";
      const title =
        appliedMode === "draft"   ? (pageMode === "edit" ? "Saved (draft)" : "Saved as draft")
        : appliedMode === "queued" ? `${verb} — queued`
        : pageMode === "edit"     ? "Invoice updated & submitted"
        : pageMode === "amend"    ? `Note submitted to ${env}`
        : `Invoice submitted to ${env}`;
      // Queued submits also emit an SSE `invoice.queued` for the tenant; this
      // toast already covers it for the initiator, so suppress that echo here.
      // (Immediate submits no longer emit a queued event — the terminal
      // reported/cleared event arrives over SSE as the result notification.)
      if (appliedMode === "queued") suppressQueuedEcho(res.id);
      pushNotification({
        tone: appliedMode === "immediate" ? "success" : "info",
        title,
        body: `ICV ${res.icv}`,
        href: `/dashboard/invoices/${res.id}`,
      });
      router.push(`/dashboard/invoices/${res.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link
        href="/dashboard/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] mb-3"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to invoices
      </Link>

      <PageHeader
        title={
          pageMode === "edit" ? "Edit invoice"
          : pageMode === "amend" ? "Amend — credit / debit note"
          : "New invoice"
        }
        description={
          pageMode === "edit" ? "Editing a not-yet-issued invoice in place. Add or remove lines, change amounts."
          : pageMode === "amend" ? "Compose the note referencing the original. Credit vs debit is auto-picked from the new total."
          : undefined
        }
        actions={<EnvBadge />}
      />

      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        items={[
          { id: "details", label: "1. Details" },
          { id: "lines",   label: "2. Line items", count: lines.length },
          { id: "review",  label: "3. Review" },
        ]}
      />

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {/* TAB: DETAILS */}
      {tab === "details" && (
        <div className="flex flex-col gap-4">
          <Card title="Document">
            <FieldGrid cols={2}>
              <Field label="Document type" required>
                <SearchSelect
                  value={docType}
                  onChange={(v) => setDocType(v as DocType)}
                  options={DOC_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  searchPlaceholder="Search document types…"
                />
              </Field>
              <Field label="Invoice number" required>
                <input id="f-invoice-number" className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
              </Field>
              <Field label="Invoice date" required>
                <DatePicker
                  value={issueDate}
                  onChange={(v) => setIssueDate(v || new Date().toISOString().slice(0, 10))}
                />
              </Field>
              <Field label="Payment method">
                <SearchSelect
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  options={PAYMENT_METHODS.map((p) => ({ value: p.code, label: `${p.code} — ${p.label}` }))}
                  searchPlaceholder="Search payment methods…"
                />
              </Field>
            </FieldGrid>

            {/* Supplier identity selectors. Branch is required when the
                tenant has any branches; the single-org / single-currency
                cases are hidden (auto-picked). */}
            {(() => {
              const showOrg = organizations.length > 1;
              const showBranch = branchList.length > 0;   // require when any branch exists tenant-wide
              const showCcy = tenantCurrencies.length > 1;
              const visible = [showOrg, showBranch, showCcy].filter(Boolean).length;
              if (visible === 0) return null;
              const cols = visible === 1 ? 1 : visible === 2 ? 2 : 3;
              return (
                <FieldGrid cols={cols}>
                  {showOrg && (
                    <Field label="Organization" required>
                      <SearchSelect
                        value={selectedOrgId}
                        onChange={setSelectedOrgId}
                        options={organizations.map((o) => ({ value: o.id, label: o.name + (o.is_default ? " (default)" : "") }))}
                        searchPlaceholder="Search organizations…"
                      />
                    </Field>
                  )}
                  {showBranch && (
                    <Field label="Branch" required>
                      <SearchSelect
                        id="f-branch"
                        value={selectedBranchId}
                        onChange={setSelectedBranchId}
                        placeholder="— select branch —"
                        options={branchesForOrg.map((b) => ({ value: b.id, label: b.name + (b.code ? ` · ${b.code}` : "") + (b.is_default ? " (default)" : "") }))}
                        searchPlaceholder="Search branches…"
                      />
                    </Field>
                  )}
                  {showCcy && (
                    <Field label="Currency" required>
                      <SearchSelect
                        value={selectedCurrencyId}
                        onChange={setSelectedCurrencyId}
                        options={tenantCurrencies.map((c) => ({ value: c.id, label: c.code + (c.is_default ? " (default)" : ` · 1 = ${c.exchange_rate}`) }))}
                        searchPlaceholder="Search currencies…"
                      />
                    </Field>
                  )}
                </FieldGrid>
              );
            })()}

            {selectedCurrency && defaultCurrency && selectedCurrency.id !== defaultCurrency.id && selectedCurrency.as_of_date !== issueDate && (
              <p className="text-xs text-[var(--color-warning)] mt-2">
                ⚠ Exchange rate for {selectedCurrency.code} is dated {selectedCurrency.as_of_date}, invoice date is {issueDate}.
                Update the rate in Business settings if it's stale.
              </p>
            )}

            {needsBillingRef && (
              <div className="mt-4 flex flex-col gap-4">
                <Field label="Reference invoice" required>
                  <div className="relative">
                    <input
                      id="f-ref"
                      className="input"
                      placeholder="Search by invoice #, customer or ICV…"
                      value={refSearch || billingRefId}
                      onChange={(e) => { setRefSearch(e.target.value); setBillingRefId(e.target.value); }}
                    />
                    {refSearch && refResults.length > 0 && (
                      <div
                        className="absolute z-30 mt-1 w-full bg-white border border-[var(--color-border)] rounded-md shadow-lg overflow-y-auto"
                        style={{ maxHeight: "min(60vh, 420px)" }}
                      >
                        {refResults.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => pickReferenceInvoice(r.id)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)] border-b last:border-b-0 border-[var(--color-border-soft)]"
                          >
                            <div className="font-medium text-[var(--color-fg)]">
                              {r.invoice_number ?? `ICV ${r.icv}`}
                              <span className="ml-2 text-xs text-[var(--color-fg-muted)]">{r.doc_type}</span>
                            </div>
                            <div className="text-xs text-[var(--color-fg-muted)] flex justify-between">
                              <span>{r.customer_name ?? "—"}</span>
                              <span className="tabular-nums">{r.payable_amount ?? "—"} SAR</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>

                <Field label="Reason code" hint="Coded reason — pick a standard one or type your own. Optional.">
                  <input
                    id="f-reason-code"
                    className="input"
                    list="cn-dn-reason-codes"
                    value={instructionCode}
                    onChange={(e) => setInstructionCode(e.target.value)}
                    placeholder="e.g. CANCELLATION_OR_TERMINATION"
                  />
                  <datalist id="cn-dn-reason-codes">
                    <option value="CANCELLATION_OR_TERMINATION" />
                    <option value="GOODS_OR_SERVICES_RETURN" />
                    <option value="PRICE_ADJUSTMENT" />
                    <option value="QUANTITY_CORRECTION" />
                    <option value="BILLING_ERROR" />
                    <option value="DISCOUNT_APPLIED_LATE" />
                    <option value="ADDITIONAL_CHARGE" />
                  </datalist>
                </Field>

                <Field label="Reason / description" required hint="Code and/or description — at least one is required by ZATCA (BR-KSA-17).">
                  <input
                    id="f-reason"
                    className="input"
                    list="cn-dn-reasons"
                    value={instructionNote}
                    onChange={(e) => setInstructionNote(e.target.value)}
                    placeholder="e.g. Customer returned 2 units"
                  />
                  <datalist id="cn-dn-reasons">
                    <option value="Customer returned items" />
                    <option value="Goods damaged in transit" />
                    <option value="Price renegotiation" />
                    <option value="Quantity correction" />
                    <option value="Discount applied late" />
                    <option value="Wrong amount billed" />
                    <option value="Late-payment fee" />
                    <option value="Additional service rendered" />
                  </datalist>
                </Field>
              </div>
            )}
          </Card>

          <Card title="Submit action">
            <Field label="On submit">
              <select
                className="input"
                value={submitChoice ?? ""}
                disabled={submitChoice === null}
                onChange={(e) => setSubmitChoice(e.target.value as "draft" | "queued" | "immediate")}
              >
                <option value="draft">Save as draft</option>
                <option value="queued">Save to queue{tenantStrategy === "queued" ? " (default)" : ""}</option>
                <option value="immediate">Submit to {env} now{tenantStrategy === "immediate" ? " (default)" : ""}</option>
              </select>
            </Field>
          </Card>

          <Card title="Customer">
            <FieldGrid cols={1}>
              <Field label="Pick customer" required={!isB2C}>
                <SearchSelect
                  id="f-customer"
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder={`— ${isB2C ? "Walk-in customer" : "Select a customer"} —`}
                  options={customers.map((c) => ({ value: c.id, label: c.name, hint: c.vat_number ? `VAT ${c.vat_number}` : undefined }))}
                  searchPlaceholder="Search customers…"
                />
              </Field>
            </FieldGrid>
            {customer && (
              <div className="mt-4 text-sm text-[var(--color-fg-2)] bg-[var(--color-bg-muted)] rounded-md p-3 border border-[var(--color-border)]">
                <div className="font-medium">{customer.name}</div>
                {customer.vat_number && <div className="text-xs text-[var(--color-fg-muted)] font-mono mt-0.5">VAT {customer.vat_number}</div>}
                <div className="text-xs text-[var(--color-fg-muted)] mt-1">
                  {[customer.building_number, customer.street, customer.city_subdivision, customer.city, customer.postal_zone, customer.country_code]
                    .filter(Boolean).join(", ") || "—"}
                </div>
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={() => goNext("lines")}>Next: line items →</button>
          </div>
        </div>
      )}

      {/* TAB: LINES */}
      {tab === "lines" && (
        <div className="flex flex-col gap-4">
          <Card
            title="Line items"
            actions={
              <button id="f-lines" type="button" onClick={addBlankLine} className="btn btn-default !py-1 !px-2 text-xs">+ Add line</button>
            }
          >
            {lines.length === 0 ? (
              <p className="muted">No lines yet.</p>
            ) : (
              <div
                ref={linesScrollRef}
                className="flex flex-col gap-3 overflow-y-auto pr-1"
                style={{ maxHeight: "min(65vh, 560px)" }}
              >
                {lines.map((l, i) => {
                  const c = computeLine(l);
                  return (
                    <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 bg-[var(--color-bg-muted)] rounded-md border border-[var(--color-border)] relative group">
                      <div className="md:col-span-4">
                        <div className="label mb-1">Item</div>
                        <input
                          ref={(el) => {
                            if (el) nameInputRefs.current.set(i, el);
                            else nameInputRefs.current.delete(i);
                          }}
                          className="input"
                          placeholder="Search products or type a name"
                          value={l.name}
                          onChange={(e) => updateLine(i, { name: e.target.value })}
                          onFocus={() => setActiveNameLine(i)}
                          onBlur={() => setTimeout(() => {
                            setActiveNameLine((cur) => (cur === i ? null : cur));
                          }, 150)}
                        />
                        {l.sku && <div className="text-[10px] font-mono text-[var(--color-fg-muted)] mt-1">{l.sku}</div>}
                      </div>
                      <div className="md:col-span-1">
                        <div className="label mb-1">Qty</div>
                        <input className="input tabular-nums" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                      </div>
                      <div className="md:col-span-2">
                        <div className="label mb-1">Unit price</div>
                        <input className="input tabular-nums" inputMode="decimal" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} />
                      </div>
                      <div className="md:col-span-2">
                        <div className="label mb-1">Discount</div>
                        <div className="flex">
                          <input
                            className="input tabular-nums rounded-r-none"
                            inputMode="decimal"
                            value={l.discount_value}
                            onChange={(e) => updateLine(i, { discount_value: e.target.value })}
                          />
                          <button
                            type="button"
                            title="Toggle percent / amount"
                            onClick={() => updateLine(i, { discount_mode: l.discount_mode === "amount" ? "percent" : "amount" })}
                            className="px-2 border border-l-0 border-[var(--color-border)] rounded-r-md text-xs font-medium bg-white text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)] shrink-0"
                          >
                            {l.discount_mode === "percent" ? "%" : "SAR"}
                          </button>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="label mb-1">VAT</div>
                        <select
                          className="input"
                          value={l.vat_code}
                          onChange={(e) => {
                            const code = e.target.value as LineForm["vat_code"];
                            const cat = VAT_BY_CODE[code];
                            updateLine(i, { vat_code: code, vat_percent: String(cat?.defaultPercent ?? 15) });
                          }}
                        >
                          {VAT_CATEGORIES.map((v) => (
                            <option key={v.code} value={v.code}>{v.code} · {v.defaultPercent}%</option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-1 flex md:flex-col md:items-end md:justify-end justify-between gap-1">
                        <div className="tabular-nums text-sm font-medium text-[var(--color-fg)]">{(c.lineExt + c.tax).toFixed(2)}</div>
                      </div>
                      {/* Compact remove — only visible on row hover/focus, never on the (single) sole row */}
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          aria-label={`Remove line ${i + 1}`}
                          title="Remove line"
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] hover:bg-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Floating autocomplete — fixed-positioned so it escapes the items scroll wrapper */}
          {activeNameLine !== null && dropdownPos && (() => {
            const matches = matchProducts(lines[activeNameLine]?.name ?? "");
            if (matches.length === 0) return null;
            const idx = activeNameLine;
            return (
              <div
                className="bg-white border border-[var(--color-border)] rounded-md shadow-lg overflow-y-auto"
                style={{
                  position: "fixed",
                  left: dropdownPos.left,
                  top: dropdownPos.top,
                  width: dropdownPos.width,
                  maxHeight: "min(50vh, 360px)",
                  zIndex: 50,
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyProductToLine(idx, p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)] border-b last:border-b-0 border-[var(--color-border-soft)]"
                  >
                    <div className="font-medium text-[var(--color-fg)]">{p.name}</div>
                    <div className="text-xs text-[var(--color-fg-muted)] flex gap-2">
                      <span className="font-mono">{p.sku}</span>
                      <span>·</span>
                      <span className="tabular-nums">{p.unit_price}</span>
                      <span>·</span>
                      <span>{p.tax_category} {p.tax_percent}%</span>
                    </div>
                  </button>
                ))}
              </div>
            );
          })()}


          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
            <button className="btn btn-default" onClick={() => setTab("details")}>← Back</button>
            <button className="btn btn-primary" onClick={() => goNext("review")}>Next: review →</button>
          </div>
        </div>
      )}

      {/* TAB: REVIEW */}
      {tab === "review" && (() => {
        const today = new Date();
        const issueTime = today.toTimeString().slice(0, 8);
        const docLabel = DOC_TYPES.find((d) => d.value === docType)?.label ?? docType;

        // VAT breakdown by category — same grouping the submit() builds.
        // Apply the invoice-level discount proportionally so the breakdown
        // matches the totals column.
        const vatGroups = new Map<string, { code: string; percent: number; taxable: number; tax: number }>();
        for (const l of lines) {
          const c = computeLine(l);
          const key = `${l.vat_code}|${c.percent}`;
          const cur = vatGroups.get(key) ?? { code: l.vat_code, percent: c.percent, taxable: 0, tax: 0 };
          cur.taxable = round2(cur.taxable + c.lineExt * vatScale);
          cur.tax     = round2(cur.tax     + c.tax     * vatScale);
          vatGroups.set(key, cur);
        }

        const customerDisplay = customer ?? (isB2C ? {
          name: "Walk-in customer", vat_number: null as string | null, crn: null as string | null,
          street: "Walk-in", building_number: "0",
          city_subdivision: "N/A", city: "Riyadh",
          postal_zone: "00000", country_code: "SA",
        } : null);

        return (
          <div className="flex flex-col gap-4">
            <Card>
              {/* Header */}
              <div className="flex flex-wrap justify-between gap-4 pb-4 border-b border-[var(--color-border)]">
                <div>
                  <div className="text-xs uppercase tracking-wide text-[var(--color-fg-muted)] font-medium">{docLabel}</div>
                  <div className="text-xl font-semibold text-[var(--color-fg)] mt-1">{invoiceNumber}</div>
                  {needsBillingRef && billingRefId && (
                    <div className="text-xs text-[var(--color-fg-muted)] mt-1">References <span className="font-mono">{billingRefId}</span></div>
                  )}
                </div>
                <div className="text-right text-xs text-[var(--color-fg-muted)]">
                  <div><span className="font-medium text-[var(--color-fg-2)]">Invoice date</span> <span className="tabular-nums">{issueDate}</span></div>
                  <div><span className="font-medium text-[var(--color-fg-2)]">Issue time</span> <span className="tabular-nums">{issueTime}</span></div>
                  <div className="mt-1"><span className="font-medium text-[var(--color-fg-2)]">Environment</span> <span className="capitalize">{env}</span></div>
                  <div><span className="font-medium text-[var(--color-fg-2)]">Payment</span> {PAYMENT_METHODS.find((p) => p.code === paymentMethod)?.label}</div>
                </div>
              </div>

              {/* Supplier + customer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-4 border-b border-[var(--color-border)]">
                <div>
                  <div className="label mb-1">From (supplier)</div>
                  {(() => {
                    const supName =
                      selectedOrg?.trade_name || selectedOrg?.name ||
                      business?.trade_name || business?.name || "Tenant supplier";
                    const supLegal = selectedOrg?.name || business?.name;
                    const supVat = selectedOrg?.vat_number || business?.vat_number || "300000000000003";
                    const addr = selectedBranch ?? selectedOrg ?? null;
                    const addrLine = [
                      addr?.building_number || "0001",
                      addr?.street || "Street",
                      (selectedBranch?.city_subdivision || selectedOrg?.city_subdivision || business?.branch_name || "District"),
                      addr?.city || "Riyadh",
                      addr?.postal_zone || "00000",
                      addr?.country_code || "SA",
                    ].join(", ");
                    return (
                      <>
                        <div className="text-sm font-medium text-[var(--color-fg)]">{supName}</div>
                        {supLegal && supLegal !== supName && (
                          <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">Legal name: {supLegal}</div>
                        )}
                        <div className="text-xs text-[var(--color-fg-muted)] font-mono mt-0.5">VAT {supVat}</div>
                        <div className="text-xs text-[var(--color-fg-muted)] mt-1">{addrLine}</div>
                        {selectedBranch && (
                          <div className="text-[10px] text-[var(--color-fg-muted)] mt-0.5">
                            Branch: {selectedBranch.name}{selectedBranch.code ? ` (${selectedBranch.code})` : ""}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <div className="label mb-1">To (customer)</div>
                  {customerDisplay ? (
                    <>
                      <div className="text-sm font-medium text-[var(--color-fg)]">{customerDisplay.name}</div>
                      {customerDisplay.vat_number && (
                        <div className="text-xs text-[var(--color-fg-muted)] font-mono mt-0.5">VAT {customerDisplay.vat_number}</div>
                      )}
                      {"crn" in customerDisplay && customerDisplay.crn && (
                        <div className="text-xs text-[var(--color-fg-muted)] font-mono">CRN {customerDisplay.crn}</div>
                      )}
                      <div className="text-xs text-[var(--color-fg-muted)] mt-1">
                        {[customerDisplay.building_number, customerDisplay.street, customerDisplay.city_subdivision, customerDisplay.city, customerDisplay.postal_zone, customerDisplay.country_code]
                          .filter(Boolean).join(", ")}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-[var(--color-danger)]">No customer picked — required for B2B.</div>
                  )}
                </div>
              </div>

              {/* Line items table */}
              <div className="py-4 border-b border-[var(--color-border)]">
                <div className="label mb-2">Line items ({lines.length})</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--color-fg-muted)] border-b border-[var(--color-border)]">
                        <th className="text-left py-2 font-medium">#</th>
                        <th className="text-left py-2 font-medium">Item</th>
                        <th className="text-right py-2 font-medium">Qty</th>
                        <th className="text-right py-2 font-medium">Unit price</th>
                        <th className="text-right py-2 font-medium">Discount</th>
                        <th className="text-right py-2 font-medium">VAT</th>
                        <th className="text-right py-2 font-medium">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const c = computeLine(l);
                        return (
                          <tr key={i} className="border-b last:border-b-0 border-[var(--color-border-soft)]">
                            <td className="py-2 text-[var(--color-fg-muted)] tabular-nums">{l.id}</td>
                            <td className="py-2">
                              <div className="text-[var(--color-fg)]">{l.name || `Item ${l.id}`}</div>
                              {l.sku && <div className="text-[10px] font-mono text-[var(--color-fg-muted)]">{l.sku}</div>}
                            </td>
                            <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                            <td className="py-2 text-right tabular-nums">{Number(l.unit_price).toFixed(2)}</td>
                            <td className="py-2 text-right tabular-nums text-[var(--color-fg-muted)]">{c.discount.toFixed(2)}</td>
                            <td className="py-2 text-right text-[var(--color-fg-muted)]">{l.vat_code} {l.vat_percent}%</td>
                            <td className="py-2 text-right tabular-nums font-medium">{(c.lineExt + c.tax).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals block — full-width, discount row has inline controls */}
              <div className="flex flex-col text-sm pt-4 divide-y divide-[var(--color-border-soft)]">
                <div className="flex items-center justify-between py-2">
                  <span className="text-[var(--color-fg-muted)]">Line extension</span>
                  <span className="tabular-nums">{lineExtTotal.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-[var(--color-fg-muted)]">Invoice discount</span>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded border border-[var(--color-border)] overflow-hidden text-xs">
                      <button
                        type="button"
                        onClick={() => setInvoiceDiscountMode("percent")}
                        className={`px-2.5 py-1.5 transition-colors ${invoiceDiscountMode === "percent" ? "bg-[var(--color-accent)] text-white" : "bg-transparent text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]"}`}
                      >%</button>
                      <button
                        type="button"
                        onClick={() => setInvoiceDiscountMode("amount")}
                        className={`px-2.5 py-1.5 border-l border-[var(--color-border)] transition-colors ${invoiceDiscountMode === "amount" ? "bg-[var(--color-accent)] text-white" : "bg-transparent text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]"}`}
                      >Amt</button>
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={invoiceDiscountMode === "percent" ? 100 : undefined}
                      step={invoiceDiscountMode === "percent" ? 0.1 : 0.01}
                      className="input tabular-nums !py-1 text-right"
                      style={{ width: 100 }}
                      value={invoiceDiscountValue}
                      onChange={(e) => setInvoiceDiscountValue(e.target.value)}
                    />
                    <span className="tabular-nums w-24 text-right">
                      {invoiceDiscount > 0 ? `−${invoiceDiscount.toFixed(2)}` : "—"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-[var(--color-fg-muted)]">Subtotal</span>
                  <span className="tabular-nums">{taxableTotal.toFixed(2)}</span>
                </div>
                {[...vatGroups.values()].map((g) => (
                  <div key={`${g.code}-${g.percent}`} className="flex items-center justify-between py-2">
                    <span className="text-[var(--color-fg-muted)]">VAT {g.code} ({g.percent}%)</span>
                    <span className="tabular-nums">{g.tax.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between py-3 font-semibold text-base">
                  <span>Total ({selectedCurrency?.code || business?.currency || "SAR"})</span>
                  <span className="tabular-nums">{payable.toFixed(2)}</span>
                </div>
              </div>

              {needsBillingRef && (instructionCode || instructionNote) && (
                <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                  <div className="label mb-1">Reason for issuance</div>
                  {instructionCode && <div className="text-sm font-mono text-[var(--color-fg-2)]">{instructionCode}</div>}
                  {instructionNote && <div className="text-sm text-[var(--color-fg-2)]">{instructionNote}</div>}
                </div>
              )}
            </Card>

            <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
              <button className="btn btn-default" onClick={() => setTab("lines")}>← Back</button>
              <div className="flex gap-2 flex-wrap">
                {submitChoice === null ? (
                  <button className="btn btn-default" disabled>Loading queue config…</button>
                ) : (
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => submit(submitChoice)}
                    title={
                      submitChoice === "draft"   ? "Save as a draft. Promote to the queue or submit later from the invoice list."
                    : submitChoice === "queued"  ? "Sign and persist the invoice. It will ship on the next scheduled queue release."
                                                 : `Bypass the queue schedule and submit immediately to ZATCA ${env}.`
                    }
                  >
                    {busy
                      ? (submitChoice === "immediate" ? "Submitting…" : "Saving…")
                      : (submitChoice === "draft"   ? "Save as draft"
                       : submitChoice === "queued"  ? "Save to queue"
                                                    : `Submit to ${env} now`)}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

