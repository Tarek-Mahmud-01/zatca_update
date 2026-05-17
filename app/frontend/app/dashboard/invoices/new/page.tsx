"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Customer, type Product } from "../../../../lib/api-client";
import { getToken } from "../../../../lib/token";
import { useActiveEnv } from "../../../../lib/active-env";
import { EnvBadge } from "../../../../components/EnvSwitcher";
import { Banner, Card, Field, FieldGrid, PageHeader, Tabs } from "../../../../components/ui";
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
  const [paymentMethod, setPaymentMethod] = useState("10");
  const [billingRefId, setBillingRefId] = useState("");
  const [instructionNote, setInstructionNote] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [lines, setLines] = useState<LineForm[]>([newLine(1)]);
  // Reference-invoice picker (only for credit/debit notes).
  const [refSearch, setRefSearch] = useState("");
  const [refResults, setRefResults] = useState<Array<{ id: string; invoice_number: string | null; icv: number; doc_type: string; customer_name: string | null; payable_amount: string | null }>>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ------ load catalog ------
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    Promise.all([api.listCustomers(token), api.listProducts(token)]).then(([cs, ps]) => {
      setCustomers(cs);
      setProducts(ps);
    }).catch((e) => setError(String(e)));
  }, []);

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

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase().trim();
    if (!q) return products;
    return products.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [productSearch, products]);

  const lineExtTotal = round2(lines.reduce((s, l) => s + computeLine(l).lineExt, 0));
  const taxTotal     = round2(lines.reduce((s, l) => s + computeLine(l).tax,     0));
  const payable      = round2(lineExtTotal + taxTotal);

  // ------ line operations ------
  function updateLine(idx: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function addLineFromProduct(p: Product) {
    setLines((prev) => [
      ...prev,
      {
        id: String(prev.length + 1),
        product_id: p.id, sku: p.sku, name: p.name,
        quantity: "1", unit_code: p.unit_code, unit_price: String(p.unit_price),
        vat_code: p.tax_category, vat_percent: String(p.tax_percent),
        discount_amount: "0",
      },
    ]);
  }
  function addBlankLine() { setLines((p) => [...p, newLine(p.length + 1)]); }
  function removeLine(idx: number) { setLines((p) => p.filter((_, i) => i !== idx)); }

  // ------ submit ------
  async function submit(submitMode: "immediate" | "queued") {
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
        cur.taxable = round2(cur.taxable + c.lineExt);
        cur.tax     = round2(cur.tax     + c.tax);
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
        issue_date: now.toISOString().slice(0, 10),
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
          tax_exclusive:  lineExtTotal.toFixed(2),
          tax_inclusive:  payable.toFixed(2),
          allowance_total: "0",
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
      pushNotification({
        tone: appliedMode === "queued" ? "info" : "success",
        title: appliedMode === "queued" ? "Invoice saved to queue" : `Invoice submitted to ${env}`,
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
      <PageHeader
        title="New invoice"
        description={<span>Submits to <strong>{env}</strong>. Pick a customer, add products, then review.</span>}
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
              <Field label="Environment">
                <select className="input" value={env} onChange={(e) => setEnv(e.target.value as typeof env)}>
                  <option value="sandbox">sandbox</option>
                  <option value="simulation">simulation</option>
                  <option value="production">production</option>
                </select>
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
                      <div className="absolute z-30 mt-1 w-full bg-white border border-[var(--color-border)] rounded-md shadow-lg max-h-64 overflow-y-auto">
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
          <Card title="Add from catalog" description="Click a product to add it as a line. Edit quantity / price / VAT below.">
            <input
              className="input mb-3"
              placeholder="Search products…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            {filteredProducts.length === 0 ? (
              <div className="muted py-2">No products match. <a href="/dashboard/products" className="text-[var(--color-accent)] hover:underline">Manage products →</a></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {filteredProducts.slice(0, 12).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addLineFromProduct(p)}
                    className="text-left p-3 bg-white border border-[var(--color-border)] rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
                  >
                    <div className="text-sm font-medium text-[var(--color-fg)]">{p.name}</div>
                    <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] mt-1">
                      <span className="font-mono">{p.sku}</span>
                      <span>·</span>
                      <span className="tabular-nums">{p.unit_price}</span>
                      <span>·</span>
                      <span>{p.tax_category} {p.tax_percent}%</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={addBlankLine} className="btn btn-default mt-4">+ Add blank line</button>
          </Card>

          <Card title="Line items" description="Quantity × Unit price − Discount = Line extension. VAT computed live.">
            {lines.length === 0 ? (
              <p className="muted">No lines yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {lines.map((l, i) => {
                  const c = computeLine(l);
                  return (
                    <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 bg-[var(--color-bg-muted)] rounded-md border border-[var(--color-border)]">
                      <div className="md:col-span-4">
                        <div className="label mb-1">Item</div>
                        <input className="input" placeholder="Name" value={l.name} onChange={(e) => updateLine(i, { name: e.target.value })} />
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
                        <button type="button" onClick={() => removeLine(i)} className="btn btn-ghost !p-1 !px-2 text-xs">Remove</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
            <button className="btn btn-default" onClick={() => setTab("details")}>← Back</button>
            <button className="btn btn-primary" onClick={() => setTab("review")}>Next: review →</button>
          </div>
        </div>
      )}

      {/* TAB: REVIEW */}
      {tab === "review" && (
        <div className="flex flex-col gap-4">
          <Card title="Summary">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="label">Document</div>
                <div className="text-sm">{DOC_TYPES.find((d) => d.value === docType)?.label}</div>
                <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">{invoiceNumber}</div>
              </div>
              <div>
                <div className="label">Customer</div>
                <div className="text-sm">{customer?.name ?? (isB2C ? "Walk-in customer" : "—")}</div>
                <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">{customer?.vat_number ?? ""}</div>
              </div>
              <div>
                <div className="label">Payment</div>
                <div className="text-sm">{PAYMENT_METHODS.find((p) => p.code === paymentMethod)?.label}</div>
              </div>
              <div>
                <div className="label">Environment</div>
                <div className="text-sm capitalize">{env}</div>
              </div>
            </div>
          </Card>

          <Card title="Totals">
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">Line extension</span><span className="tabular-nums">{lineExtTotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">VAT total</span><span className="tabular-nums">{taxTotal.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-[var(--color-border)] pt-2 mt-2 font-semibold">
                <span>Payable (SAR)</span><span className="tabular-nums">{payable.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
            <button className="btn btn-default" onClick={() => setTab("lines")}>← Back</button>
            <div className="flex gap-2">
              <button
                className="btn btn-default"
                disabled={busy}
                onClick={() => submit("queued")}
                title="Sign and persist the invoice, but hold off the ZATCA submission until you run Process queue."
              >
                {busy ? "Saving…" : "Save to queue"}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => submit("immediate")}
                title={`Sign and submit immediately to ZATCA ${env}.`}
              >
                {busy ? "Submitting…" : `Submit to ${env}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
