import { ArrowRight, Download, Eye, FileCheck, FileUp, Inbox, KeyRound, MailCheck, Pencil, Plus, RefreshCw, Send, Settings, Trash2, UserRoundCheck, Webhook } from "lucide-react";
import type { Metadata } from "next";
import {
  Accordion,
  Alert,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CodeBlock,
  ConfirmButton,
  CopyButton,
  CopyField,
  DateTime,
  DefinitionTooltip,
  DialogButton,
  Disclosure,
  DropdownMenu,
  EmptyState,
  Field,
  IconButton,
  Input,
  KeyValue,
  KeyValueList,
  LanguageToggle,
  LegalNote,
  LineItems,
  Logo,
  LogoMark,
  Money,
  OrgMark,
  PageHeader,
  Pagination,
  ProgressBar,
  ProvisionalBadge,
  ProvisionalNotice,
  STATUS_KINDS,
  STATUS_MAP,
  STATUS_VALUES,
  Section,
  Skeleton,
  Spinner,
  Stat,
  StatGrid,
  StatusBadge,
  Stepper,
  SubmitButton,
  Table,
  Tabs,
  TextLink,
  Timeline,
  Tooltip,
  type StatusBadgeProps,
  type StatusKind,
  type TableColumn,
  type Tone,
} from "@/components/ui";
import { demoConfirmAction } from "../_actions";
import { SAMPLE_CAMP, SAMPLE_EMBED_SNIPPET, SAMPLE_LIMIT_CENTS, SAMPLE_NOW, SAMPLE_SGO, SAMPLE_VERIFICATIONS, SAMPLE_WEBHOOK_PAYLOAD, type SampleVerification } from "../_data";
import { ConfirmDialogDemo, DialogDemo, DrawerDemo, ToastDemo } from "../_demos";
import { C, DoDont, Example, GUIDE_METADATA, GuideChrome, GuideSection, Row, Specimen } from "../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Style guide — Components" };

const TOC = [
  { id: "button", label: "Button" },
  { id: "icon-button", label: "IconButton" },
  { id: "text-link", label: "TextLink" },
  { id: "badge", label: "Badge" },
  { id: "status-badge", label: "StatusBadge" },
  { id: "provisional", label: "Provisional" },
  { id: "alert", label: "Alert · LegalNote" },
  { id: "banner", label: "Banner" },
  { id: "toast", label: "Toast" },
  { id: "money", label: "Money" },
  { id: "date-time", label: "DateTime" },
  { id: "stat", label: "Stat" },
  { id: "key-value", label: "KeyValueList" },
  { id: "line-items", label: "LineItems" },
  { id: "table", label: "Table · Pagination · EmptyState" },
  { id: "timeline", label: "Timeline" },
  { id: "avatar", label: "Avatar · OrgMark" },
  { id: "code", label: "CodeBlock · CopyButton · CopyField" },
  { id: "loading", label: "Skeleton · Spinner · ProgressBar" },
  { id: "card", label: "Card" },
  { id: "section", label: "Section · PageHeader" },
  { id: "tabs", label: "Tabs" },
  { id: "stepper", label: "Stepper" },
  { id: "language-toggle", label: "LanguageToggle" },
  { id: "menu", label: "DropdownMenu" },
  { id: "disclosure", label: "Disclosure · Accordion" },
  { id: "logo", label: "Logo" },
  { id: "dialog", label: "Dialog · Drawer · Confirm" },
  { id: "tooltip", label: "Tooltip · DefinitionTooltip" },
];

const TONES: Tone[] = ["neutral", "brand", "info", "success", "warning", "danger", "caution"];

const KIND_NOTES: Record<StatusKind, string> = {
  verification: "verifications.status — the public result. Pass `provisional` with it.",
  stage: "verifications.stage — where a pending verification is.",
  method: "verifications.method",
  threshold_source: "verifications.threshold_source",
  document: "documents.status",
  rail: "rail_connections.status",
  review_task: "review_tasks.status",
  award: "awards.status",
  handoff: "handoffs.status — “eligible” is not a promise of payment.",
  partnership: "partnerships.status",
  invoice: "business_invoices.status",
  checkout: "checkout_sessions.status",
  payment: "payments.status",
  donation: "donations.status",
  acknowledgment: "acknowledgments.status",
  fee: "fee_ledger.status",
  sgo_list: "sgo_list_entries.status",
  sgo_list_source: "sgo_list_entries.source",
  org: "organizations.status",
  webhook_endpoint: "webhook_endpoints.status",
  webhook_delivery: "webhook_deliveries.status",
  job: "jobs.status",
  email: "emails.status",
  mode: "mode — test versus live data.",
};

type SortKey = "applicant" | "updatedAt" | "incomeCents";

function sortRows(rows: SampleVerification[], key: SortKey, direction: "asc" | "desc"): SampleVerification[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "incomeCents") return ((a.incomeCents ?? -1) - (b.incomeCents ?? -1)) * sign;
    return a[key].localeCompare(b[key]) * sign;
  });
}

const VERIFICATION_COLUMNS: Array<TableColumn<SampleVerification>> = [
  {
    key: "applicant",
    header: "Applicant",
    primary: true,
    sortable: true,
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        <Avatar name={row.applicant} size="sm" />
        <span>{row.applicant}</span>
      </span>
    ),
  },
  { key: "student", header: "Student", cell: (row) => row.student, hideWhenStacked: true },
  { key: "status", header: "Status", cell: (row) => <StatusBadge kind="verification" status={row.status} provisional={row.provisional && (row.status === "eligible" || row.status === "ineligible")} size="sm" /> },
  { key: "stage", header: "Stage", cell: (row) => <StatusBadge kind="stage" status={row.stage} size="sm" showIcon={false} /> },
  { key: "incomeCents", header: "Household income", numeric: true, sortable: true, cell: (row) => <Money cents={row.incomeCents} /> },
  { key: "thresholdCents", header: "Limit used", numeric: true, cell: (row) => <Money cents={row.thresholdCents} /> },
  { key: "updatedAt", header: "Updated", numeric: true, sortable: true, cell: (row) => <DateTime value={row.updatedAt} format="relative" now={SAMPLE_NOW} /> },
];

