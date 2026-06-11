"use client";

import React, { useState } from "react";
import {
  PageHeader,
  Card,
  FieldGrid,
  Field,
  Divider,
  Button,
  Input,
  Select,
  Textarea,
  Checkbox,
  Switch,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Nav,
  NavItem,
  Banner,
  Badge,
  Spinner,
  StatusDot,
  Empty,
  Modal,
  Dropdown,
  DropdownItem,
  Tabs,
} from "@/app/core/components/ui";

/* ---------------------------------------------------------------------------
 * Inline helpers
 * -------------------------------------------------------------------------- */

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-[var(--color-fg)]">{title}</h2>
      {description && (
        <p className="text-sm text-[var(--color-fg-muted)] mt-0.5">{description}</p>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

/* ---------------------------------------------------------------------------
 * Color token data
 * -------------------------------------------------------------------------- */

const COLOR_TOKENS: { name: string; variable: string; hex: string }[] = [
  { name: "bg",           variable: "--color-bg",           hex: "#ffffff" },
  { name: "bg-muted",     variable: "--color-bg-muted",     hex: "#f9fafb" },
  { name: "bg-soft",      variable: "--color-bg-soft",      hex: "#f3f4f6" },
  { name: "bg-hover",     variable: "--color-bg-hover",     hex: "#f5f6f8" },
  { name: "border",       variable: "--color-border",       hex: "#e5e7eb" },
  { name: "border-soft",  variable: "--color-border-soft",  hex: "#f1f2f4" },
  { name: "fg",           variable: "--color-fg",           hex: "#111827" },
  { name: "fg-2",         variable: "--color-fg-2",         hex: "#374151" },
  { name: "fg-muted",     variable: "--color-fg-muted",     hex: "#6b7280" },
  { name: "fg-faint",     variable: "--color-fg-faint",     hex: "#9ca3af" },
  { name: "accent",       variable: "--color-accent",       hex: "#111827" },
  { name: "accent-hover", variable: "--color-accent-hover", hex: "#1f2937" },
  { name: "accent-soft",  variable: "--color-accent-soft",  hex: "#f3f4f6" },
  { name: "success",      variable: "--color-success",      hex: "#15803d" },
  { name: "success-soft", variable: "--color-success-soft", hex: "#ecfdf5" },
  { name: "warning",      variable: "--color-warning",      hex: "#b45309" },
  { name: "warning-soft", variable: "--color-warning-soft", hex: "#fffbeb" },
  { name: "danger",       variable: "--color-danger",       hex: "#b91c1c" },
  { name: "danger-soft",  variable: "--color-danger-soft",  hex: "#fef2f2" },
];

/* ---------------------------------------------------------------------------
 * Sample table data
 * -------------------------------------------------------------------------- */

const INVOICE_ROWS = [
  { id: "INV-0042", amount: "SAR 3,200.00", status: "cleared" as const },
  { id: "INV-0043", amount: "SAR 750.50",   status: "queued"  as const },
  { id: "INV-0044", amount: "SAR 1,100.00", status: "draft"   as const },
];

/* ---------------------------------------------------------------------------
 * Main page
 * -------------------------------------------------------------------------- */

type TabId = "overview" | "tokens" | "components";

export default function DesignSystemPage() {
  // interactive state
  const [modalOpen,    setModalOpen]    = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [switchOn,     setSwitchOn]     = useState(true);
  const [switchOff,    setSwitchOff]    = useState(false);
  const [checked,      setChecked]      = useState(true);
  const [activeTab,    setActiveTab]    = useState<TabId>("overview");

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-10">
      <PageHeader
        title="Design System"
        description="Living reference for ZATCA UI tokens, components, and conventions."
      />

      {/* ------------------------------------------------------------------ */}
      {/* 1. COLORS                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader
          title="Colors"
          description="All 19 design tokens defined in globals.css @theme."
        />
        <Card>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {COLOR_TOKENS.map((t) => (
              <div key={t.variable} className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-md border border-[var(--color-border)] shrink-0"
                  style={{ background: t.hex }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[var(--color-fg)] truncate">
                    {t.name}
                  </div>
                  <div className="text-xs text-[var(--color-fg-muted)] font-mono">{t.hex}</div>
                  <div className="text-xs text-[var(--color-fg-faint)] font-mono truncate">
                    {t.variable}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. TYPOGRAPHY                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Typography" description="Type scale via Inter (--font-sans)." />
        <Card>
          <div className="space-y-4">
            <h1 className="text-3xl font-bold text-[var(--color-fg)]">Heading 1 — 3xl bold</h1>
            <h2 className="text-2xl font-semibold text-[var(--color-fg)]">Heading 2 — 2xl semibold</h2>
            <h3 className="text-xl font-semibold text-[var(--color-fg)]">Heading 3 — xl semibold</h3>
            <p className="text-base text-[var(--color-fg)]">
              Body — base size. The quick brown fox jumps over the lazy dog.
            </p>
            <p className="muted">Muted — .muted utility. Secondary prose text used for hints and descriptions.</p>
            <span className="label block">Label — .label utility. Used for form labels and section headers.</span>
            <code className="text-sm font-mono bg-[var(--color-bg-soft)] px-2 py-1 rounded text-[var(--color-fg-2)]">
              Mono — used for invoice IDs, API keys, code snippets.
            </code>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. BUTTONS                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader
          title="Buttons"
          description="4 variants × 3 sizes + loading + disabled."
        />
        <Card>
          <div className="space-y-4">
            {(["primary", "default", "ghost", "danger"] as const).map((variant) => (
              <div key={variant} className="space-y-1">
                <div className="label mb-1">{variant}</div>
                <Row>
                  <Button variant={variant} size="sm">Small</Button>
                  <Button variant={variant} size="md">Medium</Button>
                  <Button variant={variant} size="lg">Large</Button>
                  <Button variant={variant} size="md" loading>Loading</Button>
                  <Button variant={variant} size="md" disabled>Disabled</Button>
                </Row>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 4. FORM CONTROLS                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Form Controls" description="Input, Select, Textarea, Checkbox, Switch." />
        <Card>
          <FieldGrid cols={2}>
            <Field label="Text input" hint="Enter your company name">
              <Input placeholder="ACME Corp" defaultValue="" />
            </Field>
            <Field label="Select">
              <Select defaultValue="b2b">
                <option value="b2b">B2B Invoice</option>
                <option value="b2c">B2C Invoice</option>
                <option value="credit">Credit Note</option>
                <option value="debit">Debit Note</option>
              </Select>
            </Field>
            <Field label="Textarea" hint="Up to 500 characters">
              <Textarea placeholder="Notes…" defaultValue="" />
            </Field>
            <Field label="Checkboxes">
              <div className="flex flex-col gap-2 pt-1">
                <Checkbox
                  label="Checked by default"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                <Checkbox label="Unchecked" defaultChecked={false} readOnly />
                <Checkbox label="Disabled" disabled />
              </div>
            </Field>
            <Field label="Switches">
              <div className="flex flex-col gap-2 pt-1">
                <Switch checked={switchOn}  onChange={setSwitchOn}  label="Enabled (on)" />
                <Switch checked={switchOff} onChange={setSwitchOff} label="Enabled (off)" />
                <Switch checked={false} onChange={() => {}} label="Disabled switch" disabled />
              </div>
            </Field>
            <Field label="Input with error" error="VAT number is required">
              <Input placeholder="300XXXXXXXXXXXXXXXXX" />
            </Field>
          </FieldGrid>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. BADGES                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Badge" description="5 tones: neutral, success, warning, danger, accent." />
        <Card>
          <Row>
            <Badge tone="neutral">Neutral</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
            <Badge tone="accent">Accent</Badge>
          </Row>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 6. BANNERS                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Banner" description="Inline feedback banners in 4 tones." />
        <Card>
          <div className="space-y-2">
            <Banner tone="neutral">Neutral — informational message about this action.</Banner>
            <Banner tone="success">Success — invoice INV-0042 submitted to ZATCA successfully.</Banner>
            <Banner tone="warning">Warning — sandbox credentials expire in 3 days.</Banner>
            <Banner tone="danger">Danger — CSID signing failed. Please re-onboard the branch.</Banner>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 7. STATUS DOTS                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Status Dots" description="Compact colored indicator for invoice statuses." />
        <Card>
          <Row>
            {(["cleared", "reported", "queued", "rejected", "draft"] as const).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <StatusDot status={s} />
                <span className="text-sm text-[var(--color-fg-2)] capitalize">{s}</span>
              </div>
            ))}
          </Row>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 8. SPINNER                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Spinner" description="sm / md / lg loading indicator." />
        <Card>
          <Row>
            <div className="flex flex-col items-center gap-1">
              <Spinner size="sm" />
              <span className="label">sm</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Spinner size="md" />
              <span className="label">md</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Spinner size="lg" />
              <span className="label">lg</span>
            </div>
          </Row>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 9. TABLE                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Table" description="Table / Thead / Tbody / Tr / Th / Td." />
        <Card>
          <Table>
            <Thead>
              <Tr>
                <Th>Invoice #</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {INVOICE_ROWS.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <span className="font-mono text-xs">{row.id}</span>
                  </Td>
                  <Td align="right">{row.amount}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={row.status} />
                      <span className="capitalize">{row.status}</span>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 10. CARD                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Card" description="White container with optional title, description, and actions." />
        <Card
          title="Branch CSID"
          description="Cryptographic stamp identity for Riyadh HQ branch."
          actions={
            <>
              <Button variant="ghost" size="sm">Refresh</Button>
              <Button variant="primary" size="sm">Re-onboard</Button>
            </>
          }
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <StatusDot status="cleared" />
              <span className="text-sm text-[var(--color-fg)]">Active — expires 2026-12-31</span>
            </div>
            <p className="muted">
              The CSID is bound to branch VAT registration 300000000000003 and is required
              for all B2B invoice submissions.
            </p>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 11. TABS                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Tabs" description="Horizontal tab bar with active state." />
        <Card>
          <Tabs<TabId>
            value={activeTab}
            onChange={setActiveTab}
            items={[
              { id: "overview",    label: "Overview",    count: 3 },
              { id: "tokens",      label: "Tokens" },
              { id: "components",  label: "Components",  count: 14 },
            ]}
          />
          <div className="text-sm text-[var(--color-fg-muted)] pt-2">
            Active tab: <strong className="text-[var(--color-fg)]">{activeTab}</strong>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 12. MODAL                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Modal" description="Controlled overlay dialog." />
        <Card>
          <Button variant="default" onClick={() => setModalOpen(true)}>
            Open Modal
          </Button>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Confirm Submission"
            footer={
              <>
                <Button variant="ghost"   onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>Submit to ZATCA</Button>
              </>
            }
          >
            <p className="text-sm text-[var(--color-fg)]">
              You are about to submit <strong>INV-0042</strong> to ZATCA. This action cannot be
              undone once the invoice is cleared.
            </p>
            <Banner tone="warning" >
              Make sure VAT amount and line items are correct before proceeding.
            </Banner>
          </Modal>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 13. DROPDOWN                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Dropdown" description="Popover menu with DropdownItem children." />
        <Card>
          <Dropdown
            open={dropdownOpen}
            onClose={() => setDropdownOpen(false)}
            trigger={
              <Button variant="default" onClick={() => setDropdownOpen((o) => !o)}>
                Actions ▾
              </Button>
            }
          >
            <DropdownItem onClick={() => setDropdownOpen(false)}>Edit Invoice</DropdownItem>
            <DropdownItem onClick={() => setDropdownOpen(false)}>Download PDF</DropdownItem>
            <DropdownItem destructive onClick={() => setDropdownOpen(false)}>Delete</DropdownItem>
          </Dropdown>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 14. EMPTY                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Empty" description="Empty-state placeholder for lists and tables." />
        <Card>
          <Empty
            title="No invoices yet"
            description="Create your first invoice to start submitting to ZATCA. B2B invoices are cleared in real-time."
            action={<Button variant="primary" size="sm">New Invoice</Button>}
          />
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 15. NAV                                                             */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Nav" description="Vertical navigation with active state highlight." />
        <Card>
          <div className="w-48">
            <Nav>
              <NavItem active>Invoices</NavItem>
              <NavItem>Customers</NavItem>
              <NavItem>Products</NavItem>
            </Nav>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 16. DIVIDER                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader title="Divider" description="Horizontal rule using --color-border." />
        <Card>
          <p className="text-sm text-[var(--color-fg)]">Content above the divider.</p>
          <Divider />
          <p className="text-sm text-[var(--color-fg-muted)]">Content below the divider.</p>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 17. GLOBAL VS LOCAL                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <SectionHeader
          title="Global vs Local Components"
          description="Architectural convention for component placement."
        />
        <Card>
          <div className="space-y-4 text-sm text-[var(--color-fg)]">
            <div>
              <p className="font-semibold mb-1">Global components</p>
              <p className="muted">
                Live in{" "}
                <code className="font-mono text-xs bg-[var(--color-bg-soft)] px-1.5 py-0.5 rounded">
                  @/app/core/components/ui
                </code>
                . These are reusable, feature-agnostic primitives (Button, Card, Table, etc.)
                that any feature can import. They must not carry business logic or call feature
                APIs.
              </p>
            </div>
            <Divider className="my-2" />
            <div>
              <p className="font-semibold mb-1">Local components</p>
              <p className="muted">
                Live in{" "}
                <code className="font-mono text-xs bg-[var(--color-bg-soft)] px-1.5 py-0.5 rounded">
                  @/apps/&lt;feature&gt;/components/
                </code>
                . They are specific to one feature (e.g.{" "}
                <code className="font-mono text-xs bg-[var(--color-bg-soft)] px-1.5 py-0.5 rounded">
                  InvoiceLineItem
                </code>
                ,{" "}
                <code className="font-mono text-xs bg-[var(--color-bg-soft)] px-1.5 py-0.5 rounded">
                  CustomerForm
                </code>
                ) and <strong>import</strong> globals — never the reverse.
              </p>
            </div>
            <Divider className="my-2" />
            <div>
              <p className="font-semibold mb-1">Route wiring</p>
              <p className="muted">
                Each page under{" "}
                <code className="font-mono text-xs bg-[var(--color-bg-soft)] px-1.5 py-0.5 rounded">
                  @/app/dashboard/&lt;route&gt;/page.tsx
                </code>{" "}
                is a thin re-export of the feature page in{" "}
                <code className="font-mono text-xs bg-[var(--color-bg-soft)] px-1.5 py-0.5 rounded">
                  @/apps/&lt;feature&gt;/pages/index.tsx
                </code>
                . This keeps Next.js routing separate from business logic.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
