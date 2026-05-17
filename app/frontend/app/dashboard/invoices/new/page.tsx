"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Customer, type Product } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { useActiveEnv } from "../../../../lib/active-env";
import { EnvBadge } from "../../../../components/EnvSwitcher";
import { Banner, Card, Field, FieldGrid, PageHeader, Tabs } from "../../../../components/ui";
import { DatePicker } from "../../../../components/DatePicker";
import { pushNotification } from "../../../../lib/notifications";
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
  discount_amount: string;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function computeLine(l: LineForm) {
  const qty = Number(l.quantity || 0);
  const price = Number(l.unit_price || 0);
  const disc = Number(l.discount_amount || 0);
  const percent = Number(l.vat_percent || 0);
  const lineExt = round2(qty * price - disc);
  const tax = round2((lineExt * percent) / 100);
  return { lineExt, tax, rounding: round2(lineExt + tax), percent };
}

function newLine(n: number): LineForm {
  return {
    id: String(n), product_id: "", sku: "", name: "",
    quantity: "1", unit_code: "PCE", unit_price: "0.00",
    vat_code: "S", vat_percent: "15", discount_amount: "0",
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
  }, []);

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
          discount_amount: l.discount_amount ?? "0",
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

  // ------ submit ------
  async function submit(submitMode: "immediate" | "queued" | "draft") {
    const token = getToken();
    if (!token) return;
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

      const payload = {
        doc_type: docType,
        invoice_number: invoiceNumber,
        uuid: "00000000-0000-0000-0000-000000000000",
        issue_date: issueDate,
        issue_time: now.toISOString().slice(11, 19),
        icv: 0,
        pih_b64: "",
        supplier: {
          registration_name: "Tenant supplier",
          vat_number: "300000000000003",
          street: "Street", building_number: "0001",
          city_subdivision: "District", city: "Riyadh",
          postal_zone: "00000", country_code: "SA",
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
            discount_amount: l.discount_amount || "0",
            discount_reason: Number(l.discount_amount) > 0 ? "discount" : null,
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
        payment_means_code: paymentMethod,
        instruction_note:    needsBillingRef ? (instructionNote || null) : null,
        billing_reference_id: needsBillingRef ? (billingRefId   || null) : null,
        notes: [],
      };
      if (!payload.customer) throw new Error("Pick a customer (or use a simplified doc type for walk-in).");
      const res = await api.submitInvoice(token, { env, payload, submit_mode: submitMode });
      const appliedMode = res.submit_mode ?? submitMode;
      const title =
        appliedMode === "draft"   ? "Saved as draft"
        : appliedMode === "queued" ? "Invoice saved to queue"
        : `Invoice submitted to ${env}`;
      pushNotification({
        tone: appliedMode === "immediate" ? "success" : "info",
        title,
        body: `ICV ${res.icv} · status ${res.status}`,
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
        title="New invoice"
        description={
          <span>
            {tenantStrategy === "queued"
              ? <>Tenant queue is <strong>batched</strong> — invoices ship at the next scheduled release. Use <em>Submit now</em> to bypass.</>
              : <>Submits to <strong>{env}</strong>. Pick a customer, add products, then review.</>}
          </span>
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
                <select className="input" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
                  {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Invoice number" required>
                <input className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
              </Field>
              <Field
                label="Invoice date"
                required
                hint="The invoice's issue date — written to cbc:IssueDate on the UBL document."
              >
                <DatePicker
                  value={issueDate}
                  onChange={(v) => setIssueDate(v || new Date().toISOString().slice(0, 10))}
                />
              </Field>
              <Field label="Payment method"
                     hint={PAYMENT_METHODS.find((p) => p.code === paymentMethod)?.hint}>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.label}</option>)}
                </select>
              </Field>
            </FieldGrid>

            {needsBillingRef && (
              <div className="mt-4 flex flex-col gap-4">
                <Field
                  label="Reference invoice"
                  required
                  hint="Pick a cleared/reported invoice to auto-fill customer + line items, or type the invoice number manually."
                >
                  <div className="relative">
                    <input
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

                <Field
                  label="Reason / instruction note"
                  hint="Pick a common reason or type your own. Surfaced on the note as InstructionNote."
                >
                  <input
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

          <Card
            title="Action when you submit"
            description={tenantStrategy
              ? <>Tenant default is <strong className="text-[var(--color-fg)]">{tenantStrategy === "queued" ? "queued (batched)" : "immediate"}</strong> — pre-selected. Override per invoice if needed.</>
              : "Loading tenant default…"}
          >
            <Field
              label="Submit action"
              hint={
                submitChoice === "draft"     ? "Stays parked. Promote to queue or submit later from the invoice list."
              : submitChoice === "queued"    ? "Signed + persisted now; ships at the next scheduled release."
              : submitChoice === "immediate" ? "Bypass the queue schedule and push to ZATCA immediately."
                                             : ""
              }
            >
              <select
                className="input"
                value={submitChoice ?? ""}
                disabled={submitChoice === null}
                onChange={(e) => setSubmitChoice(e.target.value as "draft" | "queued" | "immediate")}
              >
                <option value="draft">
                  Save as draft
                </option>
                <option value="queued">
                  Save to queue{tenantStrategy === "queued" ? " (tenant default)" : ""}
                </option>
                <option value="immediate">
                  Submit to {env} now{tenantStrategy === "immediate" ? " (tenant default)" : ""}
                </option>
              </select>
            </Field>
          </Card>

          <Card title="Customer" description={isB2C ? "Optional for B2C — defaults to walk-in." : "Required for B2B clearance."}>
            <FieldGrid cols={1}>
              <Field label="Pick customer">
                <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">— {isB2C ? "Walk-in customer" : "Select a customer"} —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.vat_number ? ` · ${c.vat_number}` : ""}</option>
                  ))}
                </select>
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
            <button className="btn btn-primary" onClick={() => setTab("lines")}>Next: line items →</button>
          </div>
        </div>
      )}

      {/* TAB: LINES */}
      {tab === "lines" && (
        <div className="flex flex-col gap-4">
          <Card
            title="Line items"
            description="Start typing in Item to search the product catalog, or type freely. Quantity × Unit price − Discount = Line extension. VAT computed live."
            actions={
              <button type="button" onClick={addBlankLine} className="btn btn-default !py-1 !px-2 text-xs">+ Add line</button>
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
                        <input className="input tabular-nums" inputMode="decimal" value={l.discount_amount} onChange={(e) => updateLine(i, { discount_amount: e.target.value })} />
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
                          {VAT_CATEGORIES.map((v) => <option key={v.code} value={v.code}>{v.code} · {v.defaultPercent}%</option>)}
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

          <Card title="Invoice-level adjustments" description="Document-wide discount. Reduces the taxable base, VAT is recomputed on the discounted total.">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-fg-2)]">Discount mode</span>
                <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-sm w-fit">
                  <button
                    type="button"
                    onClick={() => setInvoiceDiscountMode("percent")}
                    className={`px-3 py-1.5 transition-colors ${
                      invoiceDiscountMode === "percent"
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-white text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
                    }`}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvoiceDiscountMode("amount")}
                    className={`px-3 py-1.5 transition-colors border-l border-[var(--color-border)] ${
                      invoiceDiscountMode === "amount"
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-white text-[var(--color-fg-2)] hover:bg-[var(--color-bg-hover)]"
                    }`}
                  >
                    SAR
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-fg-2)]">
                  {invoiceDiscountMode === "percent" ? "Discount %" : "Discount amount (SAR)"}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={invoiceDiscountMode === "percent" ? 100 : undefined}
                  step={invoiceDiscountMode === "percent" ? 0.1 : 0.01}
                  className="input tabular-nums"
                  style={{ width: 140 }}
                  value={invoiceDiscountValue}
                  onChange={(e) => setInvoiceDiscountValue(e.target.value)}
                />
              </div>
              {invoiceDiscount > 0 && (
                <div className="text-xs text-[var(--color-fg-muted)] pb-2">
                  → −<span className="tabular-nums">{invoiceDiscount.toFixed(2)}</span> SAR off taxable.
                  New payable: <span className="tabular-nums font-medium text-[var(--color-fg)]">{payable.toFixed(2)}</span>
                </div>
              )}
            </div>
          </Card>

          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
            <button className="btn btn-default" onClick={() => setTab("details")}>← Back</button>
            <button className="btn btn-primary" onClick={() => setTab("review")}>Next: review →</button>
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
                  <div className="text-sm font-medium text-[var(--color-fg)]">Tenant supplier</div>
                  <div className="text-xs text-[var(--color-fg-muted)] font-mono mt-0.5">VAT 300000000000003</div>
                  <div className="text-xs text-[var(--color-fg-muted)] mt-1">0001 Street, District, Riyadh 00000, SA</div>
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
                            <td className="py-2 text-right tabular-nums text-[var(--color-fg-muted)]">{Number(l.discount_amount).toFixed(2)}</td>
                            <td className="py-2 text-right text-[var(--color-fg-muted)]">{l.vat_code} {l.vat_percent}%</td>
                            <td className="py-2 text-right tabular-nums font-medium">{(c.lineExt + c.tax).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* VAT breakdown + totals */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
                <div>
                  <div className="label mb-2">VAT breakdown</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--color-fg-muted)] border-b border-[var(--color-border)]">
                        <th className="text-left py-1.5 font-medium">Category</th>
                        <th className="text-right py-1.5 font-medium">Taxable</th>
                        <th className="text-right py-1.5 font-medium">VAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...vatGroups.values()].map((g) => (
                        <tr key={`${g.code}-${g.percent}`} className="border-b last:border-b-0 border-[var(--color-border-soft)]">
                          <td className="py-1.5">{g.code} · {g.percent}%</td>
                          <td className="py-1.5 text-right tabular-nums">{g.taxable.toFixed(2)}</td>
                          <td className="py-1.5 text-right tabular-nums">{g.tax.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-1 text-sm sm:items-end">
                  <div className="flex justify-between w-full sm:w-64">
                    <span className="text-[var(--color-fg-muted)]">Line extension</span>
                    <span className="tabular-nums">{lineExtTotal.toFixed(2)}</span>
                  </div>
                  {invoiceDiscount > 0 && (
                    <>
                      <div className="flex justify-between w-full sm:w-64">
                        <span className="text-[var(--color-fg-muted)]">
                          Invoice discount{invoiceDiscountMode === "percent" && Number(invoiceDiscountValue) > 0 ? ` (${Number(invoiceDiscountValue)}%)` : ""}
                        </span>
                        <span className="tabular-nums text-[var(--color-fg-muted)]">−{invoiceDiscount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between w-full sm:w-64">
                        <span className="text-[var(--color-fg-muted)]">Taxable</span>
                        <span className="tabular-nums">{taxableTotal.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between w-full sm:w-64">
                    <span className="text-[var(--color-fg-muted)]">VAT total</span>
                    <span className="tabular-nums">{taxTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between w-full sm:w-64 border-t border-[var(--color-border)] pt-2 mt-2 font-semibold text-base">
                    <span>Payable (SAR)</span>
                    <span className="tabular-nums">{payable.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {needsBillingRef && instructionNote && (
                <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                  <div className="label mb-1">Instruction note</div>
                  <div className="text-sm text-[var(--color-fg-2)]">{instructionNote}</div>
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