export default async function StyleGuideComponents({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const sortKey: SortKey = params.sort === "applicant" || params.sort === "incomeCents" ? params.sort : "updatedAt";
  const sortDirection = params.dir === "asc" ? "asc" : "desc";
  const tab = typeof params.tab === "string" ? params.tab : "all";
  const rows = sortRows(SAMPLE_VERIFICATIONS, sortKey, sortDirection);
  const tabHref = (value: string) => `/styleguide/components?tab=${value}#tabs`;

  return (
    <GuideChrome
      title="Components"
      lead={
        <p>
          Every component, in every state, with domain content. Import from <C>@/components/ui</C>. Form controls are on the Forms page; page shells are on the Shells page.
        </p>
      }
      toc={TOC}
    >
      {/* ------------------------------------------------------------------------------------------- Actions */}
      <GuideSection id="actions" title="Actions">
        <Specimen
          id="button"
          name="Button"
          importLine='import { Button } from "@/components/ui"'
          note={
            <p>
              One primary button per view. Pass <C>href</C> to render a link that looks like a button (next/link for in-app paths, a plain anchor for external URLs). <C>size=&quot;lg&quot;</C> for the main action of a family or
              donor step; <C>sm</C> in dashboards. In forms with a server action use <C>SubmitButton</C>.
            </p>
          }
        >
          <Example label="Variants">
            <Row>
              <Button>Verify income</Button>
              <Button variant="secondary">Save and finish later</Button>
              <Button variant="ghost">Skip for now</Button>
              <Button variant="danger">Revoke key</Button>
              <Button variant="link">Why do we ask this?</Button>
            </Row>
          </Example>
          <Example label="Sizes — sm · md · lg">
            <Row>
              <Button size="sm">Resolve</Button>
              <Button>Resolve review</Button>
              <Button size="lg">Continue</Button>
            </Row>
          </Example>
          <Example label="With icons (decorative), as a link, full width">
            <div className="space-y-3">
              <Row>
                <Button leadingIcon={<Plus />}>New verification</Button>
                <Button variant="secondary" leadingIcon={<Download />}>
                  Download evidence pack
                </Button>
                <Button href="/styleguide/forms" trailingIcon={<ArrowRight />}>
                  href → next/link
                </Button>
                <Button href="https://www.irs.gov/" target="_blank" variant="secondary">
                  External href → anchor
                </Button>
              </Row>
              <div className="max-w-sm">
                <Button size="lg" fullWidth>
                  Continue
                </Button>
              </div>
            </div>
          </Example>
          <Example label="States — loading, loading with text, disabled, disabled link">
            <Row>
              <Button loading>Send request</Button>
              <Button loading loadingText="Saving…">
                Save
              </Button>
              <Button variant="secondary" loading>
                Refresh
              </Button>
              <Button disabled>Continue</Button>
              <Button variant="secondary" disabled>
                Download
              </Button>
              <Button href="/styleguide" disabled variant="secondary">
                Disabled link
              </Button>
            </Row>
          </Example>
          <Example label="On an inverse surface" surface="inverse">
            <Row>
              <Button trailingIcon={<ArrowRight />}>Read the API reference</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
            </Row>
          </Example>
          <Example label="Guidance">
            <DoDont
              dos={["Label with a verb and its object: “Send request”, “Download evidence pack”.", "Put the primary action last in dialogs and dashboards; first in step flows (FormActions handles phones)."]}
              donts={["Don’t use two primary buttons in one view.", "Don’t use variant=\"link\" inside a sentence — that is TextLink."]}
            />
          </Example>
        </Specimen>

        <Specimen id="icon-button" name="IconButton" importLine='import { IconButton } from "@/components/ui"' note={<p>A square, icon-only button. <C>label</C> is required: it is the accessible name and the native tooltip. Say what it does to what.</p>}>
          <Example label="Variants and sizes">
            <Row>
              <IconButton label="Edit household" icon={<Pencil />} />
              <IconButton label="Refresh list" icon={<RefreshCw />} variant="secondary" />
              <IconButton label="New verification" icon={<Plus />} variant="primary" />
              <IconButton label="Remove pay-stub-october.jpg" icon={<Trash2 />} variant="danger" />
              <IconButton label="Settings" icon={<Settings />} size="sm" />
              <IconButton label="Settings" icon={<Settings />} size="lg" variant="secondary" />
              <IconButton label="Edit (disabled)" icon={<Pencil />} disabled />
              <IconButton label="Open the forms page" icon={<ArrowRight />} href="/styleguide/forms" variant="secondary" />
            </Row>
          </Example>
        </Specimen>

        <Specimen id="text-link" name="TextLink" importLine='import { TextLink } from "@/components/ui"' note={<p>A link inside text. Underlined by default so it never depends on colour alone; <C>tone=&quot;quiet&quot;</C> only where the layout already says “link” (table cells, navigation).</p>}>
          <Example label="In running text, quiet, external">
            <p className="max-w-reading text-base text-fg">
              Upload a benefits award letter, or <TextLink href="/styleguide/forms">see which documents work</TextLink>. Applicant <TextLink href="/styleguide/components" tone="quiet">Maria Alvarez</TextLink> · source:{" "}
              <TextLink href="https://www.huduser.gov/portal/datasets/il.html" target="_blank">
                HUD income limits
              </TextLink>
              .
            </p>
          </Example>
        </Specimen>
      </GuideSection>

      {/* -------------------------------------------------------------------------------------------- Status */}
      <GuideSection id="status" title="Status and labels">
        <Specimen id="badge" name="Badge" importLine='import { Badge } from "@/components/ui"' note={<p>A short label: a count, a category, a mode. For the state of a record use <C>StatusBadge</C> instead.</p>}>
          <Example label="Soft (default)">
            <Row>
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </Row>
          </Example>
          <Example label="Outline · solid · small · with icon">
            <div className="space-y-3">
              <Row>
                {TONES.map((tone) => (
                  <Badge key={tone} tone={tone} variant="outline">
                    {tone}
                  </Badge>
                ))}
              </Row>
              <Row>
                {TONES.map((tone) => (
                  <Badge key={tone} tone={tone} variant="solid">
                    {tone}
                  </Badge>
                ))}
              </Row>
              <Row>
                <Badge size="sm">Household of 4</Badge>
                <Badge size="sm" tone="brand">
                  Usually faster
                </Badge>
                <Badge tone="info" icon={<FileUp />}>
                  3 documents
                </Badge>
                <Badge tone="warning" icon={<Eye />}>
                  12 to review
                </Badge>
              </Row>
            </div>
          </Example>
        </Specimen>

        <Specimen
          id="status-badge"
          name="StatusBadge"
          importLine='import { StatusBadge, STATUS_VALUES, statusLabel, statusSpec } from "@/components/ui"'
          note={
            <p>
              The single source of wording, colour and icon for every status in the data model: <C>{'<StatusBadge kind="verification" status={v.status} provisional={v.provisional} />'}</C>. The <C>kind</C>/<C>status</C> pair is
              type-checked against the schema unions. <C>STATUS_VALUES[kind]</C> lists the values for filters; <C>statusSpec(kind, status).description</C> is the one-line meaning (also the badge tooltip). Spanish labels exist for
              the kinds families see.
            </p>
          }
        >
          {STATUS_KINDS.map((kind) => (
            <Example key={kind} label={`kind="${kind}" — ${KIND_NOTES[kind]}`}>
              <Row>
                {STATUS_VALUES[kind].map((status) => (
                  <StatusBadge key={status} {...({ kind, status } as StatusBadgeProps)} />
                ))}
              </Row>
            </Example>
          ))}
          <Example label="With the provisional marker (required on decided results while the limit is HUD-derived), small, without icon, Spanish">
            <Row>
              <StatusBadge kind="verification" status="eligible" provisional />
              <StatusBadge kind="verification" status="ineligible" provisional />
              <StatusBadge kind="verification" status="needs_review" size="sm" />
              <StatusBadge kind="stage" status="awaiting_family" showIcon={false} />
              <StatusBadge kind="verification" status="eligible" locale="es" provisional />
              <StatusBadge kind="handoff" status="held" locale="es" />
            </Row>
          </Example>
          <Example label="What each verification status means (statusSpec(kind, status).description)">
            <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
              {STATUS_VALUES.verification.map((status) => (
                <div key={status} className="flex items-start gap-3">
                  <dt className="w-32 shrink-0">
                    <StatusBadge kind="verification" status={status} size="sm" />
                  </dt>
                  <dd className="text-fg-muted">{STATUS_MAP.verification[status].description}</dd>
                </div>
              ))}
            </dl>
          </Example>
        </Specimen>

        <Specimen
          id="provisional"
          name="ProvisionalBadge · ProvisionalNotice"
          importLine='import { ProvisionalBadge, ProvisionalNotice } from "@/components/ui"'
          note={
            <p>
              The treatment for anything not final: an income limit from the HUD-derived table, a decision made with one, the curated SGO list. Dashed border and hatch are reserved for this meaning. The default notice text is about
              income limits; for anything else pass <C>title</C> and children from the owning copy module.
            </p>
          }
        >
          <Example label="Badge — default, small, custom wording, Spanish; beside a figure">
            <div className="space-y-4">
              <Row>
                <ProvisionalBadge />
                <ProvisionalBadge size="sm" />
                <ProvisionalBadge>Provisional list</ProvisionalBadge>
                <ProvisionalBadge locale="es" />
              </Row>
              <p className="flex flex-wrap items-center gap-2 text-base text-fg">
                Income limit used: <Money cents={SAMPLE_LIMIT_CENTS} className="font-semibold" /> <ProvisionalBadge size="sm" />
              </p>
            </div>
          </Example>
          <Example label="Notice — default text, with source details">
            <ProvisionalNotice
              className="max-w-2xl"
              details={
                <p>
                  Table: HUD FY 2026 income limits, effective <DateTime value="2026-05-01" format="dateLong" />.
                </p>
              }
            />
          </Example>
          <Example label="Notice — compact, Spanish, and custom subject">
            <div className="max-w-2xl space-y-4">
              <ProvisionalNotice compact />
              <ProvisionalNotice locale="es" />
              <ProvisionalNotice title="This list of organizations is provisional">
                <p>Pass the explanation from the copy module that owns it (for the SGO list, src/taxmath/copy). This text is a placeholder for the layout.</p>
              </ProvisionalNotice>
            </div>
          </Example>
        </Specimen>
      </GuideSection>

      {/* ------------------------------------------------------------------------------------------ Messages */}
      <GuideSection id="messages" title="Messages">
        <Specimen
          id="alert"
          name="Alert · Callout · LegalNote"
          importLine='import { Alert, LegalNote } from "@/components/ui"'
          note={
            <p>
              An in-flow message. Pick the tone by meaning: <C>info</C> context, <C>success</C> it worked, <C>warning</C> someone must act, <C>danger</C> it failed, <C>neutral</C> an aside, <C>legal</C> a legal or tax note. Add{" "}
              <C>role=&quot;alert&quot;</C> or <C>&quot;status&quot;</C> only when it appears in response to an action. Form validation uses <C>FormError</C>.
            </p>
          }
        >
          <Example label="Tones">
            <div className="grid max-w-3xl gap-3">
              <Alert tone="info" title="We’re still reading your documents">
                <p>This usually takes a few minutes. You can close this page; we will email you.</p>
              </Alert>
              <Alert tone="success" title="Your documents were received">
                <p>{SAMPLE_SGO.name} will be told as soon as there is a result.</p>
              </Alert>
              <Alert tone="warning" title="One more thing is needed" actions={<Button size="sm">Upload the missing page</Button>}>
                <p>The award letter is missing the page with the dates.</p>
              </Alert>
              <Alert tone="danger" title="Connecting to your payroll provider didn’t work" actions={<Button size="sm" variant="secondary">Upload documents instead</Button>}>
                <p>Nothing was shared. You can upload a document instead — you won’t have to start over.</p>
              </Alert>
              <Alert tone="neutral">
                <p>Verification is not an award. Whether to award a scholarship is decided by the scholarship organization.</p>
              </Alert>
              <LegalNote title="Preview, not tax advice">
                <p>What the credit is worth to you depends on your own tax situation.</p>
              </LegalNote>
            </div>
          </Example>
          <Example label="Without a title, without an icon">
            <div className="grid max-w-3xl gap-3">
              <Alert tone="info">
                <p>Your spot at {SAMPLE_CAMP.name} is held while your application is reviewed.</p>
              </Alert>
              <Alert tone="neutral" icon={null} title="Sandbox data">
                <p>Nothing on this screen is a real record.</p>
              </Alert>
            </div>
          </Example>
        </Specimen>

        <Specimen id="banner" name="Banner" importLine='import { Banner } from "@/components/ui"' note={<p>A full-width strip at the very top of a page or shell (every shell has a <C>banner</C> slot). One at a time. <C>tone=&quot;sandbox&quot;</C> is reserved for “this is test data / no money moves”.</p>}>
          <Example label="Tones" bleed>
            <div className="space-y-2 pb-5">
              <Banner tone="sandbox">Sandbox — no money moves. Gifts made here are not eligible for the credit.</Banner>
              <Banner tone="info" action={<TextLink href="/styleguide">What changed</TextLink>}>
                Income limits were updated to the newest published table.
              </Banner>
              <Banner tone="warning">Unique donor numbers are missing for 3 donors. Acknowledgments cannot be issued until they are entered.</Banner>
              <Banner tone="success">Your organization is approved.</Banner>
              <Banner tone="danger">Payments are temporarily unavailable. Nothing has been charged.</Banner>
              <Banner tone="brand">Comments on the proposed regulations are due December 1, 2026.</Banner>
            </div>
          </Example>
        </Specimen>

        <Specimen id="toast" name="Toast · FlashToast" importLine='import { useToast, FlashToast } from "@/components/ui"' note={<p>Confirms something that already happened. The root layout hosts the provider: call <C>useToast()</C> in a client component, or render <C>{'<FlashToast title="Saved" tone="success" />'}</C> from a server page after a redirect. Anything a person must read or act on belongs in the page.</p>}>
          <Example label="Fire a toast">
            <ToastDemo />
          </Example>
        </Specimen>
      </GuideSection>

      {/* ---------------------------------------------------------------------------------------------- Data */}
      <GuideSection id="data" title="Data display">
        <Specimen id="money" name="Money" importLine='import { Money } from "@/components/ui"' note={<p>Formats integer cents with tabular figures. Cents show only when they are not zero unless <C>showCents</C> says otherwise. <C>variant=&quot;display&quot;</C> is the large serif figure for the number a donor or family cares about.</p>}>
          <Example label="Text">
            <Row className="gap-6 text-base">
              <Money cents={170_000} />
              <Money cents={170_050} />
              <Money cents={170_000} showCents />
              <Money cents={31_249_950} showCents={false} />
              <Money cents={-42_500} />
              <Money cents={42_500} signed />
              <Money cents={null} />
            </Row>
          </Example>
          <Example label="Display">
            <Money cents={170_000} variant="display" />
          </Example>
        </Specimen>

        <Specimen id="date-time" name="DateTime" importLine='import { DateTime, formatDateTime } from "@/components/ui"' note={<p>One way to print dates. Renders <C>&lt;time&gt;</C> with the full timestamp as its tooltip. Times are US Central unless <C>timeZone</C> is given, so server and browser always agree. Date-only strings (<C>&quot;2026-05-01&quot;</C>) never shift across zones. <C>relative</C> needs <C>now</C> from <C>now()</C> in src/lib/clock.</p>}>
          <Example label="Formats (hover for the full timestamp)">
            <KeyValueList layout="grid" columns={3} dense>
              <KeyValue label='format="date" (default)'>
                <DateTime value="2026-11-18T20:52:00Z" />
              </KeyValue>
              <KeyValue label='format="dateLong"'>
                <DateTime value="2026-11-18T20:52:00Z" format="dateLong" />
              </KeyValue>
              <KeyValue label='format="dateTime"'>
                <DateTime value="2026-11-18T20:52:00Z" format="dateTime" />
              </KeyValue>
              <KeyValue label='format="time"'>
                <DateTime value="2026-11-18T20:52:00Z" format="time" />
              </KeyValue>
              <KeyValue label='format="monthYear"'>
                <DateTime value="2026-11-18T20:52:00Z" format="monthYear" />
              </KeyValue>
              <KeyValue label='format="relative"'>
                <DateTime value="2026-11-18T20:52:00Z" format="relative" now={SAMPLE_NOW} />
              </KeyValue>
              <KeyValue label="Date-only string">
                <DateTime value="2026-05-01" format="dateLong" />
              </KeyValue>
              <KeyValue label='locale="es"'>
                <DateTime value="2026-11-18T20:52:00Z" format="dateLong" locale="es" />
              </KeyValue>
              <KeyValue label="Missing value">
                <DateTime value={null} />
              </KeyValue>
            </KeyValueList>
          </Example>
        </Specimen>

        <Specimen id="stat" name="Stat · StatGrid" importLine='import { Stat, StatGrid } from "@/components/ui"' note={<p>One number with its label, as a definition list. <C>tiles</C> for dashboard overviews; <C>variant=&quot;display&quot;</C> for donor and family pages.</p>}>
          <Example label="Dashboard tiles" surface="canvas">
            <StatGrid columns={4} tiles>
              <Stat label="Awaiting review" value="12" hint="3 older than two days" />
              <Stat label="Decided this week" value="48" />
              <Stat label="Median time to decision" value="1.4 days" />
              <Stat label="Designated this year" value={<Money cents={8_415_000} />} hint="Test mode" />
            </StatGrid>
          </Example>
          <Example label="Display, with a provisional badge">
            <StatGrid columns={2}>
              <Stat variant="display" label="Income limit for your household" badge={<ProvisionalBadge size="sm" />} value={<Money cents={SAMPLE_LIMIT_CENTS} />} hint="Household of 4 · Harris County" />
              <Stat variant="display" label="Your gift" value={<Money cents={170_000} />} hint="Designated as a section 25F qualified contribution" />
            </StatGrid>
          </Example>
        </Specimen>

        <Specimen id="key-value" name="KeyValueList · KeyValue" importLine='import { KeyValueList, KeyValue } from "@/components/ui"' note={<p>Facts about one record, as a real <C>&lt;dl&gt;</C>. <C>rows</C> for detail panes, <C>grid</C> for summaries, <C>stacked</C> for narrow cards. Empty values show an em dash, never nothing.</p>}>
          <Example label='layout="rows" (default)'>
            <KeyValueList className="max-w-2xl">
              <KeyValue label="Applicant">Maria Alvarez</KeyValue>
              <KeyValue label="Student">Tomás Alvarez</KeyValue>
              <KeyValue label="Household" hint="County chosen from the family’s ZIP code">
                4 people · Harris County
              </KeyValue>
              <KeyValue label="Income limit used" hint="300% of area median for a household of 4">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Money cents={SAMPLE_LIMIT_CENTS} /> <ProvisionalBadge size="sm" />
                </span>
              </KeyValue>
              <KeyValue label="Award letter date">—</KeyValue>
            </KeyValueList>
          </Example>
          <Example label='layout="grid" columns={3} dense'>
            <KeyValueList
              layout="grid"
              columns={3}
              dense
              items={[
                { label: "Reference", value: "APP-1042" },
                { label: "Method", value: "Direct" },
                { label: "Income year", value: "2025" },
                { label: "Household size", value: "4" },
                { label: "Area", value: "Houston-The Woodlands-Sugar Land, TX" },
                { label: "Consent", value: "Version 3 · Nov 17, 2026" },
              ]}
            />
          </Example>
          <Example label='layout="stacked"'>
            <KeyValueList layout="stacked" className="max-w-xs">
              <KeyValue label="Scholarship organization">{SAMPLE_SGO.name}</KeyValue>
              <KeyValue label="What they receive">Your result and the evidence behind it</KeyValue>
            </KeyValueList>
          </Example>
        </Specimen>

        <Specimen id="line-items" name="LineItems" importLine='import { LineItems } from "@/components/ui"' note={<p>Lines of money that add up. Each amount is its own line by construction, so the designated contribution and any fee can never be folded together. Totals are computed by the service, in cents, and passed in.</p>}>
          <Example label="A gift (no fee applies)">
            <LineItems
              className="max-w-md"
              label="Your gift"
              showCents
              items={[
                { label: "Designated section 25F contribution", amountCents: 170_000, hint: `To ${SAMPLE_SGO.name}` },
                { label: "Platform fee", amountCents: 0, emphasis: "muted", hint: "None. If a fee ever applies it is its own line, not part of your contribution." },
              ]}
              total={{ label: "Charged today", amountCents: 170_000 }}
            />
          </Example>
          <Example label="A joint-return split, and a refund">
            <div className="grid max-w-3xl gap-8 md:grid-cols-2">
              <LineItems
                label="Joint return"
                items={[
                  { label: "Maria Alvarez", amountCents: 170_000, badge: <Badge size="sm">Spouse 1</Badge> },
                  { label: "Carlos Alvarez", amountCents: 170_000, badge: <Badge size="sm">Spouse 2</Badge> },
                ]}
                total={{ label: "Total designated", amountCents: 340_000, hint: "Each spouse gets a separate acknowledgment." }}
              />
              <LineItems
                label="Refund"
                showCents
                items={[
                  { label: "Contribution", amountCents: 170_000 },
                  { label: "Refunded Nov 18, 2026", amountCents: -170_000 },
                ]}
                total={{ label: "Net", amountCents: 0 }}
              />
            </div>
          </Example>
        </Specimen>

        <Specimen
          id="table"
          name="Table · Pagination · EmptyState"
          importLine='import { Table, Pagination, EmptyState, type TableColumn } from "@/components/ui"'
          note={
            <p>
              A real <C>&lt;table&gt;</C> when there is room; stacked cards when its container is narrow (a container query, so a table in a drawer stacks too). Put it in <C>{'<Card padding="none">'}</C>. Sorting and paging are
              URL-driven (<C>sort</C> + <C>sortHref</C>, <C>Pagination</C> with cursor hrefs) so the page stays a server component — click a header below. <C>rowHref</C> makes the whole row a link; one column is <C>primary</C>.
            </p>
          }
        >
          <Example label="Verification queue — sortable headers (URL-driven), row links, footer with pagination" surface="canvas">
            <Card padding="none">
              <CardHeader divided title="Verifications" description="8 in test mode" actions={<Button size="sm" leadingIcon={<Plus />}>New verification</Button>} />
              <Table
                caption="Verifications"
                columns={VERIFICATION_COLUMNS}
                rows={rows}
                rowKey={(row) => row.id}
                rowHref={(row) => `/styleguide/shells/dashboard?detail=${row.id}`}
                sort={{ key: sortKey, direction: sortDirection }}
                sortHref={(key, direction) => `/styleguide/components?sort=${key}&dir=${direction}#table`}
              />
              <CardFooter>
                <Pagination summary="Showing 1–8 of 8" prevHref={null} nextHref="/styleguide/components?cursor=sample#table" />
              </CardFooter>
            </Card>
          </Example>
          <Example label='density="compact", selected row, no row links'>
            <Card padding="none">
              <Table caption="Recent verifications (compact)" density="compact" columns={VERIFICATION_COLUMNS.filter((c) => c.key !== "stage" && c.key !== "student")} rows={rows.slice(0, 4)} rowKey={(row) => row.id} selectedKey={rows[1]?.id} />
            </Card>
          </Example>
          <Example label="In a narrow container the same table stacks (this box is 22rem wide)" surface="canvas">
            <div className="max-w-[22rem]">
              <Card padding="none">
                <Table caption="Verifications (stacked)" columns={VERIFICATION_COLUMNS} rows={rows.slice(0, 2)} rowKey={(row) => row.id} rowHref={(row) => `/styleguide/shells/dashboard?detail=${row.id}`} />
              </Card>
            </div>
          </Example>
          <Example label="Empty — the `empty` slot with an EmptyState">
            <Card padding="none">
              <Table
                caption="Verifications needing review"
                columns={VERIFICATION_COLUMNS}
                rows={[]}
                rowKey={(row) => row.id}
                empty={<EmptyState size="sm" icon={<Inbox />} title="Nothing needs review" description="When a document can’t be read with confidence, or income is close to the limit, it shows up here." />}
              />
            </Card>
          </Example>
          <Example label="EmptyState — page size, with actions">
            <EmptyState
              icon={<Webhook />}
              title="No webhook endpoints yet"
              description="Add an endpoint to be told when a verification is decided, instead of checking the dashboard."
              action={<Button leadingIcon={<Plus />}>Add endpoint</Button>}
              secondaryAction={<TextLink href="/docs">Read about webhooks</TextLink>}
            />
          </Example>
          <Example label="Pagination — first page, middle, last page, Spanish">
            <div className="max-w-2xl space-y-4">
              <Pagination summary="Showing 1–25 of 312" nextHref="/styleguide/components?cursor=b#table" />
              <Pagination summary="Showing 26–50 of 312" prevHref="/styleguide/components#table" nextHref="/styleguide/components?cursor=c#table" />
              <Pagination summary="Showing 301–312 of 312" prevHref="/styleguide/components?cursor=y#table" />
              <Pagination locale="es" summary="1–25 de 312" nextHref="/styleguide/components?cursor=b#table" />
            </div>
          </Example>
        </Specimen>

        <Specimen id="timeline" name="Timeline" importLine='import { Timeline } from "@/components/ui"' note={<p>The history of one record (verification events, webhook attempts). Titles are short past-tense sentences; the actor says who or what did it.</p>}>
          <Example label="Verification history">
            <Timeline
              className="max-w-xl"
              label="Verification history"
              items={[
                { id: "1", title: "Verification created", at: "2026-11-17T15:02:00Z", actor: "API key · Admissions system", icon: <KeyRound /> },
                { id: "2", title: "Family opened the link and gave consent", description: "Consent version 3", at: "2026-11-17T23:40:00Z", actor: "Maria Alvarez", tone: "info", icon: <UserRoundCheck /> },
                { id: "3", title: "Documents uploaded", description: "2 W-2s, 1 pay stub", at: "2026-11-18T00:05:00Z", actor: "Maria Alvarez", tone: "info", icon: <FileUp /> },
                { id: "4", title: "Sent to review", description: "Household income is within 5% of the provisional limit.", at: "2026-11-18T00:07:00Z", actor: "System", tone: "warning", icon: <Eye /> },
                { id: "5", title: "Marked eligible", description: "Reviewer confirmed the W-2 figures against the pay stub.", at: "2026-11-18T20:52:00Z", actor: "Reviewer · Daniel Okafor", tone: "success", icon: <FileCheck /> },
              ]}
            />
          </Example>
        </Specimen>

        <Specimen id="avatar" name="Avatar · OrgMark" importLine='import { Avatar, OrgMark } from "@/components/ui"' note={<p>People are round; organizations are square. Without an image both show initials on a tint that is stable for the name. They are decorative by default because the name is printed beside them.</p>}>
          <Example label="Sizes, with names">
            <div className="space-y-4">
              <Row>
                <Avatar name="Maria Alvarez" size="xs" />
                <Avatar name="Maria Alvarez" size="sm" />
                <Avatar name="Daniel Okafor" />
                <Avatar name="Nguyen Thi Lan" size="lg" />
                <Avatar name="Priya Raman" size="xl" />
                <OrgMark name={SAMPLE_SGO.name} size="sm" />
                <OrgMark name={SAMPLE_CAMP.name} />
                <OrgMark name="Harris County Tutoring Cooperative" size="lg" />
                <OrgMark name={SAMPLE_CAMP.name} logoUrl="/brand/mark.svg" size="lg" decorative={false} />
              </Row>
              <div className="flex items-center gap-3">
                <OrgMark name={SAMPLE_SGO.name} />
                <div>
                  <p className="text-sm font-semibold text-fg">{SAMPLE_SGO.name}</p>
                  <p className="text-sm text-fg-muted">{SAMPLE_SGO.typeLabel}</p>
                </div>
              </div>
            </div>
          </Example>
        </Specimen>

        <Specimen id="code" name="CodeBlock · CopyButton · CopyField" importLine='import { CodeBlock, CopyButton, CopyField } from "@/components/ui"' note={<p>For API keys, webhook secrets, family links and embed snippets. <C>CopyField secret</C> masks a value until the person reveals it. Copying is confirmed visibly and to screen readers.</p>}>
          <Example label="CodeBlock — dark (developer-facing) and light">
            <div className="grid gap-4 lg:grid-cols-2">
              <CodeBlock title="Embed snippet" language="html" code={SAMPLE_EMBED_SNIPPET} />
              <CodeBlock title="verification.decided" language="json" tone="light" code={SAMPLE_WEBHOOK_PAYLOAD} />
            </div>
          </Example>
          <Example label="CopyField — plain and secret; CopyButton — button and icon-only">
            <div className="grid max-w-3xl gap-5">
              <CopyField label="Family link" value="https://app.example/v/3Zk9QmT2Hd8LpX7Tn5Wc" hint="Send this to the family. It works until the verification is decided or canceled." />
              <CopyField label="Signing secret" value="whsec_sample_7Jm3XvC6Yw1NzG8Ke8HtP3" secret hint="Shown once. Store it now — it cannot be shown again." />
              <Row>
                <CopyButton value="ver_3Zk9QmT2">Copy id</CopyButton>
                <CopyButton value="ver_3Zk9QmT2" iconOnly label="Copy verification id" variant="ghost" />
              </Row>
            </div>
          </Example>
        </Specimen>

        <Specimen id="loading" name="Skeleton · Spinner · ProgressBar" importLine='import { Skeleton, Spinner, ProgressBar } from "@/components/ui"' note={<p>Skeleton for content whose shape is known; Spinner for a short wait of unknown length (give it a <C>label</C> when no text nearby says what is happening); ProgressBar when the amount done is known.</p>}>
          <Example label="Skeleton">
            <div className="flex max-w-md items-start gap-3">
              <Skeleton shape="circle" />
              <div className="flex-1">
                <Skeleton lines={3} />
              </div>
            </div>
          </Example>
          <Example label="Spinner — sizes, with label">
            <Row className="gap-6">
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" className="text-brand-600" />
              <Spinner label="Reading your documents…" />
            </Row>
          </Example>
          <Example label="ProgressBar">
            <div className="max-w-md space-y-3">
              <ProgressBar value={0.35} label="Uploading pay-stub-october.jpg" />
              <ProgressBar value={3} max={5} label="Steps completed" size="sm" />
              <ProgressBar value={1} label="Upload complete" tone="success" />
            </div>
          </Example>
        </Specimen>
      </GuideSection>

      {/* ----------------------------------------------------------------------------------------- Structure */}
      <GuideSection id="structure" title="Structure">
        <Specimen id="card" name="Card · CardHeader · CardBody · CardFooter" importLine='import { Card, CardHeader, CardBody, CardFooter } from "@/components/ui"' note={<p>A bordered surface that groups related content. <C>padding=&quot;none&quot;</C> when it holds a Table or its own header/body/footer. <C>href</C> turns the whole card into one link.</p>}>
          <Example label="Padding and tone" surface="canvas">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <p className="text-sm font-semibold text-fg">Default</p>
                <p className="mt-1 text-sm text-fg-muted">padding=&quot;md&quot;</p>
              </Card>
              <Card tone="sunken" padding="sm">
                <p className="text-sm font-semibold text-fg">Sunken</p>
                <p className="mt-1 text-sm text-fg-muted">padding=&quot;sm&quot;</p>
              </Card>
              <Card tone="brand">
                <p className="text-sm font-semibold text-brand-fg">Brand</p>
                <p className="mt-1 text-sm text-brand-fg">Selected or highlighted.</p>
              </Card>
              <Card tone="caution">
                <p className="text-sm font-semibold text-caution-fg">Caution</p>
                <p className="mt-1 text-sm text-caution-fg">Not final or not real.</p>
              </Card>
            </div>
          </Example>
          <Example label="Header, body and footer; a card that is a link" surface="canvas">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card padding="none">
                <CardHeader divided eyebrow="Webhooks" title="Admissions system" description="https://admissions.prairielantern.example/hooks" actions={<StatusBadge kind="webhook_endpoint" status="active" size="sm" />} />
                <CardBody>
                  <KeyValueList dense>
                    <KeyValue label="Events">verification.decided, verification.needs_review</KeyValue>
                    <KeyValue label="Last delivery">
                      <StatusBadge kind="webhook_delivery" status="succeeded" size="sm" />
                    </KeyValue>
                  </KeyValueList>
                </CardBody>
                <CardFooter>
                  <Row>
                    <Button size="sm" variant="secondary" leadingIcon={<Send />}>
                      Send test event
                    </Button>
                    <Button size="sm" variant="ghost">
                      Disable
                    </Button>
                  </Row>
                </CardFooter>
              </Card>
              <Card href="/styleguide/shells" aria-label="Open the shells page">
                <p className="text-sm font-semibold text-fg">A card with href</p>
                <p className="mt-1 text-sm text-fg-muted">The whole card is one link and lifts on hover. Do not nest other links or buttons inside it.</p>
              </Card>
            </div>
          </Example>
        </Specimen>

        <Specimen id="section" name="Section · PageHeader" importLine='import { Section, PageHeader } from "@/components/ui"' note={<p><C>PageHeader</C> is the page’s single h1 with its trail, status and actions. <C>Section</C> is a titled region (not a box) that holds Cards.</p>}>
          <Example label="PageHeader — dashboard (default)" surface="canvas">
            <PageHeader
              breadcrumbs={[{ label: "Verifications", href: "/styleguide/shells/dashboard" }, { label: "APP-1042" }]}
              title="Maria Alvarez"
              meta={<StatusBadge kind="verification" status="needs_review" />}
              description="Student: Tomás Alvarez · Created Nov 17, 2026 by the admissions system"
              actions={
                <>
                  <Button size="sm" variant="secondary" leadingIcon={<MailCheck />}>
                    Send reminder
                  </Button>
                  <Button size="sm">Resolve review</Button>
                </>
              }
            />
          </Example>
          <Example label='PageHeader — variant="display" with a back link (family and donor pages)' surface="canvas">
            <PageHeader variant="display" back={{ href: "/styleguide/shells/focus", label: "Back" }} title="Who lives in your home?" description="Count everyone who lives with the student, including the student." />
          </Example>
          <Example label="Section" surface="canvas">
            <Section title="Evidence" description="What the decision was based on. Raw files are deleted 30 days after the decision; the hashes stay." actions={<Button size="sm" variant="secondary" leadingIcon={<Download />}>Download pack</Button>}>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <p className="text-sm font-semibold text-fg">w2-2025-alvarez.pdf</p>
                  <p className="mt-1 font-mono text-xs text-fg-muted">sha256 9f2c…e41b</p>
                </Card>
                <Card>
                  <p className="text-sm font-semibold text-fg">pay-stub-october.jpg</p>
                  <p className="mt-1 font-mono text-xs text-fg-muted">sha256 03ab…77d0</p>
                </Card>
              </div>
            </Section>
          </Example>
        </Specimen>
      </GuideSection>

      {/* ---------------------------------------------------------------------------------------- Navigation */}
      <GuideSection id="navigation" title="Navigation">
        <Specimen id="tabs" name="Tabs" importLine='import { Tabs } from "@/components/ui"' note={<p>Tabs are links: each tab is a URL, so back, share and server rendering all work. For path tabs the current pathname decides; for query-string tabs pass <C>current</C> (as here — click one).</p>}>
          <Example label="Underline, with counts (query-string driven)">
            <Tabs
              label="Verification filters"
              current={tabHref(tab)}
              items={[
                { href: tabHref("all"), label: "All", count: 8 },
                { href: tabHref("needs_review"), label: "Needs review", count: 1, icon: <Eye /> },
                { href: tabHref("pending"), label: "Pending", count: 2 },
                { href: tabHref("decided"), label: "Decided", count: 3 },
              ]}
            />
          </Example>
          <Example label="Pills">
            <Tabs
              variant="pills"
              label="Settings sections"
              current={tabHref(tab)}
              items={[
                { href: tabHref("all"), label: "Organization" },
                { href: tabHref("needs_review"), label: "API keys", icon: <KeyRound /> },
                { href: tabHref("pending"), label: "Webhooks", icon: <Webhook /> },
                { href: tabHref("decided"), label: "Team" },
              ]}
            />
          </Example>
        </Specimen>

        <Specimen id="stepper" name="Stepper (ProgressSteps)" importLine='import { Stepper } from "@/components/ui"' note={<p>Where the person is in a flow. <C>auto</C> is compact on phones and a numbered row from 640px; completed steps with an <C>href</C> are links back. Goes in the <C>progress</C> slot of FocusShell.</p>}>
          <Example label='variant="full" — family intake'>
            <Stepper
              variant="full"
              current="documents"
              steps={[
                { id: "consent", label: "Consent", href: "/styleguide/shells/focus" },
                { id: "household", label: "Household", href: "/styleguide/shells/focus" },
                { id: "documents", label: "Income" },
                { id: "review", label: "Review" },
                { id: "done", label: "Done" },
              ]}
            />
          </Example>
          <Example label='variant="compact" — English and Spanish'>
            <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
              <Stepper variant="compact" current="household" steps={[{ id: "consent", label: "Consent" }, { id: "household", label: "Household" }, { id: "documents", label: "Income" }, { id: "review", label: "Review" }]} />
              <Stepper variant="compact" locale="es" current="documents" steps={[{ id: "consent", label: "Consentimiento" }, { id: "household", label: "Hogar" }, { id: "documents", label: "Ingresos" }, { id: "review", label: "Revisión" }]} />
            </div>
          </Example>
          <Example label='variant="auto" — donor checkout (resize the window)'>
            <Stepper
              current="details"
              steps={[
                { id: "amount", label: "Amount", href: "/styleguide/shells/checkout" },
                { id: "details", label: "Your details" },
                { id: "payment", label: "Payment" },
                { id: "receipt", label: "Receipt" },
              ]}
            />
          </Example>
        </Specimen>

        <Specimen id="language-toggle" name="LanguageToggle" importLine='import { LanguageToggle } from "@/components/ui"' note={<p>Presentational English / Español switcher: plain links you build (same page, other locale), each language written in itself. Goes in the <C>languageToggle</C> slot of FocusShell and EmbedShell.</p>}>
          <Example label="English current · Spanish current">
            <Row className="gap-8">
              <LanguageToggle current="en" hrefs={{ en: "/styleguide/components#language-toggle", es: "/styleguide/components?lang=es#language-toggle" }} />
              <LanguageToggle current="es" hrefs={{ en: "/styleguide/components#language-toggle", es: "/styleguide/components?lang=es#language-toggle" }} />
            </Row>
          </Example>
        </Specimen>

        <Specimen id="menu" name="DropdownMenu" importLine='import { DropdownMenu, type MenuItem } from "@/components/ui"' note={<p>A few links and actions behind one button: row actions, the account menu. Items are links (<C>href</C>) or server actions (<C>action</C> + <C>fields</C>). Esc or a click outside closes it. Destructive actions should go through <C>ConfirmButton</C> instead.</p>}>
          <Example label="Icon trigger (row actions), button trigger">
            <Row>
              <DropdownMenu
                label="Actions for Maria Alvarez"
                items={[
                  { label: "Open verification", href: "/styleguide/shells/dashboard", icon: <Eye /> },
                  { label: "Send reminder", href: "/styleguide/components#menu", icon: <MailCheck />, description: "Emails a new link" },
                  { label: "Download evidence pack", href: "/styleguide/components#menu", icon: <Download />, disabled: true },
                  { label: "Cancel verification", action: demoConfirmAction, fields: { id: "ver_3Zk9QmT2" }, tone: "danger", icon: <Trash2 />, separated: true },
                ]}
              />
              <DropdownMenu
                label="Export"
                triggerStyle="button"
                align="start"
                trigger={
                  <>
                    <Download aria-hidden="true" className="size-4" /> Export
                  </>
                }
                items={[
                  { label: "CSV", href: "/styleguide/components#menu" },
                  { label: "IRS portal report", href: "/styleguide/components#menu", description: "Due by February 28" },
                ]}
              />
            </Row>
          </Example>
        </Specimen>

        <Specimen id="disclosure" name="Disclosure · Accordion" importLine='import { Disclosure, Accordion } from "@/components/ui"' note={<p>Show/hide secondary detail with native <C>&lt;details&gt;</C>: works without script and is found by in-page search. Never hide consent text, a provisional label or a fee inside one.</p>}>
          <Example label="Disclosure — card and plain">
            <div className="max-w-2xl space-y-4">
              <Disclosure summary="What counts as household income?">
                <p>Money people in your home earned or received last year: wages, self-employment, child support, alimony. Housing assistance and other non-cash help do not count.</p>
              </Disclosure>
              <Disclosure variant="plain" summary="Why do we ask for a date of birth?">
                <p>The scholarship organization needs it for the student’s application.</p>
              </Disclosure>
            </div>
          </Example>
          <Example label="Accordion — exclusive">
            <Accordion
              className="max-w-2xl"
              exclusive
              name="sg-faq"
              items={[
                { id: "faq-docs", title: "Which documents can I upload?", content: <p>A benefits award letter (SNAP, TANF, WIC, Section 8 or SSI) dated within the last 12 months, or last year’s tax return, IRS transcript, W-2s or pay stubs.</p>, defaultOpen: true },
                { id: "faq-cost", title: "Does this cost anything?", content: <p>No. Families never pay.</p> },
                { id: "faq-award", title: "Does a result mean we get a scholarship?", content: <p>No. It tells the scholarship organization that your household is within the income limit. Awards are their decision.</p> },
              ]}
            />
          </Example>
        </Specimen>

        <Specimen id="logo" name="Logo · LogoMark" importLine='import { Logo, LogoMark } from "@/components/ui"' note={<p>The product name comes from <C>BRAND</C> in src/lib/brand — never type it. The mark is also <C>src/app/icon.svg</C> and <C>public/brand/mark.svg</C>.</p>}>
          <Example label="On light">
            <Row className="gap-8">
              <Logo size="sm" />
              <Logo />
              <Logo size="lg" />
              <Logo variant="wordmark" />
              <LogoMark size="lg" title="Product mark" />
            </Row>
          </Example>
          <Example label="On an inverse surface" surface="inverse">
            <Row className="gap-8">
              <Logo tone="inverse" />
              <Logo tone="inverse" variant="mark" size="lg" />
            </Row>
          </Example>
        </Specimen>
      </GuideSection>

      {/* ------------------------------------------------------------------------------------------ Overlays */}
      <GuideSection id="overlays" title="Overlays">
        <Specimen
          id="dialog"
          name="Dialog · Drawer · ConfirmDialog · DialogButton · ConfirmButton"
          importLine='import { Dialog, Drawer, ConfirmDialog, DialogButton, ConfirmButton, useDisclosure } from "@/components/ui"'
          note={
            <p>
              Built on the native <C>&lt;dialog&gt;</C>: the browser traps and returns focus, Esc closes, the page behind is inert. <C>Dialog</C>, <C>Drawer</C> and <C>ConfirmDialog</C> are controlled (<C>open</C>/<C>onClose</C>,
              see <C>useDisclosure</C>); a server page can render <C>{'<Drawer open closeHref="…">'}</C> for a URL-driven detail pane. <C>DialogButton</C> and <C>ConfirmButton</C> need no client code in the page at all.
            </p>
          }
        >
          <Example label="Controlled, from a client component">
            <Row>
              <DialogDemo />
              <DrawerDemo />
              <ConfirmDialogDemo />
            </Row>
          </Example>
          <Example label="From a server page: DialogButton (server-rendered children) and ConfirmButton (runs a server action)">
            <Row>
              <DialogButton label="Add API key" leadingIcon={<KeyRound />} title="Add an API key" description="The key is shown once after you create it.">
                <form action={demoConfirmAction} className="space-y-4">
                  <Field label="Name" hint="Where this key will be used.">
                    <Input name="name" defaultValue="Admissions system" />
                  </Field>
                  <div className="flex justify-end">
                    <SubmitButton pendingText="Creating…">Create key</SubmitButton>
                  </div>
                </form>
              </DialogButton>
              <DialogButton as="drawer" label="Open as drawer" title="Webhook deliveries" description="Last 3 attempts">
                <Timeline
                  label="Deliveries"
                  format="relative"
                  now={SAMPLE_NOW}
                  items={[
                    { id: "a", title: "Delivered · 200", at: "2026-11-18T20:52:10Z", tone: "success" },
                    { id: "b", title: "Retrying · 503", at: "2026-11-18T20:52:00Z", tone: "warning" },
                    { id: "c", title: "Delivered · 200", at: "2026-11-18T18:14:00Z", tone: "success" },
                  ]}
                />
              </DialogButton>
              <ConfirmButton
                label="Revoke key"
                variant="danger"
                tone="danger"
                title="Revoke this API key?"
                description="Requests using ecca_test_3fK9… will start failing immediately. This cannot be undone."
                confirmLabel="Revoke key"
                action={demoConfirmAction}
                fields={{ id: "key_sample" }}
              />
            </Row>
          </Example>
        </Specimen>

        <Specimen id="tooltip" name="Tooltip · DefinitionTooltip" importLine='import { Tooltip, DefinitionTooltip } from "@/components/ui"' note={<p><C>Tooltip</C> is a hover/focus hint for a control — supplementary only, because touch screens never show it. <C>DefinitionTooltip</C> explains a term in plain language and opens on tap or click, so it works on phones; the explanation is announced when it opens.</p>}>
          <Example label="Tooltip — hover or focus the buttons">
            <Row>
              <Tooltip content="Emails the family a new link">
                <Button variant="secondary" size="sm" leadingIcon={<MailCheck />}>
                  Send reminder
                </Button>
              </Tooltip>
              <Tooltip content="Raw files are deleted 30 days after the decision" side="bottom">
                <Badge tone="neutral">Retention: 30 days</Badge>
              </Tooltip>
            </Row>
          </Example>
          <Example label="DefinitionTooltip — click or tap the dotted terms">
            <p className="max-w-reading text-base text-fg">
              Your household income must be at or under 300% of the{" "}
              <DefinitionTooltip term="area median income" definition="The middle household income for the area where you live. Half of households earn more and half earn less. HUD publishes it each year." /> for your{" "}
              <DefinitionTooltip term="household" definition="The student and everyone who lives with the student.">
                household
              </DefinitionTooltip>
              .
            </p>
          </Example>
        </Specimen>
      </GuideSection>
    </GuideChrome>
  );
}
